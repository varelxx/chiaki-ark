import { pbkdf2Sync, randomBytes } from "node:crypto";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { generarEstaticos } from "./scripts/generar-estaticos.mjs";

// El Worker sirve CSS/JS/fuentes incrustados: se regeneran desde public/ antes de los tests.
generarEstaticos();

// Contraseña SOLO para los tests. En producción el hash se genera con `npm run hash-password`.
const CONTRASENA_TEST = "contraseña-de-pruebas-larga";
const sal = randomBytes(16);
const hash = pbkdf2Sync(CONTRASENA_TEST, sal, 1000, 32, "sha256");

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_CONTRASENA: CONTRASENA_TEST,
            ADMIN_PASSWORD_HASH: `pbkdf2_sha256$1000$${sal.toString("base64")}$${hash.toString("base64")}`,
            SESSION_SECRET: "s".repeat(48),
            BREVO_API_KEY: "clave-falsa-de-test",
            // Nunca se llama a Brevo de verdad: fetch se intercepta en los tests.
            BREVO_API_URL: "https://brevo.invalid/v3",
            WEBHOOK_SECRET: "secreto-webhook-de-pruebas",
            URL_BASE: "https://ruleta.test",
            TIENDA_NOMBRE: "Tienda de Pruebas",
            REMITENTE_EMAIL: "ruleta@tienda.test",
            CONTACTO_EMAIL: "privacidad@tienda.test",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/setup.ts"],
      testTimeout: 60_000,
    },
  };
});
