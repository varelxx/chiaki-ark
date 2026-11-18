import { Hono } from "hono";
import { svgIcono, VERSION_ICONOS } from "../lib/iconos";
import { deBase64 } from "../lib/medios";
import { leerImagen } from "../servicios/imagenes";
import type { App } from "./util";

/** Imágenes de la biblioteca (/img/<id>-<hash>) e iconos incluidos (/icono/<nombre>.svg). */
export const medios = new Hono<App>();

const UN_ANO = "public, max-age=31536000, immutable";

medios.on(["GET", "HEAD"], "/img/:clave{[0-9]{1,10}-[0-9a-f]{16}}", async (c) => {
  const [id, hash] = c.req.param("clave").split("-");
  const etag = `"${hash}"`;
  const cabeceras = {
    "cache-control": UN_ANO,
    etag,
    // Se pueden ver desde otros sitios (p. ej. clientes de correo); son imágenes públicas de premios.
    "cross-origin-resource-policy": "cross-origin",
  };
  if (c.req.header("if-none-match") === etag) return c.body(null, 304, cabeceras);
  const img = await leerImagen(c.env.DB, Number(id));
  if (!img || !img.hash.startsWith(hash)) return c.text("No encontrada", 404);
  return c.body(deBase64(img.datos), 200, { ...cabeceras, "content-type": img.tipo, "content-disposition": "inline" });
});

medios.on(["GET", "HEAD"], "/icono/:archivo{[a-z]+\\.svg}", (c) => {
  const nombre = c.req.param("archivo").slice(0, -4);
  const color = /^[0-9a-f]{6}$/.test(c.req.query("c") ?? "") ? `#${c.req.query("c")}` : "#ffffff";
  const svg = svgIcono(nombre, color);
  if (!svg) return c.text("No encontrado", 404);
  return c.body(svg, 200, {
    "content-type": "image/svg+xml",
    "cache-control": c.req.query("v") === VERSION_ICONOS ? UN_ANO : "public, max-age=3600",
    "cross-origin-resource-policy": "cross-origin",
  });
});
