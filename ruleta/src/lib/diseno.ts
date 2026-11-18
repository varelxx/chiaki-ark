import { ErrorUsuario } from "./errores";
import { leerRef, refTexto } from "./medios";

/** Diseño de una ruleta (columna JSON ruletas.diseno). Todo es opcional: lo que falta toma el valor por defecto. */

export const MARCOS = { metal: "Metal remachado", oro: "Oro pulido", neon: "Neón", obsidiana: "Obsidiana y lava" } as const;
export const ETIQUETAS = { ambos: "Imagen y texto", imagen: "Solo imagen (más grande)", texto: "Solo texto" } as const;
export const FONDOS = { reticula: "Retícula táctica", volcan: "Volcán al atardecer", aurora: "Cielo nocturno con aurora", liso: "Liso" } as const;

export type Marco = keyof typeof MARCOS;
export type ModoEtiquetas = keyof typeof ETIQUETAS;
export type FondoPredefinido = keyof typeof FONDOS;

export const CAMPOS_TEXTO = {
  antetitulo: 40,
  antetitulo_en: 40,
  titulo: 80,
  titulo_en: 80,
  intro: 300,
  intro_en: 300,
  boton: 24,
  boton_en: 24,
} as const;
export type CampoTexto = keyof typeof CAMPOS_TEXTO;

export interface Diseno {
  marco: Marco;
  luces: boolean;
  etiquetas: ModoEtiquetas;
  /** "" = garra por defecto; si no, referencia de imagen (icono o biblioteca). */
  centro: string;
  /** Fondo predefinido o referencia «img:...» de la biblioteca. */
  fondo: string;
  /** Oscurecido de la imagen de fondo, 0-90 %. */
  fondo_oscuro: number;
  sonido: boolean;
  confeti: boolean;
  /** Duración del giro en segundos. */
  duracion: number;
  textos: Record<CampoTexto, string>;
}

export const DURACION_MIN = 3;
export const DURACION_MAX = 12;

export const DISENO_POR_DEFECTO: Diseno = {
  marco: "metal",
  luces: true,
  etiquetas: "ambos",
  centro: "",
  fondo: "reticula",
  fondo_oscuro: 55,
  sonido: true,
  confeti: true,
  duracion: 7,
  textos: Object.fromEntries(Object.keys(CAMPOS_TEXTO).map((k) => [k, ""])) as Record<CampoTexto, string>,
};

const limpiarTexto = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const entero = (v: unknown, min: number, max: number, defecto: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defecto;
};

const esRefValida = (v: unknown) => typeof v === "string" && leerRef(v) !== null;

/** Lee el JSON guardado sin fallar nunca: lo que no sea válido vuelve al valor por defecto. */
export function leerDiseno(json: string | null | undefined): Diseno {
  let o: Record<string, unknown> = {};
  try {
    const v = JSON.parse(json || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) o = v;
  } catch {
    /* JSON roto: valores por defecto */
  }
  const d = DISENO_POR_DEFECTO;
  const textosIn = (o.textos && typeof o.textos === "object" ? o.textos : {}) as Record<string, unknown>;
  return {
    marco: typeof o.marco === "string" && o.marco in MARCOS ? (o.marco as Marco) : d.marco,
    luces: typeof o.luces === "boolean" ? o.luces : d.luces,
    etiquetas: typeof o.etiquetas === "string" && o.etiquetas in ETIQUETAS ? (o.etiquetas as ModoEtiquetas) : d.etiquetas,
    centro: esRefValida(o.centro) ? (o.centro as string) : "",
    fondo: typeof o.fondo === "string" && (o.fondo in FONDOS || /^img:/.test(o.fondo) && esRefValida(o.fondo)) ? o.fondo : d.fondo,
    fondo_oscuro: entero(o.fondo_oscuro, 0, 90, d.fondo_oscuro),
    sonido: typeof o.sonido === "boolean" ? o.sonido : d.sonido,
    confeti: typeof o.confeti === "boolean" ? o.confeti : d.confeti,
    duracion: entero(o.duracion, DURACION_MIN, DURACION_MAX, d.duracion),
    textos: Object.fromEntries(
      (Object.entries(CAMPOS_TEXTO) as Array<[CampoTexto, number]>).map(([k, max]) => [k, limpiarTexto(textosIn[k], max)]),
    ) as Record<CampoTexto, string>,
  };
}

/**
 * Convierte los campos del formulario del panel en un diseño. Las referencias a la biblioteca se
 * devuelven aparte para que el servicio compruebe que existen.
 */
export function disenoDesdeFormulario(f: Record<string, unknown>): { diseno: Diseno; imagenes: Array<{ id: number; hash: string }> } {
  const marco = String(f.marco ?? "");
  const etiquetas = String(f.etiquetas ?? "");
  const centro = String(f.centro ?? "");
  const fondo = String(f.fondo ?? "");
  const refCentro = centro ? leerRef(centro) : null;
  if (centro && !refCentro) throw new ErrorUsuario("La imagen del centro no es válida.");
  const refFondo = fondo in FONDOS ? null : leerRef(fondo);
  if (!(fondo in FONDOS) && (!refFondo || refFondo.tipo !== "img")) throw new ErrorUsuario("El fondo elegido no es válido.");
  const imagenes = [refCentro, refFondo].filter((r): r is { tipo: "img"; id: number; hash: string } => r?.tipo === "img").map(({ id, hash }) => ({ id, hash }));
  const diseno: Diseno = {
    marco: marco in MARCOS ? (marco as Marco) : DISENO_POR_DEFECTO.marco,
    luces: f.luces === "1",
    etiquetas: etiquetas in ETIQUETAS ? (etiquetas as ModoEtiquetas) : DISENO_POR_DEFECTO.etiquetas,
    centro: refCentro ? refTexto(refCentro) : "",
    fondo: refFondo ? refTexto(refFondo) : fondo,
    fondo_oscuro: entero(f.fondo_oscuro, 0, 90, DISENO_POR_DEFECTO.fondo_oscuro),
    sonido: f.sonido === "1",
    confeti: f.confeti === "1",
    duracion: entero(f.duracion, DURACION_MIN, DURACION_MAX, DISENO_POR_DEFECTO.duracion),
    textos: Object.fromEntries(
      (Object.entries(CAMPOS_TEXTO) as Array<[CampoTexto, number]>).map(([k, max]) => [k, limpiarTexto(f[`texto_${k}`], max)]),
    ) as Record<CampoTexto, string>,
  };
  return { diseno, imagenes };
}
