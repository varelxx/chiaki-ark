import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { hashToken } from "../src/lib/cripto";
import { generarEnlacesDirectos, reenviarTiradas } from "../src/servicios/tiradas";
import type { Tirada } from "../src/tipos";
import { entrarAdmin, extraerToken, peticion, postAdmin, simularBrevo } from "./ayudas";

const tiradas = async () => (await env.DB.prepare("SELECT * FROM tiradas ORDER BY id").all<Tirada>()).results;
const correosEnCola = async () => (await env.DB.prepare("SELECT count(*) AS n FROM correos").first<{ n: number }>())!.n;

describe("enlaces directos (sin pedido ni correo)", () => {
  it("el panel genera un enlace de un solo uso por ruleta, con mensaje listo para copiar", async () => {
    const brevo = simularBrevo();
    const cookie = await entrarAdmin();
    const pagina = await (await peticion("/admin/enlaces", { headers: { cookie } })).text();
    expect(pagina).toContain("Ruleta 1 · Cápsula verde");
    expect(pagina).toContain("Ruleta 3 · Cápsula amarilla/roja");

    const r = await postAdmin("/admin/enlaces", cookie, { ruleta: "2", cantidad: "1", idioma: "es", nota: "Juan · Wallapop" });
    expect(r.status).toBe(200);
    const html = await r.text();
    const [token] = extraerToken(html);
    expect(token).toHaveLength(43);
    expect(html).toContain("¡Gracias por tu compra en Tienda de Pruebas! Tienes una tirada en nuestra ruleta (Ruleta 2 · Cápsula azul)");

    const [t] = await tiradas();
    expect(t).toMatchObject({ correo: "", ruleta_id: 2, estado: "pendiente", nota: "Juan · Wallapop", pedido_id: null });
    expect(t.token_hash).toBe(await hashToken(token));
    expect(t.expira_en! > t.creada_en).toBe(true);
    // No se envía ningún correo: el enlace lo manda la tienda a mano.
    expect(await correosEnCola()).toBe(0);
    expect(brevo.llamadas).toHaveLength(0);

    // El historial lo muestra como enlace directo con su nota.
    const historial = await (await peticion("/admin/tiradas", { headers: { cookie } })).text();
    expect(historial).toContain("enlace directo");
    expect(historial).toContain("Juan · Wallapop");
  });

  it("solo sirve para un giro y no genera correo de resultado", async () => {
    const brevo = simularBrevo();
    const { tokens } = await generarEnlacesDirectos(env.DB, { ruletaId: 1, cantidad: 1, idioma: "es", nota: "" });
    expect((await peticion(`/tirada/${tokens[0]}`)).status).toBe(200);
    expect((await peticion(`/api/tirada/${tokens[0]}/girar`, { method: "POST" })).status).toBe(200);
    expect((await peticion(`/api/tirada/${tokens[0]}/girar`, { method: "POST" })).status).toBe(409);
    expect(await correosEnCola()).toBe(0);
    expect(brevo.llamadas).toHaveLength(0);
    // La página del enlace sigue mostrando el resultado.
    const [t] = await tiradas();
    expect(await (await peticion(`/tirada/${tokens[0]}`)).text()).toContain(t.premio_nombre!);
  });

  it("varios enlaces a la vez: todos distintos; no se pueden 'reenviar' por correo", async () => {
    const { tokens } = await generarEnlacesDirectos(env.DB, { ruletaId: 3, cantidad: 5, idioma: "en", nota: null });
    expect(new Set(tokens).size).toBe(5);
    const filas = await tiradas();
    expect(filas).toHaveLength(5);
    expect(filas.every((f) => f.idioma === "en" && f.ruleta_id === 3)).toBe(true);
    expect(await reenviarTiradas(env.DB, filas.map((f) => f.id))).toBe(0);
  });

  it("valida la cantidad y la ruleta", async () => {
    await expect(generarEnlacesDirectos(env.DB, { ruletaId: 1, cantidad: 0, idioma: "es", nota: "" })).rejects.toThrow(/entre 1 y 20/);
    await expect(generarEnlacesDirectos(env.DB, { ruletaId: 1, cantidad: 21, idioma: "es", nota: "" })).rejects.toThrow(/entre 1 y 20/);
    await expect(generarEnlacesDirectos(env.DB, { ruletaId: 99, cantidad: 1, idioma: "es", nota: "" })).rejects.toThrow(/Ruleta no encontrada/);
  });
});
