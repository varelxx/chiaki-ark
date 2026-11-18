import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { aHex, hmacSha256 } from "../src/lib/cripto";
import { leerCsv, celdaCsv } from "../src/lib/csv";
import { guardarConfig } from "../src/servicios/config";
import { interpretarCsv } from "../src/servicios/pedidos";
import { recortarIp } from "../src/servicios/mantenimiento";
import { crearTiradaConToken, entrarAdmin, fijarPesos, ORIGEN, peticion, postAdmin, simularBrevo } from "./ayudas";
import csvEjemplo from "../ejemplos/pedidos-ejemplo.csv?raw";

const CSV_EJEMPLO = `pedido;correo;importe;moneda;pais;fecha
1001;ana@ejemplo.test;12,50;EUR;ES;2026-11-10
1002;bob@ejemplo.test;"24,90";EUR;MX;10/11/2026
1003;carla@ejemplo.test;40;USD;US;2026-11-11
1004;mal-correo;10;EUR;ES;2026-11-11
1001;ana@ejemplo.test;12,50;EUR;ES;2026-11-10
`;

describe("acceso al panel", () => {
  it("sin sesión redirige al login; contraseña mala 401; 5 fallos bloquean", async () => {
    expect((await peticion("/admin")).status).toBe(302);
    expect((await peticion("/admin/pedidos")).headers.get("location")).toBe("/admin/login");
    const mal = () => peticion("/admin/login", { method: "POST", headers: { origin: ORIGEN, "cf-connecting-ip": "203.0.113.9" }, body: new URLSearchParams({ contrasena: "nope" }) });
    for (let i = 0; i < 5; i++) expect((await mal()).status).toBe(401);
    expect((await mal()).status).toBe(429);
  });

  it("con la contraseña correcta entra (cookie HttpOnly, Secure, SameSite=Strict)", async () => {
    const r = await peticion("/admin/login", { method: "POST", headers: { origin: ORIGEN }, body: new URLSearchParams({ contrasena: env.TEST_CONTRASENA }) });
    expect(r.status).toBe(303);
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect((await peticion("/admin", { headers: { cookie: cookie.split(";")[0] } })).status).toBe(200);
  });

  it("rechaza POST de otro origen (CSRF)", async () => {
    const cookie = await entrarAdmin();
    const r = await peticion("/admin/paises", { method: "POST", headers: { cookie, origin: "https://malo.example" }, body: new URLSearchParams({ codigo: "FR" }) });
    expect(r.status).toBe(403);
    const nulo = await peticion("/admin/paises", { method: "POST", headers: { cookie, origin: "null", "sec-fetch-site": "cross-site" }, body: new URLSearchParams({ codigo: "FR" }) });
    expect(nulo.status).toBe(403);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM paises_bloqueados").first<{ n: number }>())!.n).toBe(0);
    // Un navegador que manda "Origin: null" desde el propio panel (Sec-Fetch-Site: same-origin) sí pasa.
    const propio = await peticion("/admin/paises", { method: "POST", headers: { cookie, origin: "null", "sec-fetch-site": "same-origin" }, body: new URLSearchParams({ codigo: "FR" }) });
    expect(propio.status).toBe(303);
  });
});

describe("pedidos desde el panel", () => {
  it("importa CSV, autoriza en lote y envía los enlaces", async () => {
    const brevo = simularBrevo();
    const cookie = await entrarAdmin();
    await postAdmin("/admin/cambios", cookie, { moneda_nueva: "USD", tasa_nueva: "1,08" });
    const form = new FormData();
    form.set("texto", CSV_EJEMPLO);
    const imp = await postAdmin("/admin/pedidos/importar", cookie, form);
    const html = await imp.text();
    expect(html).toContain("<strong>3</strong> pedidos importados");
    expect(html).toContain("Correo no válido");
    expect((await env.DB.prepare("SELECT count(*) AS n FROM pedidos WHERE estado = 'pendiente'").first<{ n: number }>())!.n).toBe(3);
    expect(brevo.llamadas).toHaveLength(0); // importar no envía nada

    const lista = await (await peticion("/admin/pedidos", { headers: { cookie } })).text();
    expect(lista).toContain("Elegible");

    const aut = await postAdmin("/admin/pedidos/acciones", cookie, { accion: "autorizar_todos" });
    expect(await aut.text()).toContain("<strong>3</strong> pedidos autorizados");
    expect(brevo.llamadas).toHaveLength(3);
    const ruletas = (await env.DB.prepare("SELECT p.numero, t.ruleta_id FROM tiradas t JOIN pedidos p ON p.id = t.pedido_id ORDER BY p.numero").all()).results;
    expect(ruletas).toEqual([
      { numero: "1001", ruleta_id: 1 },
      { numero: "1002", ruleta_id: 2 },
      { numero: "1003", ruleta_id: 3 },
    ]);
  });

  it("historial exportable a CSV y botón de entregado", async () => {
    simularBrevo();
    const cookie = await entrarAdmin();
    await fijarPesos(1, { "Cápsula amarilla ARK": 10_000 });
    const t = await crearTiradaConToken({ ruletaId: 1, correo: "=cmd@ejemplo.test", pais: "ES" });
    await peticion(`/api/tirada/${t.token}/girar`, { method: "POST", headers: { "cf-connecting-ip": "198.51.100.23" } });

    const csv = await (await peticion("/admin/tiradas.csv", { headers: { cookie } })).text();
    const filas = leerCsv(csv);
    expect(filas[0]).toEqual(expect.arrayContaining(["creada_en", "pedido", "correo", "pais", "ruleta", "premio", "estado", "ip"]));
    expect(filas[1]).toContain("Cápsula amarilla ARK");
    expect(filas[1]).toContain("198.51.100.23");
    expect(filas[1]).toContain("'=cmd@ejemplo.test"); // protegido contra inyección de fórmulas

    const r = await postAdmin("/admin/tiradas/acciones", cookie, { accion: "entregar", ids: [String(t.id)] });
    expect(r.status).toBe(303);
    expect((await env.DB.prepare("SELECT estado FROM tiradas WHERE id = ?1").bind(t.id).first<{ estado: string }>())!.estado).toBe("entregada");
  });

  it("RGPD: borra los datos personales de un correo a petición", async () => {
    simularBrevo();
    const cookie = await entrarAdmin();
    const t = await crearTiradaConToken({ ruletaId: 1, correo: "borrar@ejemplo.test" });
    await peticion(`/api/tirada/${t.token}/girar`, { method: "POST", headers: { "cf-connecting-ip": "198.51.100.7" } });
    const pendiente = await crearTiradaConToken({ ruletaId: 1, correo: "borrar@ejemplo.test" });
    const r = await postAdmin("/admin/rgpd/borrar", cookie, { correo: "borrar@ejemplo.test", confirmar: "1" });
    expect(r.status).toBe(303);
    const filas = (await env.DB.prepare("SELECT correo, ip, estado, token_hash FROM tiradas ORDER BY id").all()).results;
    expect(filas).toEqual([
      { correo: "[borrado]", ip: null, estado: "usada", token_hash: null },
      { correo: "[borrado]", ip: null, estado: "revocada", token_hash: null },
    ]);
    expect((await peticion(`/tirada/${pendiente.token}`)).status).toBe(404);
  });
});

describe("webhook opcional", () => {
  const cuerpo = JSON.stringify({ pedido: "W-1", correo: "web@ejemplo.test", importe: 22, moneda: "EUR", pais: "PT", fecha: "2026-11-15" });

  it("está desactivado por defecto (404)", async () => {
    expect((await peticion("/api/webhook/pedidos", { method: "POST", body: cuerpo })).status).toBe(404);
  });

  it("activado: exige firma HMAC y deja el pedido pendiente (nunca autoriza solo)", async () => {
    await guardarConfig(env.DB, { webhook_activo: "1" });
    const malo = await peticion("/api/webhook/pedidos", { method: "POST", headers: { "x-firma": "sha256=" + "0".repeat(64) }, body: cuerpo });
    expect(malo.status).toBe(401);
    const firma = aHex(await hmacSha256(env.WEBHOOK_SECRET!, cuerpo));
    const r = await peticion("/api/webhook/pedidos", { method: "POST", headers: { "x-firma": `sha256=${firma}` }, body: cuerpo });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ creados: 1 });
    expect(await env.DB.prepare("SELECT estado, origen FROM pedidos WHERE numero = 'W-1'").first()).toEqual({ estado: "pendiente", origen: "webhook" });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM tiradas").first<{ n: number }>())!.n).toBe(0);
  });
});

describe("CSV y utilidades", () => {
  it("lee CSV con ';', comillas, BOM y fechas DD/MM/AAAA", () => {
    const r = interpretarCsv("﻿" + CSV_EJEMPLO);
    expect(r.filas.map((f) => [f.numero, f.importe_x100, f.fecha, f.idioma])).toEqual([
      ["1001", 1250, "2026-11-10", "es"],
      ["1002", 2490, "2026-11-10", "es"],
      ["1003", 4000, "2026-11-11", "en"],
      ["1001", 1250, "2026-11-10", "es"],
    ]);
    expect(r.errores).toEqual([{ linea: 5, error: "Correo no válido: «mal-correo»" }]);
    expect(leerCsv('a,b\n"x, ""y""",2\n')).toEqual([
      ["a", "b"],
      ['x, "y"', "2"],
    ]);
    expect(() => interpretarCsv("correo,importe\nx@y.z,1")).toThrow(/Falta la columna/);
  });

  it("el CSV de ejemplo del README se importa sin errores", () => {
    const r = interpretarCsv(csvEjemplo);
    expect(r.errores).toEqual([]);
    expect(r.filas.map((f) => [f.numero, f.importe_x100, f.moneda, f.pais, f.fecha])).toEqual([
      ["#1001", 1250, "EUR", "ES", "2026-11-10"],
      ["#1002", 2490, "EUR", "MX", "2026-11-10"],
      ["#1003", 4500, "USD", "US", "2026-11-11"],
      ["#1004", 800, "EUR", "DE", "2026-11-11"],
      ["#1005", 3800, "GBP", "GB", "2026-11-12"],
    ]);
  });

  it("acepta cabeceras en inglés", () => {
    const r = interpretarCsv("Order ID,Email,Amount,Currency,Country,Date\nA9,a@b.co,15.00,eur,de,2026-11-01T10:20:00Z\n");
    expect(r.filas[0]).toMatchObject({ numero: "A9", moneda: "EUR", pais: "DE", fecha: "2026-11-01" });
  });

  it("exporta celdas seguras y recorta IPs", () => {
    expect(celdaCsv("=1+1")).toBe("'=1+1");
    expect(celdaCsv('a"b')).toBe('"a""b"');
    expect(recortarIp("203.0.113.77")).toBe("203.0.113.0");
    expect(recortarIp("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3::");
  });
});
