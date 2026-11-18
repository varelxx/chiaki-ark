import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { parsearImporte } from "../src/lib/dinero";
import { evaluarPedido, tramoParaImporte, type ContextoElegibilidad } from "../src/lib/tramos";
import { guardarConfig, leerConfig } from "../src/servicios/config";
import { autorizarPedidos, crearPedidos, validarPedido } from "../src/servicios/pedidos";
import { guardarTipos, listarRuletas } from "../src/servicios/catalogo";
import type { PedidoValido } from "../src/servicios/pedidos";

const pedido = (numero: string, importe: string, moneda = "EUR", pais = "ES", fecha = "2026-11-10"): PedidoValido => {
  const r = validarPedido({ numero, correo: `${numero.toLowerCase()}@ejemplo.test`, importe, moneda, pais, fecha });
  if (!r.ok) throw new Error(r.error);
  return r.pedido;
};

async function contexto(extra: Partial<ContextoElegibilidad> = {}): Promise<ContextoElegibilidad> {
  return { ruletas: await listarRuletas(env.DB), tipos: new Map([["USD", 1.08]]), bloqueados: new Set(), campanaInicio: "", campanaFin: "", ...extra };
}

describe("tramos", () => {
  it("solo cuenta el tramo más alto alcanzado (10 / 20 / 35 €)", async () => {
    const ruletas = await listarRuletas(env.DB);
    const casos: Array<[number, number | null]> = [
      [0, null],
      [999, null],
      [1000, 1],
      [1999, 1],
      [2000, 2],
      [3499, 2],
      [3500, 3],
      [100_000, 3],
    ];
    for (const [cents, esperada] of casos) expect(tramoParaImporte(cents, ruletas)?.id ?? null, `${cents} céntimos`).toBe(esperada);
  });

  it("ignora las ruletas inactivas", async () => {
    const ruletas = (await listarRuletas(env.DB)).map((r) => (r.id === 3 ? { ...r, activa: 0 } : r));
    expect(tramoParaImporte(5000, ruletas)?.id).toBe(2);
  });

  it("convierte a euros con la tabla de tipos de cambio", async () => {
    const ctx = await contexto();
    // 21,60 USD / 1,08 = 20,00 € -> Ruleta 2
    const e = evaluarPedido(pedido("U1", "21,60", "USD"), ctx);
    expect(e.ok && e.eurCents).toBe(2000);
    expect(e.ok && e.ruleta.id).toBe(2);
    // 21,59 USD = 19,99 € -> Ruleta 1
    const e2 = evaluarPedido(pedido("U2", "21.59", "USD"), ctx);
    expect(e2.ok && e2.ruleta.id).toBe(1);
    // Moneda sin tipo de cambio: no se puede autorizar
    const e3 = evaluarPedido(pedido("G1", "50", "GBP"), ctx);
    expect(e3.ok).toBe(false);
    expect(!e3.ok && e3.motivo).toBe("sin_tipo_cambio");
  });

  it("respeta las fechas de campaña", async () => {
    const ctx = await contexto({ campanaInicio: "2026-11-01", campanaFin: "2026-11-30" });
    expect(evaluarPedido(pedido("C1", "40", "EUR", "ES", "2026-10-31"), ctx)).toMatchObject({ ok: false, motivo: "fuera_de_campana" });
    expect(evaluarPedido(pedido("C2", "40", "EUR", "ES", "2026-11-30"), ctx)).toMatchObject({ ok: true });
  });

  it("al autorizar: una tirada por pedido, importe en € congelado y un correo por destinatario", async () => {
    await guardarTipos(env.DB, [{ moneda: "USD", porEur: 1.08 }], "manual");
    await crearPedidos(env.DB, [pedido("A-1", "9,99"), pedido("A-2", "10"), pedido("A-3", "37,80", "USD"), pedido("A-4", "120")], "manual");
    const ids = (await env.DB.prepare("SELECT id FROM pedidos ORDER BY id").all<{ id: number }>()).results.map((r) => r.id);
    const config = await leerConfig(env.DB);
    const r = await autorizarPedidos(env.DB, ids, config);
    expect(r.autorizados).toBe(3);
    expect(r.rechazados).toEqual([{ numero: "A-1", motivo: "No llega al tramo mínimo" }]);
    expect(r.correos).toBe(3);

    const { results } = await env.DB.prepare(
      "SELECT p.numero, p.estado, p.importe_eur_cents, t.ruleta_id FROM pedidos p LEFT JOIN tiradas t ON t.pedido_id = p.id ORDER BY p.id",
    ).all<{ numero: string; estado: string; importe_eur_cents: number | null; ruleta_id: number | null }>();
    expect(results).toEqual([
      { numero: "A-1", estado: "pendiente", importe_eur_cents: null, ruleta_id: null },
      { numero: "A-2", estado: "autorizado", importe_eur_cents: 1000, ruleta_id: 1 },
      { numero: "A-3", estado: "autorizado", importe_eur_cents: 3500, ruleta_id: 3 },
      { numero: "A-4", estado: "autorizado", importe_eur_cents: 12000, ruleta_id: 3 },
    ]);

    // Autorizar otra vez no crea tiradas nuevas: el pedido ya no está pendiente (y pedido_id es UNIQUE).
    const otra = await autorizarPedidos(env.DB, ids, config);
    expect(otra.autorizados).toBe(0);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM tiradas").first<{ n: number }>())!.n).toBe(3);
  });

  it("los tramos se configuran en el panel, no en el código", async () => {
    await env.DB.prepare("UPDATE ruletas SET umbral_cents = 1500 WHERE id = 1").run();
    const ctx = await contexto();
    expect(evaluarPedido(pedido("T1", "12"), ctx)).toMatchObject({ ok: false, motivo: "bajo_minimo" });
    expect(evaluarPedido(pedido("T2", "15"), ctx)).toMatchObject({ ok: true });
  });

  it("varios pedidos del mismo correo acumulan tiradas en un único correo", async () => {
    const mismo = (numero: string, importe: string) => ({ ...pedido(numero, importe), correo: "fan@ejemplo.test" });
    await crearPedidos(env.DB, [mismo("M-1", "12"), mismo("M-2", "25")], "csv");
    const ids = (await env.DB.prepare("SELECT id FROM pedidos").all<{ id: number }>()).results.map((r) => r.id);
    const r = await autorizarPedidos(env.DB, ids, await leerConfig(env.DB));
    expect(r.autorizados).toBe(2);
    expect(r.correos).toBe(1);
    const correo = await env.DB.prepare("SELECT tirada_ids FROM correos").first<{ tirada_ids: string }>();
    expect(JSON.parse(correo!.tirada_ids)).toHaveLength(2);
  });

  it("los números de pedido son únicos", async () => {
    const primera = await crearPedidos(env.DB, [pedido("D-1", "20")], "manual");
    const segunda = await crearPedidos(env.DB, [pedido("D-1", "50"), pedido("D-2", "20"), pedido("D-2", "30")], "csv");
    expect(primera.creados).toBe(1);
    expect(segunda.creados).toBe(1);
    expect(segunda.duplicados.sort()).toEqual(["D-1", "D-2"]);
  });

  it("la campaña configurada en ajustes se aplica al autorizar", async () => {
    await guardarConfig(env.DB, { campana_inicio: "2026-12-01" });
    await crearPedidos(env.DB, [pedido("F-1", "50", "EUR", "ES", "2026-11-15")], "manual");
    const r = await autorizarPedidos(env.DB, [1], await leerConfig(env.DB));
    expect(r.autorizados).toBe(0);
    expect(r.rechazados[0].motivo).toMatch(/campaña/);
  });
});

describe("importes", () => {
  it("entiende comas, puntos, miles y símbolos", () => {
    expect(parsearImporte("10")).toBe(1000);
    expect(parsearImporte("10,5")).toBe(1050);
    expect(parsearImporte("10.50")).toBe(1050);
    expect(parsearImporte("1.234,56")).toBe(123456);
    expect(parsearImporte("1,234.56")).toBe(123456);
    expect(parsearImporte("19,995")).toBe(2000);
    expect(parsearImporte("20 €")).toBe(2000);
    expect(parsearImporte("20.00 EUR")).toBe(2000);
    expect(parsearImporte("-5")).toBeNull();
    expect(parsearImporte("abc")).toBeNull();
    expect(parsearImporte("")).toBeNull();
  });
});
