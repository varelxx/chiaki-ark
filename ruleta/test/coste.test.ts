import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { analizarRuleta, costeEsperadoNominal } from "../src/lib/probabilidades";
import { listarRuletas } from "../src/servicios/catalogo";
import { premiosDeRuleta } from "../src/servicios/tiradas";
import { entrarAdmin, flashDe, idPremio, peticion, postAdmin } from "./ayudas";

const analisis = async (id: number) => {
  const ruleta = (await listarRuletas(env.DB)).find((r) => r.id === id)!;
  return analizarRuleta(ruleta, await premiosDeRuleta(env.DB, id));
};

describe("límite de coste", () => {
  it("coste esperado de los valores de ejemplo: ~0,66 €, ~1,38 € y 3,10 €", async () => {
    expect(costeEsperadoNominal(await premiosDeRuleta(env.DB, 1))).toBeCloseTo(65.5, 9);
    expect(costeEsperadoNominal(await premiosDeRuleta(env.DB, 2))).toBeCloseTo(137.5, 9);
    expect(costeEsperadoNominal(await premiosDeRuleta(env.DB, 3))).toBeCloseTo(310, 9);
    for (const id of [1, 2, 3]) {
      const a = await analisis(id);
      expect(a.sumaCorrecta).toBe(true);
      expect(a.superaNominal).toBe(false);
    }
  });

  it("avisa cuando el coste esperado supera el límite del tramo", async () => {
    // Dino legendario a 100 €: 0,4×3 + 0,4×2 + 0,15×4 + 0,05×100 = 7,60 € > 7 €
    await env.DB.prepare("UPDATE premios SET coste_cents = 10000 WHERE id = ?1").bind(await idPremio(3, "Dino domesticado legendario")).run();
    const a = await analisis(3);
    expect(a.nominalCents).toBeCloseTo(760, 9);
    expect(a.superaNominal).toBe(true);
    expect(a.avisos.join(" ")).toMatch(/supera el límite/);
  });

  it("avisa cuando, por falta de stock, el coste real supera el límite", async () => {
    // Ruleta 2 con límite 1,50 €: nominal 1,375 € (ok), pero sin códigos de descuento el coste real es 1,625 €.
    await env.DB.prepare("UPDATE ruletas SET limite_coste_cents = 150 WHERE id = 2").run();
    const a = await analisis(2);
    expect(a.superaNominal).toBe(false);
    expect(a.efectivoCents).toBeCloseTo(162.5, 9);
    expect(a.superaEfectivo).toBe(true);
    expect(a.avisos.join(" ")).toMatch(/coste esperado real/);
  });

  it("el panel guarda (solo avisa) y muestra el aviso; exige que las probabilidades sumen 100 %", async () => {
    const cookie = await entrarAdmin();
    const premios = await premiosDeRuleta(env.DB, 3);
    const datos: Record<string, string | string[]> = { ids: premios.map((p) => String(p.id)) };
    for (const p of premios) {
      Object.assign(datos, {
        [`nombre_${p.id}`]: p.nombre,
        [`nombre_en_${p.id}`]: p.nombre_en,
        [`rareza_${p.id}`]: p.rareza,
        [`peso_${p.id}`]: String(p.peso / 100).replace(".", ","),
        [`stock_${p.id}`]: p.stock === null ? "" : String(p.stock),
        [`coste_${p.id}`]: p.nombre.startsWith("Dino") ? "100" : String(p.coste_cents / 100),
        [`activo_${p.id}`]: "1",
        [`orden_${p.id}`]: String(p.orden),
      });
    }
    const r = await postAdmin("/admin/premios/guardar?ruleta=3", cookie, datos);
    expect(r.status).toBe(303);
    expect(flashDe(r).error).toMatch(/supera el límite/);
    expect(r.headers.get("location")).toBe("/admin/premios?ruleta=3"); // el mensaje no viaja en la URL
    expect((await analisis(3)).superaNominal).toBe(true); // se guardó

    const pagina = await (await peticion("/admin/premios?ruleta=3", { headers: { cookie } })).text();
    expect(pagina).toContain("supera el límite del tramo");

    // Pesos que no suman 100 %: no se guarda nada.
    const dino = premios.find((p) => p.nombre.startsWith("Dino"))!;
    const malo = await postAdmin("/admin/premios/guardar?ruleta=3", cookie, { ...datos, [`peso_${dino.id}`]: "6" });
    expect(flashDe(malo).error).toMatch(/deben sumar 100 %/);
    expect((await env.DB.prepare("SELECT peso FROM premios WHERE id = ?1").bind(dino.id).first<{ peso: number }>())!.peso).toBe(500);
  });
});
