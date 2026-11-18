/**
 * Convierte un importe escrito por una persona en un entero "x100" (céntimos de la moneda original).
 * Acepta "12", "12.5", "12,50", "1.234,56", "1,234.56", con o sin símbolo de moneda.
 * Si solo hay un separador y aparece una vez, se toma como separador decimal.
 */
export function parsearImporte(texto: string): number | null {
  let s = String(texto ?? "").trim().replace(/[\s €$£¥]|[A-Za-z]{3}$/g, "");
  if (!s || /[^0-9.,]/.test(s)) return null;
  const puntos = (s.match(/\./g) ?? []).length;
  const comas = (s.match(/,/g) ?? []).length;
  let entero = s;
  let decimales = "";
  if (puntos && comas) {
    const sepDecimal = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const idx = s.lastIndexOf(sepDecimal);
    entero = s.slice(0, idx).replace(/[.,]/g, "");
    decimales = s.slice(idx + 1);
    if (/[.,]/.test(decimales)) return null;
  } else if (puntos + comas === 1) {
    const idx = Math.max(s.indexOf("."), s.indexOf(","));
    entero = s.slice(0, idx);
    decimales = s.slice(idx + 1);
  } else if (puntos + comas > 1) {
    entero = s.replace(/[.,]/g, "");
  }
  if (!/^\d*$/.test(entero) || !/^\d*$/.test(decimales) || (entero + decimales).length === 0) return null;
  const d = (decimales + "000").slice(0, 3);
  let valor = Number(entero || "0") * 100 + Number(d.slice(0, 2));
  if (Number(d[2]) >= 5) valor += 1; // redondeo a 2 decimales
  return Number.isSafeInteger(valor) ? valor : null;
}

/** Convierte un importe x100 de cualquier moneda a céntimos de euro. `porEur` = unidades por 1 EUR. */
export function aCentimosEur(importeX100: number, moneda: string, tipos: Map<string, number>): { eurCents: number; tasa: number } | null {
  if (moneda === "EUR") return { eurCents: importeX100, tasa: 1 };
  const tasa = tipos.get(moneda);
  if (!tasa || !(tasa > 0)) return null;
  return { eurCents: Math.round(importeX100 / tasa), tasa };
}

const formateadores = new Map<string, Intl.NumberFormat>();

export function formatearMoneda(x100: number, moneda = "EUR", idioma = "es"): string {
  const clave = `${idioma}|${moneda}`;
  let f = formateadores.get(clave);
  if (!f) {
    try {
      f = new Intl.NumberFormat(idioma === "es" ? "es-ES" : "en-IE", { style: "currency", currency: moneda });
    } catch {
      f = new Intl.NumberFormat(idioma === "es" ? "es-ES" : "en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    formateadores.set(clave, f);
  }
  return f.format(x100 / 100);
}

export const formatearEur = (cents: number, idioma = "es") => formatearMoneda(cents, "EUR", idioma);

/** Para los formularios del panel: "2,50" -> 250. */
export function parsearEurACents(texto: string): number | null {
  return parsearImporte(texto);
}

/** "45" -> 4500, "2,5" -> 250, "0,01" -> 1 (puntos básicos). */
export function parsearPorcentajeAPeso(texto: string): number | null {
  const v = parsearImporte(texto);
  if (v === null || v > 10000) return null;
  return v;
}

export function pesoAPorcentaje(peso: number, idioma = "es"): string {
  return (peso / 100).toLocaleString(idioma === "es" ? "es-ES" : "en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " %";
}

export function formatearNumeroPlano(x100: number): string {
  return (x100 / 100).toFixed(2);
}
