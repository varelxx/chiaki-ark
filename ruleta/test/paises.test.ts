import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { bloquearPais } from "../src/servicios/catalogo";
import { guardarConfig, leerConfig } from "../src/servicios/config";
import { autorizarPedidos, crearPedidos, validarPedido } from "../src/servicios/pedidos";
import { anadirTiradasManuales } from "../src/servicios/tiradas";
import { crearTiradaConToken, peticion, simularBrevo } from "./ayudas";

const nuevoPedido = async (numero: string, pais: string) => {
  const r = validarPedido({ numero, correo: `${numero}@ejemplo.test`, importe: "40", moneda: "EUR", pais, fecha: "2026-11-12" });
  if (!r.ok) throw new Error(r.error);
  await crearPedidos(env.DB, [r.pedido], "manual");
};

describe("países bloqueados", () => {
  it("la lista empieza vacía", async () => {
    expect((await env.DB.prepare("SELECT count(*) AS n FROM paises_bloqueados").first<{ n: number }>())!.n).toBe(0);
  });

  it("no se autorizan tiradas de pedidos de países bloqueados", async () => {
    await bloquearPais(env.DB, "us");
    await nuevoPedido("p-us", "US");
    await nuevoPedido("p-mx", "MX");
    const r = await autorizarPedidos(env.DB, [1, 2], await leerConfig(env.DB));
    expect(r.autorizados).toBe(1);
    expect(r.rechazados).toEqual([{ numero: "p-us", motivo: "País bloqueado (US)" }]);
    const tiradas = (await env.DB.prepare("SELECT pais FROM tiradas").all<{ pais: string }>()).results;
    expect(tiradas).toEqual([{ pais: "MX" }]);
    expect((await env.DB.prepare("SELECT estado FROM pedidos WHERE numero = 'p-us'").first<{ estado: string }>())!.estado).toBe("pendiente");
  });

  it("tampoco a mano con un país bloqueado", async () => {
    await bloquearPais(env.DB, "BE");
    await expect(anadirTiradasManuales(env.DB, { correo: "x@ejemplo.test", ruletaId: 1, cantidad: 1, idioma: "es", pais: "BE" })).rejects.toThrow(/bloqueado/);
  });

  it("si el país se bloquea después de autorizar, la tirada no se puede girar (y no se pierde)", async () => {
    const t = await crearTiradaConToken({ ruletaId: 1, pais: "NL" });
    await bloquearPais(env.DB, "NL");
    expect((await peticion(`/tirada/${t.token}`)).status).toBe(403);
    expect((await peticion(`/api/tirada/${t.token}/girar`, { method: "POST" })).status).toBe(403);
    expect((await env.DB.prepare("SELECT estado FROM tiradas WHERE id = ?1").bind(t.id).first<{ estado: string }>())!.estado).toBe("pendiente");
  });

  it("bloqueo opcional por la IP del visitante (CF-IPCountry)", async () => {
    simularBrevo();
    await bloquearPais(env.DB, "US");
    const t = await crearTiradaConToken({ ruletaId: 1, pais: "ES" });
    // Desactivado por defecto: la IP no cuenta.
    await guardarConfig(env.DB, { geobloqueo_ip: "0" });
    const t2 = await crearTiradaConToken({ ruletaId: 1, pais: "ES" });
    expect((await peticion(`/api/tirada/${t2.token}/girar`, { method: "POST", headers: { "cf-ipcountry": "US" } })).status).toBe(200);
    // Activado: bloquea.
    await guardarConfig(env.DB, { geobloqueo_ip: "1" });
    expect((await peticion(`/api/tirada/${t.token}/girar`, { method: "POST", headers: { "cf-ipcountry": "US" } })).status).toBe(403);
    expect((await peticion(`/api/tirada/${t.token}/girar`, { method: "POST", headers: { "cf-ipcountry": "ES" } })).status).toBe(200);
  });

  it("los términos publican los países excluidos", async () => {
    await bloquearPais(env.DB, "US");
    const html = await (await peticion("/legal/terminos?lang=es")).text();
    expect(html).toContain("no está disponible para pedidos de:");
    expect(html).toMatch(/Estados Unidos|US/);
  });
});
