import type { Ruleta } from "../tipos";
import { aCentimosEur } from "./dinero";

/** Solo cuenta el tramo más alto alcanzado: la ruleta activa con mayor umbral <= importe. */
export function tramoParaImporte<R extends Pick<Ruleta, "umbral_cents" | "activa">>(eurCents: number, ruletas: readonly R[]): R | null {
  let elegida: R | null = null;
  for (const r of ruletas) {
    if (r.activa !== 1 || eurCents < r.umbral_cents) continue;
    if (!elegida || r.umbral_cents > elegida.umbral_cents) elegida = r;
  }
  return elegida;
}

export interface ContextoElegibilidad {
  ruletas: Ruleta[];
  tipos: Map<string, number>;
  bloqueados: Set<string>;
  campanaInicio: string; // AAAA-MM-DD o ""
  campanaFin: string;
}

export type MotivoNoElegible = "pais_bloqueado" | "sin_tipo_cambio" | "bajo_minimo" | "fuera_de_campana";

export type Elegibilidad =
  | { ok: true; ruleta: Ruleta; eurCents: number; tasa: number }
  | { ok: false; motivo: MotivoNoElegible; texto: string; eurCents?: number };

export function evaluarPedido(
  pedido: { importe_x100: number; moneda: string; pais: string; fecha: string },
  ctx: ContextoElegibilidad,
): Elegibilidad {
  if (ctx.bloqueados.has(pedido.pais)) {
    return { ok: false, motivo: "pais_bloqueado", texto: `País bloqueado (${pedido.pais})` };
  }
  if ((ctx.campanaInicio && pedido.fecha < ctx.campanaInicio) || (ctx.campanaFin && pedido.fecha > ctx.campanaFin)) {
    return { ok: false, motivo: "fuera_de_campana", texto: "Fuera de las fechas de campaña" };
  }
  const conv = aCentimosEur(pedido.importe_x100, pedido.moneda, ctx.tipos);
  if (!conv) return { ok: false, motivo: "sin_tipo_cambio", texto: `Falta el tipo de cambio de ${pedido.moneda}` };
  const ruleta = tramoParaImporte(conv.eurCents, ctx.ruletas);
  if (!ruleta) return { ok: false, motivo: "bajo_minimo", texto: "No llega al tramo mínimo", eurCents: conv.eurCents };
  return { ok: true, ruleta, eurCents: conv.eurCents, tasa: conv.tasa };
}
