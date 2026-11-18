import { ICONOS, VERSION_ICONOS } from "./iconos";

/**
 * Referencias a imágenes guardadas en premios y diseños:
 *   «icono:<nombre>»       → icono incluido
 *   «img:<id>:<hash16>»    → imagen de la biblioteca (el hash va en la URL: caché de un año)
 * Vacío o NULL → imagen automática (según el tipo de premio).
 */
export type RefImagen = { tipo: "icono"; nombre: string } | { tipo: "img"; id: number; hash: string };

export function leerRef(ref: string | null | undefined): RefImagen | null {
  if (!ref) return null;
  const icono = /^icono:([a-z]+)$/.exec(ref);
  if (icono && ICONOS[icono[1]]) return { tipo: "icono", nombre: icono[1] };
  const img = /^img:(\d{1,10}):([0-9a-f]{16})$/.exec(ref);
  if (img) return { tipo: "img", id: Number(img[1]), hash: img[2] };
  return null;
}

export const refTexto = (r: RefImagen): string => (r.tipo === "icono" ? `icono:${r.nombre}` : `img:${r.id}:${r.hash}`);

/** Icono por defecto de cada tipo de premio. */
export const iconoPorTipo = (tipo: string | null | undefined): string => (tipo === "cupon" ? "cupon" : "caja");

/** Imagen efectiva de un premio: la elegida o, si no hay, el icono de su tipo. */
export function imagenDePremio(p: { imagen?: string | null; tipo?: string | null }): RefImagen {
  return leerRef(p.imagen) ?? { tipo: "icono", nombre: iconoPorTipo(p.tipo) };
}

/** URL de una imagen. Los iconos admiten color (sin «#»); las imágenes de la biblioteca no. */
export function urlImagen(r: RefImagen, color?: string): string {
  if (r.tipo === "img") return `/img/${r.id}-${r.hash}`;
  const c = color && /^#[0-9a-f]{6}$/.test(color) ? `c=${color.slice(1)}&` : "";
  return `/icono/${r.nombre}.svg?${c}v=${VERSION_ICONOS}`;
}

// ---------- Validación de archivos subidos ----------

export const TIPOS_IMAGEN = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type TipoImagen = (typeof TIPOS_IMAGEN)[number];
export const MAX_BYTES_IMAGEN = 1_000_000;
/** Tope de la biblioteca: deja sitio de sobra en la base de datos gratuita (500 MB). */
export const MAX_BYTES_BIBLIOTECA = 200_000_000;

/**
 * Tipo real del archivo según sus primeros bytes («números mágicos»). Nunca nos fiamos del nombre ni
 * del tipo que diga el navegador: así no se puede colar un SVG o un HTML con código.
 */
export function detectarTipoImagen(b: Uint8Array): TipoImagen | null {
  const empieza = (...bytes: number[]) => bytes.every((x, i) => b[i] === x);
  if (b.length >= 8 && empieza(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (b.length >= 3 && empieza(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (b.length >= 6 && (empieza(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || empieza(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))) return "image/gif";
  if (b.length >= 12 && empieza(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

/** Nombre legible a partir del nombre del archivo: sin extensión ni caracteres raros, máx. 60. */
export function nombreImagen(archivo: string): string {
  const base = archivo.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[\u0000-\u001f<>"'`\\]/g, "").replace(/[_-]+/g, " ").trim();
  return (base || "imagen").slice(0, 60);
}

export function aBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function deBase64(texto: string): ArrayBuffer {
  const bin = atob(texto);
  const buf = new ArrayBuffer(bin.length);
  const v = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) v[i] = bin.charCodeAt(i);
  return buf;
}
