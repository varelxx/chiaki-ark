import { ahora, diaUtc, sumarDias } from "../lib/tiempo";
import type { Env, Pedido, Tirada } from "../tipos";
import { enteroConfig, leerConfig, sentenciaConfig } from "./config";
import { normalizarCorreo } from "./pedidos";

/** Recorta una IP: IPv4 -> a.b.c.0 ; IPv6 -> primeros 48 bits (3 grupos) + "::". */
export function recortarIp(ip: string): string {
  if (ip.includes(".") && !ip.includes(":")) {
    const p = ip.split(".");
    return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0` : "";
  }
  if (ip.includes(":")) {
    const grupos = ip.split("::")[0].split(":").filter(Boolean).slice(0, 3);
    return grupos.join(":") + "::";
  }
  return "";
}

/**
 * Tareas diarias (las lanza el cron la primera vez que corre cada día UTC):
 *  - recorta las IPs de giros con más de N días (90 por defecto);
 *  - borra intentos de inicio de sesión antiguos;
 *  - anonimiza destinatarios de correos ya enviados hace más de N días;
 *  - limpia contadores diarios viejos.
 */
export async function mantenimientoDiario(env: Env, forzar = false): Promise<boolean> {
  const db = env.DB;
  const config = await leerConfig(db);
  const hoy = diaUtc();
  if (!forzar && config.mantenimiento_ultimo === hoy) return false;
  const momento = ahora();
  const dias = enteroConfig(config.anonimizar_ip_dias, 90);
  const corte = sumarDias(momento, -dias);

  const { results } = await db
    .prepare("SELECT id, ip FROM tiradas WHERE ip IS NOT NULL AND usada_en < ?1 AND ip NOT LIKE '%.0' AND ip NOT LIKE '%::' LIMIT 2000")
    .bind(corte)
    .all<{ id: number; ip: string }>();
  const recortes = results.map((r) => ({ id: r.id, ip: recortarIp(r.ip) || null }));

  await db.batch([
    ...(recortes.length
      ? [
          db
            .prepare("UPDATE tiradas SET ip = (SELECT j.value->>'ip' FROM json_each(?1) j WHERE j.value->>'id' = tiradas.id) WHERE id IN (SELECT j.value->>'id' FROM json_each(?1) j)")
            .bind(JSON.stringify(recortes)),
        ]
      : []),
    db.prepare("DELETE FROM intentos_login WHERE creado_en < ?1").bind(sumarDias(momento, -1)),
    db.prepare("UPDATE correos SET destinatario = '[anonimizado]' WHERE estado IN ('enviado', 'descartado') AND creado_en < ?1 AND destinatario <> '[anonimizado]'").bind(corte),
    db.prepare("DELETE FROM uso_correos WHERE dia < ?1").bind(diaUtc(sumarDias(momento, -400))),
    sentenciaConfig(db, "mantenimiento_ultimo", hoy),
  ]);
  return true;
}

export interface DatosPersona {
  correo: string;
  pedidos: Pedido[];
  tiradas: Tirada[];
  correos: number;
}

/** Derecho de acceso (RGPD): todo lo que guardamos de un correo. */
export async function datosDePersona(db: D1Database, correoTexto: string): Promise<DatosPersona | null> {
  const correo = normalizarCorreo(correoTexto);
  if (!correo) return null;
  const [pedidos, tiradas, correos] = await db.batch([
    db.prepare("SELECT * FROM pedidos WHERE correo = ?1 ORDER BY id").bind(correo),
    db.prepare("SELECT * FROM tiradas WHERE correo = ?1 ORDER BY id").bind(correo),
    db.prepare("SELECT count(*) AS n FROM correos WHERE destinatario = ?1").bind(correo),
  ]);
  return {
    correo,
    pedidos: pedidos.results as unknown as Pedido[],
    tiradas: tiradas.results as unknown as Tirada[],
    correos: (correos.results[0] as { n: number }).n,
  };
}

/**
 * Derecho de supresión (RGPD). Se borran los datos personales y se conserva solo lo necesario para
 * la contabilidad de premios: el número de pedido (para que no pueda volver a importarse y dar otra
 * tirada), importes, ruleta, premio y coste. Las tiradas pendientes se anulan.
 */
export async function borrarDatosDePersona(db: D1Database, correoTexto: string): Promise<{ pedidos: number; tiradas: number; correos: number }> {
  const correo = normalizarCorreo(correoTexto);
  if (!correo) return { pedidos: 0, tiradas: 0, correos: 0 };
  const momento = ahora();
  const [tiradas, pedidos, correos] = await db.batch([
    db
      .prepare(
        `UPDATE tiradas SET correo = '[borrado]', ip = NULL, ip_pais = NULL, ark_gamertag = NULL, ark_plataforma = NULL,
           ark_discord = NULL, token_hash = NULL, borrado_en = ?2,
           estado = CASE WHEN estado = 'pendiente' THEN 'revocada' ELSE estado END,
           revocada_en = CASE WHEN estado = 'pendiente' THEN ?2 ELSE revocada_en END
         WHERE correo = ?1`,
      )
      .bind(correo, momento),
    db.prepare("UPDATE pedidos SET correo = '[borrado]' WHERE correo = ?1").bind(correo),
    db.prepare("UPDATE correos SET destinatario = '[borrado]', estado = CASE WHEN estado IN ('pendiente', 'enviando', 'error') THEN 'descartado' ELSE estado END WHERE destinatario = ?1").bind(correo),
  ]);
  return { pedidos: pedidos.meta.changes ?? 0, tiradas: tiradas.meta.changes ?? 0, correos: correos.meta.changes ?? 0 };
}
