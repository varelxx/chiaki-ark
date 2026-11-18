import { generarToken, hashToken, idAleatorio } from "../lib/cripto";
import { mensaje } from "../lib/errores";
import { ahora, diaUtc, sumarDias, sumarMinutos } from "../lib/tiempo";
import type { Env, Idioma, Ruleta, Tirada } from "../tipos";
import { correoEnlace, correoResultado, type CorreoListo } from "../vistas/correos";
import { enteroConfig, leerConfig, pausaActiva, sentenciaConfig, type Config } from "./config";
import { DIAS_CADUCIDAD } from "./tiradas";

export const LIMITE_BREVO_GRATIS = 300;
export const UMBRAL_AVISO = 0.8;
/** Envíos por ejecución. Workers Free permite 50 subpeticiones externas por invocación. */
export const MAX_POR_EJECUCION = 25;

export interface EstadoCorreos {
  dia: string;
  enviadosHoy: number;
  limite: number;
  reserva: number;
  porcentaje: number;
  aviso: boolean;
  agotado: boolean;
  pendientes: number;
  errores: number;
  pausaHasta: string;
  pausaMotivo: string;
}

export async function estadoCorreos(db: D1Database, config: Config): Promise<EstadoCorreos> {
  const dia = diaUtc();
  const [uso, cola] = await db.batch([
    db.prepare("SELECT enviados FROM uso_correos WHERE dia = ?1").bind(dia),
    db.prepare("SELECT estado, count(*) AS n FROM correos WHERE estado IN ('pendiente', 'enviando', 'error') GROUP BY estado"),
  ]);
  const enviadosHoy = (uso.results[0] as { enviados?: number } | undefined)?.enviados ?? 0;
  const porEstado = new Map((cola.results as Array<{ estado: string; n: number }>).map((r) => [r.estado, r.n]));
  const limite = enteroConfig(config.correo_limite_diario, LIMITE_BREVO_GRATIS);
  const porcentaje = limite > 0 ? enviadosHoy / limite : 1;
  return {
    dia,
    enviadosHoy,
    limite,
    reserva: Math.min(enteroConfig(config.correo_reserva_resultados, 20), limite),
    porcentaje,
    aviso: porcentaje >= UMBRAL_AVISO,
    agotado: enviadosHoy >= limite,
    pendientes: (porEstado.get("pendiente") ?? 0) + (porEstado.get("enviando") ?? 0),
    errores: porEstado.get("error") ?? 0,
    pausaHasta: pausaActiva(config) ? config.correo_pausa_hasta : "",
    pausaMotivo: pausaActiva(config) ? config.correo_pausa_motivo : "",
  };
}

type ResultadoBrevo = { ok: true; id: string } | { ok: false; tipo: "cupo" | "clave" | "permanente" | "temporal"; detalle: string };

/** La clave sin espacios ni saltos de línea (es fácil que se cuelen al pegarla en el panel de Cloudflare). */
export const claveBrevo = (env: Env): string => (env.BREVO_API_KEY ?? "").trim();

/** Brevo tiene dos tipos de clave: la de API (xkeysib-…) y la SMTP (xsmtpsib-…). La ruleta necesita la de API. */
export const esClaveSmtp = (env: Env): boolean => claveBrevo(env).startsWith("xsmtpsib-");

export async function enviarBrevo(env: Env, para: string, correo: CorreoListo, etiqueta: string): Promise<ResultadoBrevo> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${env.BREVO_API_URL || "https://api.brevo.com/v3"}/smtp/email`, {
      method: "POST",
      headers: { "api-key": claveBrevo(env), "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: env.REMITENTE_NOMBRE || env.TIENDA_NOMBRE, email: env.REMITENTE_EMAIL?.trim() },
        to: [{ email: para }],
        subject: correo.asunto,
        htmlContent: correo.html,
        textContent: correo.texto,
        tags: [etiqueta],
      }),
    });
  } catch (e) {
    return { ok: false, tipo: "temporal", detalle: `Red: ${mensaje(e)}`.slice(0, 300) };
  }
  const cuerpo = await respuesta.text().catch(() => "");
  if (respuesta.ok) {
    let id = "";
    try {
      id = (JSON.parse(cuerpo) as { messageId?: string }).messageId ?? "";
    } catch {
      /* sin cuerpo */
    }
    return { ok: true, id };
  }
  const detalle = `HTTP ${respuesta.status}: ${cuerpo}`.slice(0, 300);
  if (respuesta.status === 401) return { ok: false, tipo: "clave", detalle };
  if (respuesta.status === 402 || /credit|quota|limit|exceed/i.test(cuerpo)) return { ok: false, tipo: "cupo", detalle };
  if (respuesta.status === 403) return { ok: false, tipo: "clave", detalle }; // p. ej. IP no autorizada en Brevo
  if (respuesta.status === 429 || respuesta.status >= 500) return { ok: false, tipo: "temporal", detalle };
  return { ok: false, tipo: "permanente", detalle };
}

interface FilaCorreo {
  id: number;
  tipo: "enlace" | "resultado";
  destinatario: string;
  idioma: Idioma;
  tirada_ids: string;
  intentos: number;
}

export interface ResultadoCola {
  enviados: number;
  fallidos: number;
  descartados: number;
  motivo?: "pausa" | "sin_clave" | "clave_smtp" | "sin_remitente" | "sin_url" | "cupo" | "vacia";
}

export const urlBase = (env: Env, config: Config): string => (env.URL_BASE || config.url_base || "").replace(/\/+$/, "");

/**
 * Envía correos pendientes respetando el cupo diario de Brevo. Primero los resultados de giros (el
 * cliente los espera al momento), después los enlaces, dejando `reserva` correos libres para
 * resultados. Lo que no cabe se queda en la cola y lo reintenta el cron (cada 10 minutos).
 */
export async function procesarCola(env: Env, opciones: { max?: number } = {}): Promise<ResultadoCola> {
  const db = env.DB;
  const config = await leerConfig(db);
  const vacio = { enviados: 0, fallidos: 0, descartados: 0 };
  if (pausaActiva(config)) return { ...vacio, motivo: "pausa" };
  if (!claveBrevo(env)) return { ...vacio, motivo: "sin_clave" };
  if (esClaveSmtp(env)) return { ...vacio, motivo: "clave_smtp" };
  if (!env.REMITENTE_EMAIL) return { ...vacio, motivo: "sin_remitente" };
  const base = urlBase(env, config);
  if (!base) return { ...vacio, motivo: "sin_url" };

  const estado = await estadoCorreos(db, config);
  const libres = estado.limite - estado.enviadosHoy;
  if (libres <= 0) return { ...vacio, motivo: "cupo" };
  const maxTotal = Math.min(opciones.max ?? MAX_POR_EJECUCION, MAX_POR_EJECUCION, libres);
  const maxEnlaces = Math.max(0, estado.limite - estado.reserva - estado.enviadosHoy);

  const momento = ahora();
  const lote = idAleatorio();
  // Reclamar correos (evita envíos dobles si el cron y el panel coinciden).
  const [, reclamoResultados] = await db.batch([
    db.prepare("UPDATE correos SET estado = 'pendiente' WHERE estado = 'enviando' AND reclamado_en < ?1").bind(sumarMinutos(momento, -15)),
    db
      .prepare(
        `UPDATE correos SET estado = 'enviando', reclamado_en = ?1, lote = ?2
         WHERE id IN (SELECT id FROM correos WHERE estado = 'pendiente' AND tipo = 'resultado' ORDER BY id LIMIT ?3)`,
      )
      .bind(momento, lote, maxTotal),
  ]);
  const huecoEnlaces = Math.min(maxEnlaces, maxTotal - (reclamoResultados.meta.changes ?? 0));
  if (huecoEnlaces > 0) {
    await db
      .prepare(
        `UPDATE correos SET estado = 'enviando', reclamado_en = ?1, lote = ?2
         WHERE id IN (SELECT id FROM correos WHERE estado = 'pendiente' AND tipo = 'enlace' ORDER BY id LIMIT ?3)`,
      )
      .bind(momento, lote, huecoEnlaces)
      .run();
  }
  const { results: correos } = await db.prepare("SELECT * FROM correos WHERE lote = ?1 AND estado = 'enviando' ORDER BY tipo DESC, id").bind(lote).all<FilaCorreo>();
  if (correos.length === 0) return { ...vacio, motivo: estado.pendientes > 0 ? "cupo" : "vacia" };

  // Cargar de una vez todas las tiradas implicadas y las ruletas.
  const idsTiradas = [...new Set(correos.flatMap((c) => JSON.parse(c.tirada_ids) as number[]))];
  const [tiradasRes, ruletasRes] = await db.batch([
    db
      .prepare("SELECT t.*, p.numero AS pedido_numero FROM tiradas t LEFT JOIN pedidos p ON p.id = t.pedido_id WHERE t.id IN (SELECT value FROM json_each(?1))")
      .bind(JSON.stringify(idsTiradas)),
    db.prepare("SELECT * FROM ruletas"),
  ]);
  const tiradas = new Map((tiradasRes.results as unknown as Array<Tirada & { pedido_numero: string | null }>).map((t) => [t.id, t]));
  const ruletas = new Map((ruletasRes.results as unknown as Ruleta[]).map((r) => [r.id, r]));

  // Generar tokens nuevos para los enlaces. Se guardan (hasheados) ANTES de enviar: así el cliente nunca
  // recibe un enlace que no funcione. Si el envío falla, el próximo intento genera otro.
  const expira = sumarDias(momento, DIAS_CADUCIDAD);
  const tokens = new Map<number, string>();
  for (const c of correos) {
    if (c.tipo !== "enlace") continue;
    for (const id of JSON.parse(c.tirada_ids) as number[]) {
      if (tiradas.get(id)?.estado === "pendiente") tokens.set(id, generarToken());
    }
  }
  if (tokens.size) {
    const hashes = await Promise.all([...tokens].map(async ([id, tok]) => ({ id, h: await hashToken(tok) })));
    await db
      .prepare(
        `UPDATE tiradas SET token_hash = (SELECT j.value->>'h' FROM json_each(?1) j WHERE j.value->>'id' = tiradas.id), expira_en = ?2
         WHERE id IN (SELECT j.value->>'id' FROM json_each(?1) j) AND estado = 'pendiente'`,
      )
      .bind(JSON.stringify(hashes), expira)
      .run();
  }

  const finales: D1PreparedStatement[] = [];
  const res = { ...vacio };
  let parar: { tipo: "cupo" | "clave"; detalle: string } | null = null;

  for (const c of correos) {
    if (parar) {
      finales.push(db.prepare("UPDATE correos SET estado = 'pendiente' WHERE id = ?1").bind(c.id));
      continue;
    }
    const ids = JSON.parse(c.tirada_ids) as number[];
    let listo: CorreoListo | null = null;
    if (c.tipo === "enlace") {
      const enlaces = ids
        .filter((id) => tokens.has(id))
        .map((id) => ({ url: `${base}/tirada/${tokens.get(id)}`, ruleta: ruletas.get(tiradas.get(id)!.ruleta_id)!, pedido: tiradas.get(id)!.pedido_numero }));
      if (enlaces.length) listo = correoEnlace(env, base, c.idioma, enlaces, expira);
    } else {
      const t = tiradas.get(ids[0]);
      if (t && t.premio_id) listo = correoResultado(env, base, t, ruletas.get(t.ruleta_id)!, t.pedido_numero);
    }
    if (!c.destinatario.includes("@")) listo = null; // enlaces directos (sin correo) o datos borrados por RGPD
    if (!listo) {
      // Las tiradas se revocaron o ya se usaron: no hay nada que enviar.
      finales.push(db.prepare("UPDATE correos SET estado = 'descartado', ultimo_error = 'Sin tiradas pendientes' WHERE id = ?1").bind(c.id));
      res.descartados++;
      continue;
    }
    const r = await enviarBrevo(env, c.destinatario, listo, `ruleta-${c.tipo}`);
    if (r.ok) {
      res.enviados++;
      finales.push(
        db.prepare("UPDATE correos SET estado = 'enviado', enviado_en = ?2, brevo_id = ?3, intentos = intentos + 1, ultimo_error = NULL WHERE id = ?1").bind(c.id, ahora(), r.id),
      );
      if (c.tipo === "enlace") {
        finales.push(
          db
            .prepare("UPDATE tiradas SET enviada_en = ?2 WHERE id IN (SELECT value FROM json_each(?1)) AND estado = 'pendiente'")
            .bind(JSON.stringify(ids.filter((id) => tokens.has(id))), ahora()),
        );
      }
      continue;
    }
    res.fallidos++;
    if (r.tipo === "cupo" || r.tipo === "clave") {
      parar = { tipo: r.tipo, detalle: r.detalle };
      finales.push(db.prepare("UPDATE correos SET estado = 'pendiente', ultimo_error = ?2 WHERE id = ?1").bind(c.id, r.detalle));
      continue;
    }
    const maxIntentos = r.tipo === "permanente" ? 3 : 10;
    finales.push(
      db
        .prepare("UPDATE correos SET intentos = intentos + 1, ultimo_error = ?2, estado = CASE WHEN intentos + 1 >= ?3 THEN 'error' ELSE 'pendiente' END WHERE id = ?1")
        .bind(c.id, r.detalle, maxIntentos),
    );
  }

  if (res.enviados) {
    finales.push(
      db
        .prepare("INSERT INTO uso_correos (dia, enviados) VALUES (?1, ?2) ON CONFLICT (dia) DO UPDATE SET enviados = enviados + excluded.enviados")
        .bind(diaUtc(), res.enviados),
    );
  }
  if (parar) {
    // Pausa de 1 hora: si es el cupo de Brevo, se reanuda sola; si es la clave/IP, avisa en el panel.
    finales.push(sentenciaConfig(db, "correo_pausa_hasta", sumarMinutos(ahora(), 60)));
    finales.push(sentenciaConfig(db, "correo_pausa_motivo", (parar.tipo === "cupo" ? "Brevo indica cupo agotado. " : "Brevo rechaza la clave API o la IP. ") + parar.detalle));
  }
  if (finales.length) await db.batch(finales);
  return parar?.tipo === "cupo" ? { ...res, motivo: "cupo" } : res;
}

export async function reintentarCorreos(db: D1Database, ids: number[] | "errores"): Promise<number> {
  const r =
    ids === "errores"
      ? await db.prepare("UPDATE correos SET estado = 'pendiente', intentos = 0 WHERE estado = 'error'").run()
      : await db.prepare("UPDATE correos SET estado = 'pendiente', intentos = 0 WHERE id IN (SELECT value FROM json_each(?1)) AND estado = 'error'").bind(JSON.stringify(ids)).run();
  return r.meta.changes ?? 0;
}

export async function descartarCorreos(db: D1Database, ids: number[]): Promise<number> {
  const r = await db
    .prepare("UPDATE correos SET estado = 'descartado' WHERE id IN (SELECT value FROM json_each(?1)) AND estado IN ('error', 'pendiente')")
    .bind(JSON.stringify(ids))
    .run();
  return r.meta.changes ?? 0;
}

export async function quitarPausa(db: D1Database): Promise<void> {
  await db.batch([sentenciaConfig(db, "correo_pausa_hasta", ""), sentenciaConfig(db, "correo_pausa_motivo", "")]);
}
