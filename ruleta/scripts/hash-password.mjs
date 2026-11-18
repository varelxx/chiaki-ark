#!/usr/bin/env node
// Genera el valor de ADMIN_PASSWORD_HASH (PBKDF2-SHA256) y un SESSION_SECRET aleatorio.
//
//   npm run hash-password              -> crea una contraseña aleatoria fuerte (recomendado) y su hash
//   npm run hash-password -- --leer    -> lee tu propia contraseña por la entrada estándar
//
// 30.000 iteraciones: unos 5 ms de CPU en Workers (el plan gratuito permite ~10 ms por petición).
// Con una contraseña aleatoria de 24+ caracteres, el número de iteraciones apenas importa.
import { randomBytes, webcrypto } from "node:crypto";
import { createInterface } from "node:readline";

const ITERACIONES = 30_000;

async function hash(contrasena) {
  const sal = randomBytes(16);
  const clave = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(contrasena), "PBKDF2", false, ["deriveBits"]);
  const bits = await webcrypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: ITERACIONES }, clave, 256);
  return `pbkdf2_sha256$${ITERACIONES}$${sal.toString("base64")}$${Buffer.from(bits).toString("base64")}`;
}

async function leer() {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const linea = await new Promise((ok) => rl.question("Contraseña (mínimo 16 caracteres): ", ok));
  rl.close();
  return String(linea).trim();
}

const propia = process.argv.includes("--leer");
const contrasena = propia ? await leer() : randomBytes(18).toString("base64url");
if (contrasena.length < 16) {
  console.error("La contraseña debe tener al menos 16 caracteres.");
  process.exit(1);
}

console.log("");
if (!propia) console.log(`Contraseña del panel (guárdala en tu gestor de contraseñas):\n  ${contrasena}\n`);
console.log(`ADMIN_PASSWORD_HASH:\n  ${await hash(contrasena)}\n`);
console.log(`SESSION_SECRET (aleatorio, 48 caracteres):\n  ${randomBytes(36).toString("base64url")}\n`);
console.log("Súbelos con:\n  npx wrangler secret put ADMIN_PASSWORD_HASH\n  npx wrangler secret put SESSION_SECRET");
