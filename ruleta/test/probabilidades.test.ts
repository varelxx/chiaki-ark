import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { AzarCripto, elegirPonderado, enteroUniforme } from "../src/lib/azar";
import { estaDisponible, probabilidadesEfectivas } from "../src/lib/probabilidades";
import { premiosDeRuleta } from "../src/servicios/tiradas";
import type { Premio } from "../src/tipos";

const GIROS = 1_000_000;
// Valores críticos de chi-cuadrado para p = 0,001 (grados de libertad = premios - 1).
const CHI2_CRITICO: Record<number, number> = { 1: 10.83, 2: 13.82, 3: 16.27, 4: 18.47, 5: 20.52, 6: 22.46 };

function simular(premios: Premio[], giros: number) {
  const azar = new AzarCripto(16384);
  const cuenta = new Map<number, number>();
  for (let i = 0; i < giros; i++) {
    const p = elegirPonderado(premios, azar)!;
    cuenta.set(p.id, (cuenta.get(p.id) ?? 0) + 1);
  }
  return cuenta;
}

function comprobarFrecuencias(premios: Premio[], giros: number) {
  const esperadas = probabilidadesEfectivas(premios);
  const cuenta = simular(premios.filter(estaDisponible), giros);
  let chi2 = 0;
  for (const { premio, prob } of esperadas) {
    const observadas = cuenta.get(premio.id) ?? 0;
    const frecuencia = observadas / giros;
    // Cada premio dentro de 5 desviaciones típicas de su probabilidad.
    const sigma = Math.sqrt((prob * (1 - prob)) / giros);
    expect(Math.abs(frecuencia - prob), `${premio.nombre}: ${(frecuencia * 100).toFixed(3)} % frente a ${(prob * 100).toFixed(2)} %`).toBeLessThan(5 * sigma);
    chi2 += (observadas - prob * giros) ** 2 / (prob * giros);
  }
  // Los premios no disponibles no salen nunca.
  for (const p of premios.filter((x) => !estaDisponible(x))) expect(cuenta.get(p.id) ?? 0).toBe(0);
  expect(chi2).toBeLessThan(CHI2_CRITICO[esperadas.length - 1]);
  return { cuenta, chi2 };
}

describe("probabilidades: 1.000.000 de giros por ruleta", () => {
  for (const ruletaId of [1, 2, 3]) {
    it(`Ruleta ${ruletaId}: las frecuencias coinciden con los pesos`, async () => {
      // Con stock disponible en todos los premios (los cupones de ejemplo empiezan sin códigos).
      const premios = (await premiosDeRuleta(env.DB, ruletaId)).map((p) => ({ ...p, stock: p.tipo === "cupon" ? 1_000_000 : p.stock }));
      expect(premios.reduce((s, p) => s + p.peso, 0)).toBe(10_000);
      const { cuenta } = comprobarFrecuencias(premios, GIROS);
      expect([...cuenta.values()].reduce((a, b) => a + b, 0)).toBe(GIROS);
    });
  }

  it("los premios sin stock se excluyen y el resto se renormaliza", async () => {
    // Ruleta 1 sin códigos de descuento: solo quedan pack (20), azul (8) y amarilla (2) -> 66,7 % / 26,7 % / 6,7 %.
    const premios = await premiosDeRuleta(env.DB, 1);
    const efectivas = probabilidadesEfectivas(premios);
    expect(efectivas.map((e) => e.premio.nombre)).toEqual(["Pack de recursos ARK", "Cápsula azul ARK", "Cápsula amarilla ARK"]);
    expect(efectivas[0].prob).toBeCloseTo(2000 / 3000, 10);
    comprobarFrecuencias(premios, 300_000);
  });
});

describe("generador aleatorio", () => {
  it("enteroUniforme no tiene sesgo de módulo (rechazo de valores del tramo incompleto)", () => {
    // Fuente falsa que devuelve primero un valor del tramo que debe rechazarse.
    const valores = [2 ** 32 - 1, 5];
    const fuente = { siguiente32: () => valores.shift()! };
    expect(enteroUniforme(3, fuente)).toBe(5 % 3);
  });

  it("un premio con peso 0 nunca sale y sin pesos no hay premio", () => {
    const azar = new AzarCripto();
    const lista = [
      { id: 1, peso: 0 },
      { id: 2, peso: 7 },
    ];
    for (let i = 0; i < 1000; i++) expect(elegirPonderado(lista, azar)!.id).toBe(2);
    expect(elegirPonderado([{ peso: 0 }], azar)).toBeNull();
    expect(() => elegirPonderado([{ peso: -1 }], azar)).toThrow();
  });
});
