import { ErrorUsuario } from "../lib/errores";
import { aBase64, detectarTipoImagen, MAX_BYTES_BIBLIOTECA, MAX_BYTES_IMAGEN, nombreImagen } from "../lib/medios";
import { ahora } from "../lib/tiempo";

/** Biblioteca de imágenes del panel (logos, premios, fondos). Se guardan en D1 en base64. */

export interface Imagen {
  id: number;
  nombre: string;
  tipo: string;
  tamano: number;
  hash: string;
  creada_en: string;
}

export const refDe = (i: Pick<Imagen, "id" | "hash">) => `img:${i.id}:${i.hash.slice(0, 16)}`;

export async function listarImagenes(db: D1Database): Promise<Imagen[]> {
  return (await db.prepare("SELECT id, nombre, tipo, tamano, hash, creada_en FROM imagenes ORDER BY id DESC").all<Imagen>()).results;
}

export async function espacioUsado(db: D1Database): Promise<{ bytes: number; total: number }> {
  const r = await db.prepare("SELECT coalesce(sum(tamano), 0) AS bytes, count(*) AS total FROM imagenes").first<{ bytes: number; total: number }>();
  return { bytes: r?.bytes ?? 0, total: r?.total ?? 0 };
}

export interface ResultadoSubida {
  subidas: number;
  repetidas: number;
  errores: string[];
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Guarda los archivos válidos. Cada uno se comprueba por su contenido (PNG, JPEG, WebP o GIF; máx. 1 MB). */
export async function subirImagenes(db: D1Database, archivos: File[]): Promise<ResultadoSubida> {
  const res: ResultadoSubida = { subidas: 0, repetidas: 0, errores: [] };
  if (!archivos.length) throw new ErrorUsuario("No has elegido ninguna imagen.");
  if (archivos.length > 50) throw new ErrorUsuario("Sube como máximo 50 imágenes cada vez.");
  let { bytes: usado } = await espacioUsado(db);
  for (const archivo of archivos) {
    const nombre = nombreImagen(archivo.name || "imagen");
    if (archivo.size > MAX_BYTES_IMAGEN) {
      res.errores.push(`«${nombre}» pesa más de 1 MB (con JavaScript activado el panel la reduce sola antes de subirla).`);
      continue;
    }
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const tipo = detectarTipoImagen(bytes);
    if (!tipo || bytes.length === 0) {
      res.errores.push(`«${nombre}» no es una imagen PNG, JPEG, WebP o GIF.`);
      continue;
    }
    if (usado + bytes.length > MAX_BYTES_BIBLIOTECA) {
      res.errores.push(`No queda espacio en la biblioteca para «${nombre}» (máx. ${MAX_BYTES_BIBLIOTECA / 1_000_000} MB). Borra imágenes que no uses.`);
      continue;
    }
    const hash = await sha256Hex(bytes);
    const r = await db
      .prepare("INSERT OR IGNORE INTO imagenes (nombre, tipo, datos, tamano, hash, creada_en) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
      .bind(nombre, tipo, aBase64(bytes), bytes.length, hash, ahora())
      .run();
    if (r.meta.changes) {
      res.subidas++;
      usado += bytes.length;
    } else res.repetidas++;
  }
  return res;
}

export async function renombrarImagen(db: D1Database, id: number, nombre: string): Promise<void> {
  const limpio = nombreImagen(nombre);
  await db.prepare("UPDATE imagenes SET nombre = ?2 WHERE id = ?1").bind(id, limpio).run();
}

/** Dónde se usa cada imagen (premios y diseños de ruleta). */
export async function usosDeImagenes(db: D1Database): Promise<Map<number, string[]>> {
  const [premios, ruletas] = await Promise.all([
    db.prepare("SELECT p.nombre, p.imagen, r.nombre AS ruleta FROM premios p JOIN ruletas r ON r.id = p.ruleta_id WHERE p.imagen LIKE 'img:%'").all<{ nombre: string; imagen: string; ruleta: string }>(),
    db.prepare("SELECT nombre, diseno FROM ruletas WHERE diseno LIKE '%img:%'").all<{ nombre: string; diseno: string }>(),
  ]);
  const usos = new Map<number, string[]>();
  const anotar = (ref: string, texto: string) => {
    const m = /^img:(\d+):/.exec(ref);
    if (!m) return;
    const id = Number(m[1]);
    usos.set(id, [...(usos.get(id) ?? []), texto]);
  };
  for (const p of premios.results) anotar(p.imagen, `premio «${p.nombre}» (${p.ruleta})`);
  for (const r of ruletas.results) {
    for (const m of r.diseno.matchAll(/"(centro|fondo)":"(img:\d+:[0-9a-f]{16})"/g)) anotar(m[2], `${m[1] === "centro" ? "centro" : "fondo"} de «${r.nombre}»`);
  }
  return usos;
}

/**
 * Borra una imagen que no esté en uso. Las tiradas antiguas que la mostraban dejan de mostrarla
 * (el resto del historial no cambia).
 */
export async function eliminarImagen(db: D1Database, id: number): Promise<void> {
  const usos = (await usosDeImagenes(db)).get(id);
  if (usos?.length) throw new ErrorUsuario(`No se puede borrar: se usa en ${usos.join(", ")}. Cámbiala allí primero.`);
  await db.batch([
    db.prepare("UPDATE tiradas SET premio_imagen = NULL WHERE premio_imagen LIKE ?1").bind(`img:${id}:%`),
    db.prepare("DELETE FROM imagenes WHERE id = ?1").bind(id),
  ]);
}

/** Comprueba que las referencias de la biblioteca existen (al guardar premios o diseños). */
export async function comprobarImagenes(db: D1Database, refs: Array<{ id: number; hash: string }>): Promise<void> {
  if (!refs.length) return;
  const ids = [...new Set(refs.map((r) => r.id))];
  const { results } = await db
    .prepare("SELECT id, hash FROM imagenes WHERE id IN (SELECT value FROM json_each(?1))")
    .bind(JSON.stringify(ids))
    .all<{ id: number; hash: string }>();
  const hashes = new Map(results.map((r) => [r.id, r.hash.slice(0, 16)]));
  for (const r of refs) if (hashes.get(r.id) !== r.hash) throw new ErrorUsuario("Una de las imágenes elegidas ya no existe en la biblioteca.");
}

export async function leerImagen(db: D1Database, id: number): Promise<{ tipo: string; datos: string; hash: string } | null> {
  return db.prepare("SELECT tipo, datos, hash FROM imagenes WHERE id = ?1").bind(id).first<{ tipo: string; datos: string; hash: string }>();
}
