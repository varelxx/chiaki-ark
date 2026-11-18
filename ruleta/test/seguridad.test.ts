import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { entrarAdmin, flashDe, ORIGEN, peticion, postAdmin } from "./ayudas";

const NUEVA = "una-contraseña-nueva-larga";

const login = (contrasena: string) =>
  peticion("/admin/login", { method: "POST", headers: { origin: ORIGEN }, body: new URLSearchParams({ contrasena }) });

const cookieDe = (r: Response) => r.headers.getSetCookie().find((c) => c.startsWith("__Host-ruleta_admin="))?.split(";")[0];

describe("contraseña del panel", () => {
  it("se cambia desde el panel; la anterior deja de valer y se cierran las demás sesiones", async () => {
    const otraSesion = await entrarAdmin();
    const cookie = await entrarAdmin();
    expect(await (await peticion("/admin/seguridad", { headers: { cookie } })).text()).toContain("Sigues con la contraseña inicial");

    // Errores: actual incorrecta, no coinciden, demasiado corta.
    expect(flashDe(await postAdmin("/admin/seguridad/contrasena", cookie, { actual: "mala", nueva: NUEVA, repetida: NUEVA })).error).toMatch(/actual no es correcta/);
    expect(flashDe(await postAdmin("/admin/seguridad/contrasena", cookie, { actual: env.TEST_CONTRASENA, nueva: NUEVA, repetida: NUEVA + "x" })).error).toMatch(/no coinciden/);
    expect(flashDe(await postAdmin("/admin/seguridad/contrasena", cookie, { actual: env.TEST_CONTRASENA, nueva: "corta", repetida: "corta" })).error).toMatch(/al menos 12/);

    const r = await postAdmin("/admin/seguridad/contrasena", cookie, { actual: env.TEST_CONTRASENA, nueva: NUEVA, repetida: NUEVA });
    expect(flashDe(r).ok).toMatch(/Contraseña cambiada/);
    const cookieNueva = cookieDe(r);
    expect(cookieNueva).toBeTruthy();

    // Quien la cambió sigue dentro con su cookie nueva; las sesiones anteriores quedan cerradas.
    expect((await peticion("/admin", { headers: { cookie: cookieNueva! } })).status).toBe(200);
    expect((await peticion("/admin", { headers: { cookie } })).status).toBe(302);
    expect((await peticion("/admin", { headers: { cookie: otraSesion } })).status).toBe(302);

    // La contraseña inicial ya no sirve; la nueva sí. Queda guardada como hash, nunca en claro.
    expect((await login(env.TEST_CONTRASENA)).status).toBe(401);
    expect((await login(NUEVA)).status).toBe(303);
    const guardado = await env.DB.prepare("SELECT valor FROM config WHERE clave = 'admin_hash'").first<{ valor: string }>();
    expect(guardado!.valor).toMatch(/^pbkdf2_sha256\$20000\$/);
    expect(guardado!.valor).not.toContain(NUEVA);
  });

  it("«cerrar sesión en todos los dispositivos» invalida las demás cookies", async () => {
    const a = await entrarAdmin();
    const b = await entrarAdmin();
    const r = await postAdmin("/admin/seguridad/cerrar-sesiones", a, {});
    const aNueva = cookieDe(r)!;
    expect((await peticion("/admin", { headers: { cookie: aNueva } })).status).toBe(200);
    expect((await peticion("/admin", { headers: { cookie: b } })).status).toBe(302);
  });
});

describe("endurecimiento", () => {
  it("los mensajes del panel no se pueden inyectar por la URL", async () => {
    const cookie = await entrarAdmin();
    const html = await (await peticion("/admin/pedidos?error=MENSAJE-FALSO&ok=OTRO-FALSO", { headers: { cookie } })).text();
    expect(html).not.toContain("MENSAJE-FALSO");
    expect(html).not.toContain("OTRO-FALSO");
  });

  it("limita las peticiones sensibles por IP (girar: 10 por minuto)", async () => {
    const ip = "198.51.100.200";
    const estados: number[] = [];
    for (let i = 0; i < 12; i++) {
      estados.push((await peticion(`/api/tirada/${"a".repeat(43)}/girar`, { method: "POST", headers: { "cf-connecting-ip": ip } })).status);
    }
    expect(estados.slice(0, 10).every((s) => s === 404)).toBe(true);
    expect(estados.slice(10)).toEqual([429, 429]);
    const r = await peticion(`/api/tirada/${"a".repeat(43)}/girar`, { method: "POST", headers: { "cf-connecting-ip": ip } });
    expect(await r.json()).toMatchObject({ ok: false, error: "demasiadas_peticiones" });
    expect(r.headers.get("retry-after")).toBe("60");
    // Otra IP no se ve afectada.
    expect((await peticion(`/api/tirada/${"a".repeat(43)}/girar`, { method: "POST", headers: { "cf-connecting-ip": "198.51.100.201" } })).status).toBe(404);
  });

  it("cabeceras de seguridad en todas las respuestas", async () => {
    const r = await peticion("/");
    expect(r.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(r.headers.get("referrer-policy")).toBe("same-origin");
  });
});
