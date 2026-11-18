import { base64url, desdeBase64url, hmacSha256, igualdadConstante } from "../lib/cripto";
import { ahora, sumarMinutos } from "../lib/tiempo";
import type { Env } from "../tipos";

export const COOKIE_SESION = "__Host-ruleta_admin";
export const DURACION_SESION_H = 12;

/**
 * En producción (workers.dev siempre es HTTPS) se usa una cookie "__Host-" con Secure. Solo en
 * desarrollo local por HTTP (wrangler dev) se usa otro nombre sin Secure, porque los navegadores
 * rechazan cookies Secure/__Host- en http://.
 */
export function cookieSesion(url: string): { nombre: string; segura: boolean } {
  const segura = new URL(url).protocol === "https:";
  return { nombre: segura ? COOKIE_SESION : "ruleta_admin_local", segura };
}

/** Cookie de sesión sin estado: carga útil + HMAC-SHA256 con SESSION_SECRET. */
export async function crearSesion(env: Env): Promise<string> {
  if (!env.SESSION_SECRET) throw new Error("Falta el secreto SESSION_SECRET");
  const carga = base64url(new TextEncoder().encode(JSON.stringify({ exp: Date.now() + DURACION_SESION_H * 3_600_000 })));
  const firma = base64url(await hmacSha256(env.SESSION_SECRET, carga));
  return `${carga}.${firma}`;
}

export async function sesionValida(env: Env, valor: string | undefined): Promise<boolean> {
  if (!valor || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return false;
  const [carga, firma] = valor.split(".");
  if (!carga || !firma) return false;
  const esperada = await hmacSha256(env.SESSION_SECRET, carga);
  let recibida: Uint8Array;
  try {
    recibida = desdeBase64url(firma);
  } catch {
    return false;
  }
  if (!igualdadConstante(esperada, recibida)) return false;
  try {
    const { exp } = JSON.parse(new TextDecoder().decode(desdeBase64url(carga))) as { exp: number };
    return typeof exp === "number" && exp > Date.now();
  } catch {
    return false;
  }
}

export const MAX_FALLOS_IP = 5;
export const MAX_FALLOS_GLOBAL = 50;
export const VENTANA_MIN = 15;

/** Limita los intentos de contraseña: 5 fallos por IP y 50 en total cada 15 minutos. */
export async function loginBloqueado(db: D1Database, ip: string): Promise<boolean> {
  const desde = sumarMinutos(ahora(), -VENTANA_MIN);
  const [porIp, total] = await db.batch([
    db.prepare("SELECT count(*) AS n FROM intentos_login WHERE ip = ?1 AND creado_en > ?2").bind(ip, desde),
    db.prepare("SELECT count(*) AS n FROM intentos_login WHERE creado_en > ?1").bind(desde),
  ]);
  return (porIp.results[0] as { n: number }).n >= MAX_FALLOS_IP || (total.results[0] as { n: number }).n >= MAX_FALLOS_GLOBAL;
}

export async function registrarFallo(db: D1Database, ip: string): Promise<void> {
  await db.prepare("INSERT INTO intentos_login (ip, creado_en) VALUES (?1, ?2)").bind(ip, ahora()).run();
}
