import { base64url, desdeBase64url, generarHashContrasena, hmacSha256, igualdadConstante, verificarContrasena } from "../lib/cripto";
import { ErrorUsuario } from "../lib/errores";
import { ahora, sumarMinutos } from "../lib/tiempo";
import type { Env } from "../tipos";
import { sentenciaConfig, type Config } from "./config";

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

/**
 * Cookie de sesión sin estado: carga útil + HMAC-SHA256 con SESSION_SECRET. La carga lleva la
 * «versión de sesión» guardada en D1: al cambiar la contraseña o pulsar «cerrar todas las sesiones»
 * la versión cambia y todas las cookies anteriores dejan de valer.
 */
export async function crearSesion(env: Env, version: string): Promise<string> {
  if (!env.SESSION_SECRET) throw new Error("Falta el secreto SESSION_SECRET");
  const carga = base64url(new TextEncoder().encode(JSON.stringify({ exp: Date.now() + DURACION_SESION_H * 3_600_000, v: version })));
  const firma = base64url(await hmacSha256(env.SESSION_SECRET, carga));
  return `${carga}.${firma}`;
}

export async function sesionValida(env: Env, valor: string | undefined, version: string): Promise<boolean> {
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
    const { exp, v } = JSON.parse(new TextDecoder().decode(desdeBase64url(carga))) as { exp: number; v?: string };
    return typeof exp === "number" && exp > Date.now() && v === version;
  } catch {
    return false;
  }
}

/** Hash activo: el cambiado desde el panel (en D1) tiene prioridad sobre el secreto inicial. */
export const hashActivo = (env: Env, config: Config): string => config.admin_hash || env.ADMIN_PASSWORD_HASH || "";

export const panelConfigurado = (env: Env, config: Config): boolean =>
  !!hashActivo(env, config) && !!env.SESSION_SECRET && env.SESSION_SECRET.length >= 32;

export const MIN_LONGITUD_CONTRASENA = 12;
/** Algo menos que el script (30.000) para que verificar la actual + generar la nueva quepa en el CPU del plan gratuito. */
export const ITERACIONES_PANEL = 20_000;

/**
 * Cambia la contraseña del panel. Pide la actual, exige 12+ caracteres y cierra todas las sesiones
 * (sube la versión). Devuelve la nueva versión de sesión para reemitir la cookie de quien la cambia.
 */
export async function cambiarContrasena(env: Env, config: Config, actual: string, nueva: string, repetida: string): Promise<string> {
  if (!(await verificarContrasena(actual, hashActivo(env, config)))) throw new ErrorUsuario("La contraseña actual no es correcta.", 401);
  if (nueva !== repetida) throw new ErrorUsuario("Las dos contraseñas nuevas no coinciden.");
  if ([...nueva].length < MIN_LONGITUD_CONTRASENA) throw new ErrorUsuario(`La contraseña nueva debe tener al menos ${MIN_LONGITUD_CONTRASENA} caracteres.`);
  if (nueva === actual) throw new ErrorUsuario("La contraseña nueva debe ser distinta de la actual.");
  const hash = await generarHashContrasena(nueva, ITERACIONES_PANEL);
  const version = nuevaVersion(config);
  await env.DB.batch([sentenciaConfig(env.DB, "admin_hash", hash), sentenciaConfig(env.DB, "sesion_version", version)]);
  return version;
}

const nuevaVersion = (config: Config): string => String((Number(config.sesion_version) || 1) + 1);

/** «Cerrar sesión en todos los dispositivos»: invalida todas las cookies emitidas hasta ahora. */
export async function cerrarTodasLasSesiones(db: D1Database, config: Config): Promise<string> {
  const version = nuevaVersion(config);
  await sentenciaConfig(db, "sesion_version", version).run();
  return version;
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

export async function fallosRecientes(db: D1Database, horas = 24): Promise<number> {
  const r = await db.prepare("SELECT count(*) AS n FROM intentos_login WHERE creado_en > ?1").bind(sumarMinutos(ahora(), -horas * 60)).first<{ n: number }>();
  return r?.n ?? 0;
}
