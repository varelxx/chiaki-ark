import { Hono } from "hono";
import { ESTATICOS } from "../estaticos.generado";
import type { App } from "./util";

/**
 * Sirve CSS, JS, fuentes e icono incrustados en el Worker (ver scripts/generar-estaticos.mjs).
 * Las páginas los enlazan con ?v=<hash>, así que el navegador los guarda un año y solo
 * vuelve a pedirlos cuando cambian: casi no gastan peticiones del plan gratuito.
 */
export const estaticos = new Hono<App>();

const binarios = new Map<string, ArrayBuffer>();

function bytesDe(url: string, base64: string): ArrayBuffer {
  let b = binarios.get(url);
  if (!b) {
    const bin = atob(base64);
    b = new ArrayBuffer(bin.length);
    const vista = new Uint8Array(b);
    for (let i = 0; i < bin.length; i++) vista[i] = bin.charCodeAt(i);
    binarios.set(url, b);
  }
  return b;
}

estaticos.on(["GET", "HEAD"], "*", async (c, next) => {
  const e = ESTATICOS[c.req.path];
  if (!e) return next();
  const etag = `"${e.hash}"`;
  const versionado = c.req.query("v") === e.hash || c.req.path.startsWith("/fonts/");
  const cabeceras = {
    "content-type": e.tipo,
    etag,
    "cache-control": versionado ? "public, max-age=31536000, immutable" : "public, max-age=3600",
  };
  if (c.req.header("if-none-match") === etag) return c.body(null, 304, cabeceras);
  return c.body(e.binario ? bytesDe(c.req.path, e.contenido) : e.contenido, 200, cabeceras);
});

/** URL con la versión del archivo, para que la caché del navegador se renueve al cambiarlo. */
export const urlEstatico = (ruta: string): string => {
  const e = ESTATICOS[ruta];
  return e ? `${ruta}?v=${e.hash}` : ruta;
};
