const codificador = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function desdeBase64url(texto: string): Uint8Array {
  const b64 = texto.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((texto.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const desdeBase64 = (texto: string): Uint8Array => desdeBase64url(texto.replace(/=+$/, ""));

export function aHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function bytesAleatorios(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export const idAleatorio = (bytes = 12): string => base64url(bytesAleatorios(bytes));

/** Token de tirada: 32 bytes aleatorios criptográficos -> 43 caracteres base64url. */
export const generarToken = (): string => base64url(bytesAleatorios(32));
export const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export async function sha256Hex(texto: string): Promise<string> {
  return aHex(await crypto.subtle.digest("SHA-256", codificador.encode(texto)));
}

/** El token tiene 256 bits de entropía, así que un SHA-256 simple basta para guardarlo (no hace falta un hash lento). */
export const hashToken = sha256Hex;

export function igualdadConstante(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a[i] ^ b[i];
  return dif === 0;
}

export async function hmacSha256(clave: string, datos: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", codificador.encode(clave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, codificador.encode(datos)));
}

/**
 * Hash de contraseña: "pbkdf2_sha256$<iteraciones>$<sal base64>$<hash base64>".
 * Se genera con `npm run hash-password` y se guarda como secreto ADMIN_PASSWORD_HASH.
 */
export async function verificarContrasena(contrasena: string, almacenado: string): Promise<boolean> {
  const partes = almacenado.trim().split("$");
  if (partes.length !== 4 || partes[0] !== "pbkdf2_sha256") return false;
  const iteraciones = Number(partes[1]);
  if (!Number.isInteger(iteraciones) || iteraciones < 1000 || iteraciones > 100_000) return false;
  const sal = desdeBase64(partes[2]);
  const esperado = desdeBase64(partes[3]);
  const clave = await crypto.subtle.importKey("raw", codificador.encode(contrasena), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: iteraciones }, clave, esperado.length * 8);
  return igualdadConstante(new Uint8Array(bits), esperado);
}

export async function generarHashContrasena(contrasena: string, iteraciones = 30_000): Promise<string> {
  const sal = bytesAleatorios(16);
  const clave = await crypto.subtle.importKey("raw", codificador.encode(contrasena), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: iteraciones }, clave, 256);
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
  return `pbkdf2_sha256$${iteraciones}$${b64(sal)}$${b64(new Uint8Array(bits))}`;
}
