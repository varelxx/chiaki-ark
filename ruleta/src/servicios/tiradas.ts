import { AzarCripto, elegirPonderado, type FuenteAzar } from "../lib/azar";
import { FORMATO_TOKEN, generarToken, hashToken, idAleatorio } from "../lib/cripto";
import { ErrorUsuario, esRestriccion } from "../lib/errores";
import { normalizarPais } from "../lib/paises";
import { estaDisponible } from "../lib/probabilidades";
import { ahora, sumarDias } from "../lib/tiempo";
import type { Idioma, Premio, Ruleta, Tirada } from "../tipos";
import type { Config } from "./config";
import { normalizarCorreo } from "./pedidos";

export const DIAS_CADUCIDAD = 30;

export async function buscarPorToken(db: D1Database, token: string): Promise<Tirada | null> {
  if (!FORMATO_TOKEN.test(token)) return null;
  return db.prepare("SELECT * FROM tiradas WHERE token_hash = ?1").bind(await hashToken(token)).first<Tirada>();
}

export type EstadoEnlace = "valida" | "usada" | "caducada" | "revocada" | "no_enviada";

export function estadoEnlace(t: Pick<Tirada, "estado" | "expira_en">, momento = ahora()): EstadoEnlace {
  if (t.estado === "revocada") return "revocada";
  if (t.estado === "usada" || t.estado === "entregada") return "usada";
  if (!t.expira_en) return "no_enviada";
  if (t.expira_en <= momento) return "caducada";
  return "valida";
}

export async function premiosDeRuleta(db: D1Database, ruletaId: number): Promise<Premio[]> {
  const { results } = await db.prepare("SELECT * FROM premios WHERE ruleta_id = ?1 ORDER BY orden, id").bind(ruletaId).all<Premio>();
  return results;
}

export async function ruletaPorId(db: D1Database, id: number): Promise<Ruleta | null> {
  return db.prepare("SELECT * FROM ruletas WHERE id = ?1").bind(id).first<Ruleta>();
}

export async function paisesBloqueados(db: D1Database): Promise<Set<string>> {
  const { results } = await db.prepare("SELECT codigo FROM paises_bloqueados").all<{ codigo: string }>();
  return new Set(results.map((r) => r.codigo));
}

export interface OpcionesGiro {
  ip: string | null;
  ipPais: string | null;
  config: Config;
  azar?: FuenteAzar;
}

/**
 * Gira la ruleta de una tirada. El premio se decide AQUÍ, en el servidor, con un generador
 * criptográfico, antes de que el navegador anime nada.
 *
 * Todo el giro es un único lote de D1 (transacción):
 *   1. UPDATE condicional de la tirada (WHERE estado = 'pendiente'); se comprueba que afecte a 1 fila.
 *   2. Resta 1 al stock del premio (CHECK stock >= 0: si otro giro se llevó la última unidad, el lote
 *      entero se deshace y se vuelve a elegir entre los premios que quedan).
 *   3. Asigna el código de cupón libre (CHECK en tiradas: un cupón nunca se queda sin código).
 *   4. Encola el correo con el resultado.
 * Si D1 falla (p. ej. cupo diario agotado), no se aplica nada y la tirada sigue pendiente.
 */
export async function girar(db: D1Database, token: string, op: OpcionesGiro): Promise<{ tirada: Tirada; premio: Premio }> {
  const tirada = await buscarPorToken(db, token);
  if (!tirada) throw new ErrorUsuario("Enlace no válido.", 404, "enlace_invalido");
  const estado = estadoEnlace(tirada);
  if (estado === "usada") throw new ErrorUsuario("Esta tirada ya se ha usado.", 409, "ya_usada");
  if (estado === "revocada") throw new ErrorUsuario("Esta tirada fue anulada.", 410, "revocada");
  if (estado === "caducada" || estado === "no_enviada") throw new ErrorUsuario("El enlace ha caducado.", 410, "caducada");

  const bloqueados = await paisesBloqueados(db);
  const ipPais = op.ipPais ? normalizarPais(op.ipPais) : null;
  if ((tirada.pais && bloqueados.has(tirada.pais)) || (op.config.geobloqueo_ip === "1" && ipPais && bloqueados.has(ipPais))) {
    throw new ErrorUsuario("Promoción no disponible en tu país.", 403, "pais_bloqueado");
  }

  const azar = op.azar ?? new AzarCripto();
  for (let intento = 0; intento < 5; intento++) {
    const disponibles = (await premiosDeRuleta(db, tirada.ruleta_id)).filter(estaDisponible);
    const premio = elegirPonderado(disponibles, azar);
    if (!premio) throw new ErrorUsuario("No hay premios disponibles ahora mismo.", 503, "sin_premios");

    const nonce = idAleatorio();
    const momento = ahora();
    const esCupon = premio.tipo === "cupon";
    const sentencias = [
      db
        .prepare(
          `UPDATE tiradas SET estado = 'usada', usada_en = ?2, giro_nonce = ?3, premio_id = ?4, premio_nombre = ?5,
             premio_nombre_en = ?6, premio_tipo = ?7, premio_rareza = ?8, premio_coste_cents = ?9, ip = ?10, ip_pais = ?11,
             premio_imagen = ?12, premio_descripcion = ?13, premio_descripcion_en = ?14,
             cupon_codigo = CASE WHEN ?7 = 'cupon'
               THEN (SELECT codigo FROM cupones WHERE premio_id = ?4 AND tirada_id IS NULL ORDER BY id LIMIT 1) ELSE NULL END
           WHERE id = ?1 AND estado = 'pendiente' AND expira_en > ?2`,
        )
        .bind(
          tirada.id, momento, nonce, premio.id, premio.nombre, premio.nombre_en, premio.tipo, premio.rareza, premio.coste_cents, op.ip, ipPais,
          premio.imagen ?? null, premio.descripcion ?? null, premio.descripcion_en ?? null,
        ),
      db
        .prepare(
          `UPDATE premios SET stock = stock - 1
           WHERE id = ?1 AND stock IS NOT NULL AND EXISTS (SELECT 1 FROM tiradas WHERE id = ?2 AND giro_nonce = ?3)`,
        )
        .bind(premio.id, tirada.id, nonce),
      db
        .prepare(
          `INSERT INTO correos (tipo, destinatario, idioma, tirada_ids, estado, creado_en)
           SELECT 'resultado', correo, idioma, json_array(id), 'pendiente', ?3 FROM tiradas
           WHERE id = ?1 AND giro_nonce = ?2 AND correo <> ''`, // los enlaces directos no tienen correo
        )
        .bind(tirada.id, nonce, momento),
    ];
    if (esCupon) {
      sentencias.splice(
        2,
        0,
        db
          .prepare(
            `UPDATE cupones SET tirada_id = ?1, asignado_en = ?3
             WHERE tirada_id IS NULL AND codigo = (SELECT cupon_codigo FROM tiradas WHERE id = ?1 AND giro_nonce = ?2)`,
          )
          .bind(tirada.id, nonce, momento),
      );
    }

    let resultados: D1Result[];
    try {
      resultados = await db.batch(sentencias);
    } catch (e) {
      if (!esRestriccion(e)) throw e;
      // Carrera por la última unidad o bolsa de códigos desincronizada: resincronizamos y reintentamos.
      await db
        .prepare(
          `UPDATE premios SET stock = (SELECT count(*) FROM cupones c WHERE c.premio_id = premios.id AND c.tirada_id IS NULL)
           WHERE tipo = 'cupon' AND ruleta_id = ?1`,
        )
        .bind(tirada.ruleta_id)
        .run();
      continue;
    }
    if (resultados[0].meta.changes !== 1) {
      // Otro giro simultáneo con el mismo enlace llegó antes: este no hace nada.
      throw new ErrorUsuario("Esta tirada ya se ha usado.", 409, "ya_usada");
    }
    const final = await db.prepare("SELECT * FROM tiradas WHERE id = ?1").bind(tirada.id).first<Tirada>();
    return { tirada: final!, premio };
  }
  throw new ErrorUsuario("No hay premios disponibles ahora mismo.", 503, "sin_premios");
}

export interface DatosArk {
  gamertag: string;
  plataforma: string;
  discord: string;
}

/**
 * Usuario de Discord (obligatorio). Acepta el formato actual (2-32 caracteres: letras, números, «_» y
 * «.», sin dos puntos seguidos; Discord los guarda en minúsculas) y el antiguo «nombre#1234».
 * Se admite con «@» delante. Devuelve null si no es válido.
 */
export function normalizarDiscord(texto: unknown): string | null {
  const d = String(texto ?? "").trim().replace(/^@/, "");
  if (/^(?!.*\.\.)[a-z0-9_.]{2,32}$/i.test(d)) return d.toLowerCase();
  if (/^[^#@:`\s\u0000-\u001f<>](?:[^#@:`\u0000-\u001f<>]{0,30})[^#@:`\s\u0000-\u001f<>]#\d{4}$/.test(d)) return d;
  return null;
}

export function validarDatosArk(d: Partial<Record<keyof DatosArk, unknown>>, plataformasValidas: string[]): DatosArk {
  const gamertag = String(d.gamertag ?? "").trim();
  const plataforma = String(d.plataforma ?? "").trim();
  if (gamertag.length < 2 || gamertag.length > 64 || /[\u0000-\u001f<>]/.test(gamertag)) throw new ErrorUsuario("gamertag", 422, "gamertag");
  if (!plataformasValidas.includes(plataforma)) throw new ErrorUsuario("plataforma", 422, "plataforma");
  const discord = normalizarDiscord(d.discord);
  if (!discord) throw new ErrorUsuario("discord", 422, "discord");
  return { gamertag, plataforma, discord };
}

export async function guardarDatosArk(db: D1Database, token: string, datos: DatosArk): Promise<Tirada> {
  const tirada = await buscarPorToken(db, token);
  if (!tirada) throw new ErrorUsuario("Enlace no válido.", 404, "enlace_invalido");
  if (tirada.premio_tipo !== "ark") throw new ErrorUsuario("Este premio no necesita datos de entrega.", 409, "no_ark");
  if (tirada.estado !== "usada") throw new ErrorUsuario("Este premio ya se ha entregado.", 409, "entregada");
  const r = await db
    .prepare(
      `UPDATE tiradas SET ark_gamertag = ?2, ark_plataforma = ?3, ark_discord = ?4, ark_datos_en = ?5
       WHERE id = ?1 AND estado = 'usada' AND premio_tipo = 'ark'`,
    )
    .bind(tirada.id, datos.gamertag, datos.plataforma, datos.discord, ahora())
    .run();
  if (r.meta.changes !== 1) throw new ErrorUsuario("Este premio ya se ha entregado.", 409, "entregada");
  return (await db.prepare("SELECT * FROM tiradas WHERE id = ?1").bind(tirada.id).first<Tirada>())!;
}

export const MAX_ENLACES_DIRECTOS = 20;

export interface EnlacesGenerados {
  ruleta: Ruleta;
  tokens: string[];
  expira: string;
  idioma: Idioma;
}

/**
 * Enlaces directos: tiradas de una ruleta concreta, sin pedido ni correo, para que la tienda envíe
 * el enlace a mano. Cada enlace es de un solo giro y caduca a los 30 días. Como solo se guarda el
 * hash, el enlace en claro se muestra una única vez (en la respuesta del panel).
 */
export async function generarEnlacesDirectos(
  db: D1Database,
  e: { ruletaId: number; cantidad: number; idioma: unknown; nota: unknown },
): Promise<EnlacesGenerados> {
  const cantidad = Math.floor(Number(e.cantidad));
  if (!(cantidad >= 1 && cantidad <= MAX_ENLACES_DIRECTOS)) throw new ErrorUsuario(`El número de enlaces debe estar entre 1 y ${MAX_ENLACES_DIRECTOS}.`);
  const idioma: Idioma = e.idioma === "en" ? "en" : "es";
  const nota = String(e.nota ?? "").trim().slice(0, 80) || null;
  if (nota && /[\u0000-\u001f]/.test(nota)) throw new ErrorUsuario("La nota no es válida.");
  const ruleta = await ruletaPorId(db, e.ruletaId);
  if (!ruleta) throw new ErrorUsuario("Ruleta no encontrada.");

  const tokens = Array.from({ length: cantidad }, () => generarToken());
  const hashes = await Promise.all(tokens.map((tok) => hashToken(tok)));
  const momento = ahora();
  const expira = sumarDias(momento, DIAS_CADUCIDAD);
  await db
    .prepare(
      `INSERT INTO tiradas (pedido_id, correo, pais, idioma, ruleta_id, origen, estado, token_hash, expira_en, enviada_en, creada_en, nota)
       SELECT NULL, '', NULL, ?1, ?2, 'manual', 'pendiente', value, ?3, ?4, ?4, ?5 FROM json_each(?6)`,
    )
    .bind(idioma, ruleta.id, expira, momento, nota, JSON.stringify(hashes))
    .run();
  return { ruleta, tokens, expira, idioma };
}

export const MAX_TIRADAS_MANUALES = 20;

export async function anadirTiradasManuales(
  db: D1Database,
  e: { correo: unknown; ruletaId: number; cantidad: number; idioma: unknown; pais: unknown },
): Promise<{ creadas: number }> {
  const correo = normalizarCorreo(e.correo);
  if (!correo) throw new ErrorUsuario("Correo no válido.");
  const cantidad = Math.floor(Number(e.cantidad));
  if (!(cantidad >= 1 && cantidad <= MAX_TIRADAS_MANUALES)) throw new ErrorUsuario(`El número de tiradas debe estar entre 1 y ${MAX_TIRADAS_MANUALES}.`);
  const idioma: Idioma = e.idioma === "en" ? "en" : "es";
  const paisTexto = String(e.pais ?? "").trim();
  const pais = paisTexto ? normalizarPais(paisTexto) : null;
  if (paisTexto && !pais) throw new ErrorUsuario("País no válido.");
  const ruleta = await ruletaPorId(db, e.ruletaId);
  if (!ruleta) throw new ErrorUsuario("Ruleta no encontrada.");
  if (pais && (await paisesBloqueados(db)).has(pais)) throw new ErrorUsuario(`El país ${pais} está bloqueado: no se pueden dar tiradas.`, 403);

  const lote = idAleatorio();
  const momento = ahora();
  const [insertadas] = await db.batch([
    db
      .prepare(
        `INSERT INTO tiradas (pedido_id, correo, pais, idioma, ruleta_id, origen, estado, lote, creada_en)
         SELECT NULL, ?1, ?2, ?3, ?4, 'manual', 'pendiente', ?5, ?6 FROM json_each(?7)`,
      )
      .bind(correo, pais, idioma, ruleta.id, lote, momento, JSON.stringify(Array.from({ length: cantidad }, (_, i) => i))),
    db
      .prepare(
        `INSERT INTO correos (tipo, destinatario, idioma, tirada_ids, estado, creado_en, lote)
         SELECT 'enlace', ?2, ?3, json_group_array(id), 'pendiente', ?4, ?1 FROM tiradas WHERE lote = ?1`,
      )
      .bind(lote, correo, idioma, momento),
  ]);
  return { creadas: insertadas.meta.changes ?? 0 };
}

/**
 * Reenvía el enlace: encola un correo nuevo. Al enviarse se genera un token nuevo (el antiguo deja de
 * valer, porque solo guardamos su hash) y la caducidad vuelve a ser de 30 días.
 */
export async function reenviarTiradas(db: D1Database, ids: number[]): Promise<number> {
  const r = await db
    .prepare(
      `INSERT INTO correos (tipo, destinatario, idioma, tirada_ids, estado, creado_en)
       SELECT 'enlace', t.correo, t.idioma, json_group_array(t.id), 'pendiente', ?2
       FROM tiradas t
       WHERE t.id IN (SELECT value FROM json_each(?1)) AND t.estado = 'pendiente' AND t.correo <> ''
         AND NOT EXISTS (
           SELECT 1 FROM correos c, json_each(c.tirada_ids) x
           WHERE c.tipo = 'enlace' AND c.estado IN ('pendiente', 'enviando') AND x.value = t.id)
       GROUP BY t.correo, t.idioma`,
    )
    .bind(JSON.stringify(ids), ahora())
    .run();
  return r.meta.changes ?? 0;
}

export async function revocarTiradas(db: D1Database, ids: number[]): Promise<number> {
  const r = await db
    .prepare("UPDATE tiradas SET estado = 'revocada', revocada_en = ?2 WHERE id IN (SELECT value FROM json_each(?1)) AND estado = 'pendiente'")
    .bind(JSON.stringify(ids), ahora())
    .run();
  return r.meta.changes ?? 0;
}

export async function marcarEntregadas(db: D1Database, ids: number[]): Promise<number> {
  const r = await db
    .prepare(
      `UPDATE tiradas SET estado = 'entregada', entregada_en = ?2
       WHERE id IN (SELECT value FROM json_each(?1)) AND estado = 'usada' AND premio_tipo = 'ark'`,
    )
    .bind(JSON.stringify(ids), ahora())
    .run();
  return r.meta.changes ?? 0;
}

export interface FiltroHistorial {
  estado?: string;
  ruleta?: number;
  correo?: string;
  desde?: string;
  hasta?: string;
  pagina?: number;
}

export interface FilaHistorial extends Tirada {
  pedido_numero: string | null;
  ruleta_nombre: string;
  enlace_en_cola: number;
}

export const ESTADOS_FILTRO = ["pendiente", "caducada", "usada", "ark_pendiente", "entregada", "revocada"] as const;

export async function listarHistorial(db: D1Database, f: FiltroHistorial, limite = 50): Promise<{ filas: FilaHistorial[]; hayMas: boolean }> {
  const cond: string[] = [];
  const params: unknown[] = [ahora()];
  const p = (v: unknown) => {
    params.push(v);
    return `?${params.length}`;
  };
  switch (f.estado) {
    case "pendiente":
      cond.push("t.estado = 'pendiente' AND (t.expira_en IS NULL OR t.expira_en > ?1)");
      break;
    case "caducada":
      cond.push("t.estado = 'pendiente' AND t.expira_en <= ?1");
      break;
    case "ark_pendiente":
      cond.push("t.estado = 'usada' AND t.premio_tipo = 'ark'");
      break;
    case "usada":
    case "entregada":
    case "revocada":
      cond.push(`t.estado = ${p(f.estado)}`);
      break;
  }
  if (f.ruleta) cond.push(`t.ruleta_id = ${p(f.ruleta)}`);
  if (f.correo) cond.push(`t.correo = ${p(f.correo.trim().toLowerCase())}`);
  if (f.desde) cond.push(`t.creada_en >= ${p(f.desde)}`);
  if (f.hasta) cond.push(`t.creada_en < ${p(f.hasta + "T99")}`);
  const pagina = Math.max(1, f.pagina ?? 1);
  const sql = `SELECT t.*, p.numero AS pedido_numero, r.nombre AS ruleta_nombre,
      EXISTS (SELECT 1 FROM correos c, json_each(c.tirada_ids) x
              WHERE c.tipo = 'enlace' AND c.estado IN ('pendiente', 'enviando') AND x.value = t.id) AS enlace_en_cola
    FROM tiradas t LEFT JOIN pedidos p ON p.id = t.pedido_id JOIN ruletas r ON r.id = t.ruleta_id
    ${cond.length ? "WHERE " + cond.join(" AND ") : ""}
    ORDER BY t.id DESC LIMIT ${p(limite + 1)} OFFSET ${p((pagina - 1) * limite)}`;
  const { results } = await db.prepare(sql).bind(...params).all<FilaHistorial>();
  return { filas: results.slice(0, limite), hayMas: results.length > limite };
}
