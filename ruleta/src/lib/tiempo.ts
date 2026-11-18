const DIA_MS = 86_400_000;

export const ahora = (): string => new Date().toISOString();

export const sumarDias = (iso: string, dias: number): string =>
  new Date(Date.parse(iso) + dias * DIA_MS).toISOString();

export const sumarMinutos = (iso: string, minutos: number): string =>
  new Date(Date.parse(iso) + minutos * 60_000).toISOString();

/** Día UTC (AAAA-MM-DD). El cupo diario de Brevo se cuenta por día UTC. */
export const diaUtc = (iso: string = ahora()): string => iso.slice(0, 10);

const FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const FECHA_EU = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

/** Normaliza una fecha de pedido a AAAA-MM-DD. Acepta ISO (con o sin hora) y DD/MM/AAAA. */
export function normalizarFecha(texto: string): string | null {
  const t = texto.trim();
  if (!t) return null;
  let a: number, m: number, d: number;
  const iso = FECHA_ISO.exec(t.slice(0, 10));
  const eu = FECHA_EU.exec(t.split(/[ T]/)[0]);
  if (iso && (t.length === 10 || /^[ T]/.test(t.slice(10)))) {
    [a, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (eu) {
    [d, m, a] = [Number(eu[1]), Number(eu[2]), Number(eu[3])];
  } else {
    return null;
  }
  const fecha = new Date(Date.UTC(a, m - 1, d));
  if (fecha.getUTCFullYear() !== a || fecha.getUTCMonth() !== m - 1 || fecha.getUTCDate() !== d) return null;
  return fecha.toISOString().slice(0, 10);
}

export function formatearFecha(iso: string | null | undefined, zona = "Europe/Madrid", idioma = "es", conHora = true): string {
  if (!iso) return "";
  const fecha = new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso);
  if (Number.isNaN(fecha.getTime())) return iso;
  const opciones: Intl.DateTimeFormatOptions = conHora && iso.length > 10
    ? { dateStyle: "short", timeStyle: "short" }
    : { dateStyle: "medium" };
  try {
    return new Intl.DateTimeFormat(idioma === "es" ? "es-ES" : "en-GB", { ...opciones, timeZone: zona }).format(fecha);
  } catch {
    return iso.replace("T", " ").slice(0, 16);
  }
}
