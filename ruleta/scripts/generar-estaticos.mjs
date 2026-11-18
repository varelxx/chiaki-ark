#!/usr/bin/env node
// Incrusta los archivos de public/ (CSS, JS, fuentes, icono) en src/estaticos.generado.ts para que el
// propio Worker los sirva. Así el despliegue es un único script, sin el servicio aparte de "assets".
// Se ejecuta solo: lo lanzan wrangler (build.command), vitest y `npm run typecheck`.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLICO = join(RAIZ, "public");
const SALIDA = join(RAIZ, "src", "estaticos.generado.ts");

const TIPOS = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
const BINARIOS = new Set([".woff2"]);

function listar(dir) {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? listar(ruta) : [ruta];
  });
}

export function generarEstaticos() {
  const entradas = listar(PUBLICO)
    .filter((ruta) => TIPOS[extname(ruta)])
    .sort()
    .map((ruta) => {
      const bytes = readFileSync(ruta);
      const ext = extname(ruta);
      const url = "/" + relative(PUBLICO, ruta).split(sep).join("/");
      const binario = BINARIOS.has(ext);
      return {
        url,
        tipo: TIPOS[ext],
        hash: createHash("sha256").update(bytes).digest("hex").slice(0, 12),
        binario,
        contenido: binario ? bytes.toString("base64") : bytes.toString("utf8"),
      };
    });
  const cuerpo = entradas
    .map((e) => `  ${JSON.stringify(e.url)}: { tipo: ${JSON.stringify(e.tipo)}, hash: ${JSON.stringify(e.hash)}, binario: ${e.binario}, contenido: ${JSON.stringify(e.contenido)} },`)
    .join("\n");
  const codigo = `// ARCHIVO GENERADO por scripts/generar-estaticos.mjs a partir de public/. No lo edites a mano.
export interface Estatico {
  tipo: string;
  hash: string;
  binario: boolean;
  contenido: string;
}

export const ESTATICOS: Record<string, Estatico> = {
${cuerpo}
};
`;
  let anterior = "";
  try {
    anterior = readFileSync(SALIDA, "utf8");
  } catch {
    /* primera vez */
  }
  if (anterior !== codigo) writeFileSync(SALIDA, codigo);
  return entradas.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(`Estáticos incrustados: ${generarEstaticos()} archivos -> src/estaticos.generado.ts`);
}
