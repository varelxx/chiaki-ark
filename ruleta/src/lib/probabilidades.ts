import type { Premio, Ruleta } from "../tipos";

export const PESO_TOTAL = 10_000; // 100 %

type PremioCalculo = Pick<Premio, "id" | "peso" | "coste_cents" | "stock" | "activo">;

/** Un premio entra en el sorteo si está activo, pesa algo y le queda stock (o es ilimitado). */
export const estaDisponible = (p: PremioCalculo): boolean =>
  p.activo === 1 && p.peso > 0 && (p.stock === null || p.stock > 0);

export function sumaPesosActivos(premios: readonly PremioCalculo[]): number {
  return premios.reduce((s, p) => s + (p.activo === 1 ? p.peso : 0), 0);
}

/** Probabilidades reales en este momento: solo premios disponibles, renormalizados a 1. */
export function probabilidadesEfectivas<T extends PremioCalculo>(premios: readonly T[]): Array<{ premio: T; prob: number }> {
  const disponibles = premios.filter(estaDisponible);
  const total = disponibles.reduce((s, p) => s + p.peso, 0);
  if (total === 0) return [];
  return disponibles.map((premio) => ({ premio, prob: premio.peso / total }));
}

/** Coste esperado con los pesos configurados: Σ peso × coste (en céntimos, puede tener decimales). */
export function costeEsperadoNominal(premios: readonly PremioCalculo[]): number {
  return premios.reduce((s, p) => s + (p.activo === 1 ? (p.peso / PESO_TOTAL) * p.coste_cents : 0), 0);
}

/** Coste esperado real hoy (excluye premios sin stock y renormaliza). */
export function costeEsperadoEfectivo(premios: readonly PremioCalculo[]): number {
  return probabilidadesEfectivas(premios).reduce((s, { premio, prob }) => s + prob * premio.coste_cents, 0);
}

export interface AnalisisRuleta {
  sumaPesos: number;
  sumaCorrecta: boolean;
  nominalCents: number;
  efectivoCents: number;
  limiteCents: number;
  superaNominal: boolean;
  superaEfectivo: boolean;
  sinPremiosDisponibles: boolean;
  agotados: Array<{ id: number; nombre: string; tipo: string }>;
  avisos: string[];
}

const eur = (c: number) => (c / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

export function analizarRuleta(ruleta: Pick<Ruleta, "limite_coste_cents" | "nombre">, premios: readonly Premio[]): AnalisisRuleta {
  const sumaPesos = sumaPesosActivos(premios);
  const nominalCents = costeEsperadoNominal(premios);
  const efectivoCents = costeEsperadoEfectivo(premios);
  const limiteCents = ruleta.limite_coste_cents;
  // Pequeña tolerancia para no avisar por redondeos de coma flotante.
  const superaNominal = nominalCents > limiteCents + 1e-9;
  const superaEfectivo = efectivoCents > limiteCents + 1e-9;
  const agotados = premios
    .filter((p) => p.activo === 1 && p.peso > 0 && p.stock !== null && p.stock <= 0)
    .map((p) => ({ id: p.id, nombre: p.nombre, tipo: p.tipo }));
  const sinPremiosDisponibles = probabilidadesEfectivas(premios).length === 0;
  const avisos: string[] = [];
  if (sumaPesos !== PESO_TOTAL) avisos.push(`Los pesos activos suman ${(sumaPesos / 100).toLocaleString("es-ES")} % en lugar de 100 %.`);
  if (superaNominal) avisos.push(`El coste esperado (${eur(nominalCents)}) supera el límite del tramo (${eur(limiteCents)}).`);
  if (superaEfectivo && !superaNominal) {
    avisos.push(`Con el stock actual el coste esperado real (${eur(efectivoCents)}) supera el límite del tramo (${eur(limiteCents)}).`);
  }
  for (const a of agotados) {
    avisos.push(a.tipo === "cupon"
      ? `«${a.nombre}» no tiene códigos libres: queda fuera de la ruleta hasta que importes más.`
      : `«${a.nombre}» está sin stock: queda fuera de la ruleta.`);
  }
  if (sinPremiosDisponibles) avisos.push("No hay ningún premio disponible: las tiradas de esta ruleta esperarán sin perderse.");
  return { sumaPesos, sumaCorrecta: sumaPesos === PESO_TOTAL, nominalCents, efectivoCents, limiteCents, superaNominal, superaEfectivo, sinPremiosDisponibles, agotados, avisos };
}
