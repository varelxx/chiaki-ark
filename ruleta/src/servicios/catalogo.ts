import { parsearEurACents, parsearPorcentajeAPeso } from "../lib/dinero";
import { ErrorUsuario } from "../lib/errores";
import { normalizarPais } from "../lib/paises";
import type { Diseno } from "../lib/diseno";
import { leerRef, refTexto } from "../lib/medios";
import { ajustarA100, PESO_TOTAL } from "../lib/probabilidades";
import { normalizarColor } from "../lib/rarezas";
import { ahora } from "../lib/tiempo";
import type { Premio, Ruleta } from "../tipos";
import { comprobarImagenes } from "./imagenes";

// ---------- Ruletas / tramos ----------

export async function listarRuletas(db: D1Database): Promise<Ruleta[]> {
  return (await db.prepare("SELECT * FROM ruletas ORDER BY umbral_cents, id").all<Ruleta>()).results;
}

export interface EntradaRuleta {
  id?: number;
  nombre: string;
  nombre_en: string;
  umbral: string;
  limite: string;
  activa: boolean;
}

function validarRuleta(e: EntradaRuleta) {
  const nombre = e.nombre.trim();
  const nombre_en = e.nombre_en.trim() || nombre;
  if (!nombre || nombre.length > 80) throw new ErrorUsuario("Cada ruleta necesita un nombre (máx. 80 caracteres).");
  const umbral = parsearEurACents(e.umbral);
  const limite = parsearEurACents(e.limite);
  if (!umbral || umbral <= 0) throw new ErrorUsuario(`Importe mínimo no válido en «${nombre}».`);
  if (limite === null) throw new ErrorUsuario(`Límite de coste no válido en «${nombre}».`);
  return { nombre, nombre_en, umbral, limite, activa: e.activa ? 1 : 0 };
}

/** Colores con los que nacen las ruletas nuevas (luego se cambian en Diseño). */
const COLORES_NUEVAS = ["#b37bff", "#3fe0d0", "#ff9a2e", "#ff5a4f", "#f5c542", "#4a9dff", "#5fd068"];

function comprobarUmbrales(activas: Array<{ id?: number; umbral: number; activa: number }>) {
  const umbrales = activas.filter((v) => v.activa).map((v) => v.umbral);
  if (new Set(umbrales).size !== umbrales.length) throw new ErrorUsuario("Dos ruletas activas no pueden tener el mismo importe mínimo.");
}

export async function guardarRuletas(db: D1Database, filas: EntradaRuleta[]): Promise<void> {
  const validas = filas.map((f) => ({ id: f.id, ...validarRuleta(f) }));
  const actuales = await listarRuletas(db);
  // Las ruletas que no vienen en el formulario también cuentan para la regla de umbrales.
  const enviadas = new Set(validas.map((v) => v.id).filter(Boolean));
  comprobarUmbrales([...validas, ...actuales.filter((r) => !enviadas.has(r.id)).map((r) => ({ id: r.id, umbral: r.umbral_cents, activa: r.activa }))]);
  const color = COLORES_NUEVAS[actuales.length % COLORES_NUEVAS.length];
  await db.batch(
    validas.map((v) =>
      v.id
        ? db
            .prepare("UPDATE ruletas SET nombre = ?2, nombre_en = ?3, umbral_cents = ?4, limite_coste_cents = ?5, activa = ?6 WHERE id = ?1")
            .bind(v.id, v.nombre, v.nombre_en, v.umbral, v.limite, v.activa)
        : db
            .prepare("INSERT INTO ruletas (nombre, nombre_en, color, color2, umbral_cents, limite_coste_cents, activa, diseno) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, '{}')")
            .bind(v.nombre, v.nombre_en, color, v.umbral, v.limite, v.activa),
    ),
  );
}

/** Guarda colores y diseño de una ruleta (página Diseño del panel). */
export async function guardarDiseno(
  db: D1Database,
  ruletaId: number,
  e: { color: unknown; color2: unknown; diseno: Diseno; imagenes: Array<{ id: number; hash: string }> },
): Promise<void> {
  const color = normalizarColor(e.color);
  if (!color) throw new ErrorUsuario("El color principal no es válido.");
  const color2 = e.color2 ? normalizarColor(e.color2) : null;
  if (e.color2 && !color2) throw new ErrorUsuario("El segundo color no es válido.");
  await comprobarImagenes(db, e.imagenes);
  const r = await db
    .prepare("UPDATE ruletas SET color = ?2, color2 = ?3, diseno = ?4 WHERE id = ?1")
    .bind(ruletaId, color, color2, JSON.stringify(e.diseno))
    .run();
  if (!r.meta.changes) throw new ErrorUsuario("Ruleta no encontrada.");
}

/**
 * Copia una ruleta con sus premios y su diseño. La copia nace desactivada (para no chocar con el
 * importe mínimo de la original) y sin códigos de cupón: los códigos son de un solo uso.
 */
export async function duplicarRuleta(db: D1Database, ruletaId: number): Promise<number> {
  const r = await db
    .prepare(
      `INSERT INTO ruletas (nombre, nombre_en, color, color2, umbral_cents, limite_coste_cents, activa, diseno)
       SELECT substr(nombre || ' (copia)', 1, 80), substr(nombre_en || ' (copy)', 1, 80), color, color2, umbral_cents, limite_coste_cents, 0, diseno
       FROM ruletas WHERE id = ?1 RETURNING id`,
    )
    .bind(ruletaId)
    .first<{ id: number }>();
  if (!r) throw new ErrorUsuario("Ruleta no encontrada.");
  await db
    .prepare(
      `INSERT INTO premios (ruleta_id, nombre, nombre_en, tipo, rareza, peso, stock, coste_cents, activo, orden, imagen, descripcion, descripcion_en)
       SELECT ?2, nombre, nombre_en, tipo, rareza, peso, CASE WHEN tipo = 'cupon' THEN 0 ELSE stock END, coste_cents, activo, orden, imagen, descripcion, descripcion_en
       FROM premios WHERE ruleta_id = ?1 AND (activo = 1 OR peso > 0)`,
    )
    .bind(ruletaId, r.id)
    .run();
  return r.id;
}

/** Borra una ruleta que nunca se ha usado (sin pedidos ni tiradas). Si se usó, solo se puede desactivar. */
export async function eliminarRuleta(db: D1Database, ruletaId: number): Promise<void> {
  const usada = await db
    .prepare("SELECT EXISTS (SELECT 1 FROM tiradas WHERE ruleta_id = ?1) OR EXISTS (SELECT 1 FROM pedidos WHERE ruleta_id = ?1) AS usada")
    .bind(ruletaId)
    .first<{ usada: number }>();
  if (usada?.usada) throw new ErrorUsuario("Esta ruleta ya tiene pedidos o tiradas: no se puede borrar (sí desactivar, para conservar el historial).");
  await db.batch([
    db.prepare("DELETE FROM cupones WHERE premio_id IN (SELECT id FROM premios WHERE ruleta_id = ?1)").bind(ruletaId),
    db.prepare("DELETE FROM premios WHERE ruleta_id = ?1").bind(ruletaId),
    db.prepare("DELETE FROM ruletas WHERE id = ?1").bind(ruletaId),
  ]);
}


// ---------- Premios ----------

export interface EntradaPremio {
  id?: number;
  nombre: string;
  nombre_en: string;
  tipo?: string;
  rareza: string; // color: clave de rareza o #rrggbb
  peso: string;   // "45" o "2,5" (%)
  stock: string;  // "" = ilimitado (solo premios ARK)
  coste: string;  // €
  activo: boolean;
  orden: string;
  imagen?: string;         // "" = automática, «icono:...» o «img:...»
  descripcion?: string;
  descripcion_en?: string;
}

export const MAX_DESCRIPCION = 160;

function limpiarDescripcion(v: string | undefined, nombre: string): string | null {
  const d = String(v ?? "").replace(/\s+/g, " ").trim();
  if (d.length > MAX_DESCRIPCION) throw new ErrorUsuario(`La descripción de «${nombre}» es demasiado larga (máx. ${MAX_DESCRIPCION} caracteres).`);
  if (/[\u0000-\u001f]/.test(d)) throw new ErrorUsuario(`La descripción de «${nombre}» no es válida.`);
  return d || null;
}

function validarPremio(e: EntradaPremio) {
  const nombre = e.nombre.trim();
  const nombre_en = e.nombre_en.trim() || nombre;
  if (!nombre || nombre.length > 80) throw new ErrorUsuario("Cada premio necesita un nombre (máx. 80 caracteres).");
  const peso = parsearPorcentajeAPeso(e.peso || "0");
  if (peso === null) throw new ErrorUsuario(`Probabilidad no válida en «${nombre}» (usa un porcentaje entre 0 y 100, hasta 2 decimales).`);
  const coste = parsearEurACents(e.coste || "0");
  if (coste === null) throw new ErrorUsuario(`Coste no válido en «${nombre}».`);
  const stockTxt = e.stock.trim();
  const stock = stockTxt === "" ? null : Number(stockTxt);
  if (stock !== null && !(Number.isInteger(stock) && stock >= 0)) throw new ErrorUsuario(`Stock no válido en «${nombre}» (déjalo vacío para ilimitado).`);
  const rareza = normalizarColor(e.rareza);
  if (!rareza) throw new ErrorUsuario(`Color no válido en «${nombre}».`);
  const orden = Number(e.orden) || 0;
  const refTxt = String(e.imagen ?? "").trim();
  const ref = refTxt ? leerRef(refTxt) : null;
  if (refTxt && !ref) throw new ErrorUsuario(`La imagen de «${nombre}» no es válida.`);
  return {
    nombre,
    nombre_en,
    peso,
    coste,
    stock,
    rareza,
    activo: e.activo ? 1 : 0,
    orden,
    imagen: ref ? refTexto(ref) : null,
    refImg: ref?.tipo === "img" ? { id: ref.id, hash: ref.hash } : null,
    descripcion: limpiarDescripcion(e.descripcion, nombre),
    descripcion_en: limpiarDescripcion(e.descripcion_en, nombre),
  };
}

/**
 * Guarda todos los premios de una ruleta. Exige que los activos sumen exactamente 100 %, salvo con
 * `ajustar`, que reparte las probabilidades proporcionalmente hasta sumar 100 %.
 */
export async function guardarPremios(db: D1Database, ruletaId: number, filas: EntradaPremio[], opciones: { ajustar?: boolean } = {}): Promise<void> {
  const actuales = new Map((await db.prepare("SELECT * FROM premios WHERE ruleta_id = ?1").bind(ruletaId).all<Premio>()).results.map((p) => [p.id, p]));
  const validas = filas.map((f) => {
    const actual = f.id ? actuales.get(f.id) : undefined;
    if (!actual) throw new ErrorUsuario("Premio no encontrado en esta ruleta.");
    return { id: f.id!, tipo: actual.tipo, ...validarPremio(f) };
  });
  if (opciones.ajustar) {
    const pesos = ajustarA100(validas.map((v) => v.peso), validas.map((v) => v.activo === 1));
    validas.forEach((v, i) => (v.peso = pesos[i]));
  }
  const suma = validas.reduce((s, v) => s + (v.activo ? v.peso : 0), 0);
  if (suma !== PESO_TOTAL) {
    throw new ErrorUsuario(
      `Los premios activos deben sumar 100 %; ahora suman ${(suma / 100).toLocaleString("es-ES")} %. No se ha guardado nada. Puedes pulsar «Ajustar a 100 % y guardar».`,
      422,
    );
  }
  await comprobarImagenes(db, validas.map((v) => v.refImg).filter((r): r is { id: number; hash: string } => r !== null));
  await db.batch(
    validas.map((v) =>
      db
        .prepare(
          `UPDATE premios SET nombre = ?2, nombre_en = ?3, rareza = ?4, peso = ?5, coste_cents = ?6, activo = ?7, orden = ?8,
             imagen = ?9, descripcion = ?10, descripcion_en = ?11,
             -- En los cupones el stock lo marca la bolsa de códigos: no se edita a mano.
             stock = CASE WHEN tipo = 'cupon' THEN stock ELSE ?12 END
           WHERE id = ?1`,
        )
        .bind(v.id, v.nombre, v.nombre_en, v.rareza, v.peso, v.coste, v.activo, v.orden, v.imagen, v.descripcion, v.descripcion_en, v.stock),
    ),
  );
}

/** Crea un premio con probabilidad 0 % (no rompe la suma); luego se reparte en la tabla. */
export async function crearPremio(db: D1Database, ruletaId: number, e: EntradaPremio): Promise<void> {
  if (e.tipo !== "cupon" && e.tipo !== "ark") throw new ErrorUsuario("Tipo de premio no válido.");
  const v = validarPremio({ ...e, peso: "0" });
  const ruleta = await db.prepare("SELECT id FROM ruletas WHERE id = ?1").bind(ruletaId).first();
  if (!ruleta) throw new ErrorUsuario("Ruleta no encontrada.");
  if (v.refImg) await comprobarImagenes(db, [v.refImg]);
  await db
    .prepare(
      `INSERT INTO premios (ruleta_id, nombre, nombre_en, tipo, rareza, peso, stock, coste_cents, activo, orden, imagen, descripcion, descripcion_en)
       VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, 1, ?8, ?9, ?10, ?11)`,
    )
    .bind(ruletaId, v.nombre, v.nombre_en, e.tipo, v.rareza, e.tipo === "cupon" ? 0 : v.stock, v.coste, v.orden, v.imagen, v.descripcion, v.descripcion_en)
    .run();
}

/** Borra un premio que nunca ha tocado; si ya salió en alguna tirada solo se desactiva (para el historial). */
export async function eliminarPremio(db: D1Database, premioId: number): Promise<"borrado" | "desactivado"> {
  const usado = await db.prepare("SELECT 1 FROM tiradas WHERE premio_id = ?1 LIMIT 1").bind(premioId).first();
  if (usado) {
    await db.prepare("UPDATE premios SET activo = 0, peso = 0 WHERE id = ?1").bind(premioId).run();
    return "desactivado";
  }
  await db.batch([
    db.prepare("DELETE FROM cupones WHERE premio_id = ?1 AND tirada_id IS NULL").bind(premioId),
    db.prepare("DELETE FROM premios WHERE id = ?1").bind(premioId),
  ]);
  return "borrado";
}

const sentenciaResync = (db: D1Database, premioId: number) =>
  db.prepare("UPDATE premios SET stock = (SELECT count(*) FROM cupones WHERE premio_id = ?1 AND tirada_id IS NULL) WHERE id = ?1 AND tipo = 'cupon'").bind(premioId);

export const MAX_CODIGOS = 5000;

export async function importarCupones(db: D1Database, premioId: number, texto: string): Promise<{ insertados: number; repetidos: number; invalidos: number }> {
  const premio = await db.prepare("SELECT tipo FROM premios WHERE id = ?1").bind(premioId).first<{ tipo: string }>();
  if (!premio || premio.tipo !== "cupon") throw new ErrorUsuario("Ese premio no es de tipo cupón.");
  const lineas = texto.split(/[\r\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const validos = [...new Set(lineas.filter((c) => /^[A-Za-z0-9_\-.]{3,64}$/.test(c)))];
  const invalidos = lineas.filter((c) => !/^[A-Za-z0-9_\-.]{3,64}$/.test(c)).length;
  if (validos.length > MAX_CODIGOS) throw new ErrorUsuario(`Máximo ${MAX_CODIGOS} códigos por importación.`);
  if (validos.length === 0) throw new ErrorUsuario("No hay códigos válidos (letras, números, guiones; de 3 a 64 caracteres).");
  const momento = ahora();
  const trozos: string[][] = [];
  for (let i = 0; i < validos.length; i += 500) trozos.push(validos.slice(i, i + 500));
  const res = await db.batch([
    ...trozos.map((t) =>
      db.prepare("INSERT OR IGNORE INTO cupones (premio_id, codigo, creado_en) SELECT ?1, value, ?2 FROM json_each(?3)").bind(premioId, momento, JSON.stringify(t)),
    ),
    sentenciaResync(db, premioId),
  ]);
  const insertados = res.slice(0, trozos.length).reduce((s, r) => s + (r.meta.changes ?? 0), 0);
  return { insertados, repetidos: lineas.length - invalidos - insertados, invalidos };
}

export async function eliminarCuponesLibres(db: D1Database, premioId: number): Promise<number> {
  const [r] = await db.batch([db.prepare("DELETE FROM cupones WHERE premio_id = ?1 AND tirada_id IS NULL").bind(premioId), sentenciaResync(db, premioId)]);
  return r.meta.changes ?? 0;
}

export async function resumenCupones(db: D1Database, ruletaId: number): Promise<Map<number, { libres: number; usados: number }>> {
  const { results } = await db
    .prepare(
      `SELECT c.premio_id, sum(c.tirada_id IS NULL) AS libres, sum(c.tirada_id IS NOT NULL) AS usados
       FROM cupones c JOIN premios p ON p.id = c.premio_id WHERE p.ruleta_id = ?1 GROUP BY c.premio_id`,
    )
    .bind(ruletaId)
    .all<{ premio_id: number; libres: number; usados: number }>();
  return new Map(results.map((r) => [r.premio_id, { libres: r.libres, usados: r.usados }]));
}

// ---------- Tipos de cambio ----------

export interface TipoCambio {
  moneda: string;
  por_eur: number;
  actualizado_en: string;
  fuente: string;
}

export async function listarTipos(db: D1Database): Promise<TipoCambio[]> {
  return (await db.prepare("SELECT * FROM tipos_cambio ORDER BY moneda").all<TipoCambio>()).results;
}

export function validarTipo(moneda: string, valor: string): { moneda: string; porEur: number } {
  const m = moneda.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(m) || m === "EUR") throw new ErrorUsuario("Moneda no válida (código ISO de 3 letras distinto de EUR).");
  const v = Number(valor.trim().replace(",", "."));
  if (!(v > 0 && v < 1e9)) throw new ErrorUsuario(`Tipo de cambio no válido para ${m}.`);
  return { moneda: m, porEur: v };
}

export async function guardarTipos(db: D1Database, tipos: Array<{ moneda: string; porEur: number }>, fuente: string): Promise<void> {
  if (!tipos.length) return;
  const momento = ahora();
  await db.batch(
    tipos.map((t) =>
      db
        .prepare(
          `INSERT INTO tipos_cambio (moneda, por_eur, actualizado_en, fuente) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (moneda) DO UPDATE SET por_eur = excluded.por_eur, actualizado_en = excluded.actualizado_en, fuente = excluded.fuente`,
        )
        .bind(t.moneda, t.porEur, momento, fuente),
    ),
  );
}

export async function eliminarTipo(db: D1Database, moneda: string): Promise<void> {
  await db.prepare("DELETE FROM tipos_cambio WHERE moneda = ?1").bind(moneda).run();
}

export const URL_BCE = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

/** Tipos de referencia diarios del Banco Central Europeo (gratis, sin clave). */
export function interpretarXmlBce(xml: string): { fecha: string; tipos: Array<{ moneda: string; porEur: number }> } {
  const fecha = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1] ?? "";
  const tipos: Array<{ moneda: string; porEur: number }> = [];
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g)) {
    const v = Number(m[2]);
    if (v > 0) tipos.push({ moneda: m[1], porEur: v });
  }
  if (!tipos.length) throw new ErrorUsuario("La respuesta del BCE no tiene el formato esperado.", 503);
  return { fecha, tipos };
}

export async function descargarTiposBce(): Promise<{ fecha: string; tipos: Array<{ moneda: string; porEur: number }> }> {
  let r: Response;
  try {
    r = await fetch(URL_BCE, { headers: { accept: "application/xml" } });
  } catch {
    throw new ErrorUsuario("No se pudo conectar con el BCE. Inténtalo más tarde.", 503);
  }
  if (!r.ok) throw new ErrorUsuario(`El BCE respondió con un error (${r.status}).`, 503);
  return interpretarXmlBce(await r.text());
}

// ---------- Países bloqueados ----------

export async function listarBloqueados(db: D1Database): Promise<Array<{ codigo: string; creado_en: string }>> {
  return (await db.prepare("SELECT * FROM paises_bloqueados ORDER BY codigo").all<{ codigo: string; creado_en: string }>()).results;
}

export async function bloquearPais(db: D1Database, codigo: string): Promise<string> {
  const c = normalizarPais(codigo);
  if (!c) throw new ErrorUsuario("Código de país no válido.");
  await db.prepare("INSERT OR IGNORE INTO paises_bloqueados (codigo, creado_en) VALUES (?1, ?2)").bind(c, ahora()).run();
  return c;
}

export async function desbloquearPais(db: D1Database, codigo: string): Promise<void> {
  await db.prepare("DELETE FROM paises_bloqueados WHERE codigo = ?1").bind(codigo.toUpperCase()).run();
}
