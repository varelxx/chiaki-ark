import type { Child } from "hono/jsx";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { formatearEur } from "../lib/dinero";
import { formatearFecha } from "../lib/tiempo";
import { ICONOS } from "../lib/iconos";
import { leerRef, urlImagen, type RefImagen } from "../lib/medios";
import { hexDe, RAREZAS } from "../lib/rarezas";
import type { Env } from "../tipos";
import { refDe, type Imagen } from "../servicios/imagenes";
import { cookieSesion } from "../servicios/sesion";
import { LayoutAdmin, type Flash } from "../vistas/admin-base";
import { html, type Ctx } from "./util";

/** Ayudas compartidas por las páginas del panel. */

export const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
/*
 * Mensajes de aviso del panel ("Guardado", errores...). Viajan en una cookie de un solo uso, NO en la
 * URL: así nadie puede mandarte un enlace al panel que muestre un mensaje falso.
 */
export const COOKIE_FLASH = "ruleta_flash";
export const volver = (c: Ctx, ruta: string, f: Flash) => {
  setCookie(c, COOKIE_FLASH, JSON.stringify({ ok: f.ok, error: f.error }), {
    httpOnly: true,
    secure: cookieSesion(c.req.url).segura,
    sameSite: "Strict",
    path: "/admin",
    maxAge: 60,
  });
  return c.redirect(ruta, 303);
};
export const flash = (c: Ctx): Flash => {
  const valor = getCookie(c, COOKIE_FLASH);
  if (!valor) return {};
  deleteCookie(c, COOKIE_FLASH, { path: "/admin", secure: cookieSesion(c.req.url).segura });
  try {
    const f = JSON.parse(valor) as Flash;
    const limpio = (s: unknown) => (typeof s === "string" ? s.slice(0, 600) : undefined);
    return { ok: limpio(f.ok), error: limpio(f.error) };
  } catch {
    return {};
  }
};
export const fecha = (env: Env, iso: string | null | undefined) => formatearFecha(iso, env.ZONA_HORARIA);
export const eur = (cents: number) => formatearEur(cents);
export const texto = (v: unknown) => (typeof v === "string" ? v : "");
export const pagina = (c: Ctx) => Math.max(1, Number(c.req.query("pagina")) || 1);

export function vista(c: Ctx, titulo: string, contenido: Child, estado = 200, f?: Flash) {
  return html(
    c,
    <LayoutAdmin titulo={titulo} ruta={c.req.path} flash={f ?? flash(c)} tienda={c.env.TIENDA_NOMBRE}>
      {contenido}
    </LayoutAdmin>,
    estado,
  );
}


// ---------- Selectores de color e imagen ----------

/** Colores rápidos para los <input type="color"> (los navegadores que lo admiten los muestran como muestras). */
export const PaletaColores = () => (
  <datalist id="paleta-colores">
    {Object.values(RAREZAS).map((r) => (
      <option value={r.color}>{r.nombre}</option>
    ))}
    <option value="#ffffff">Blanco</option>
    <option value="#ff4fa3">Rosa</option>
    <option value="#c0c7d0">Plata</option>
  </datalist>
);

export const SelectorColor = ({ nombre, valor, form }: { nombre: string; valor: string | null; form?: string }) => (
  <input type="color" name={nombre} value={hexDe(valor)} list="paleta-colores" class="color" form={form} title="Elige cualquier color" />
);

/** Miniatura de una referencia de imagen para el panel. */
export const urlMiniatura = (ref: string | null | undefined, porDefecto: RefImagen | null): string | null => {
  const r = leerRef(ref) ?? porDefecto;
  return r ? urlImagen(r) : null;
};

/**
 * Desplegable de imagen: automática/ninguna, iconos incluidos y biblioteca. Cada opción lleva la URL
 * de su miniatura (admin.js la muestra al cambiar).
 */
export const SelectorImagen = ({
  nombre,
  valor,
  imagenes,
  vacio,
  porDefecto,
  form,
  sinIconos,
}: {
  nombre: string;
  valor: string | null;
  imagenes: Imagen[];
  vacio: { texto: string; miniatura: string | null };
  porDefecto: RefImagen | null;
  form?: string;
  sinIconos?: boolean;
}) => {
  const mini = urlMiniatura(valor, porDefecto);
  return (
    <span class="selector-imagen">
      <span class="miniatura">{mini ? <img src={mini} alt="" width={40} height={40} data-miniatura /> : <img alt="" width={40} height={40} data-miniatura hidden />}</span>
      <select name={nombre} data-vista-imagen form={form}>
        <option value="" data-src={vacio.miniatura ?? ""} selected={!valor}>
          {vacio.texto}
        </option>
        {sinIconos ? null : (
          <optgroup label="Iconos incluidos">
            {Object.entries(ICONOS).map(([k, i]) => (
              <option value={`icono:${k}`} data-src={urlImagen({ tipo: "icono", nombre: k })} selected={valor === `icono:${k}`}>
                {i.nombre}
              </option>
            ))}
          </optgroup>
        )}
        {imagenes.length ? (
          <optgroup label="Tus imágenes">
            {imagenes.map((i) => (
              <option value={refDe(i)} data-src={urlImagen({ tipo: "img", id: i.id, hash: i.hash.slice(0, 16) })} selected={valor === refDe(i)}>
                {i.nombre}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </span>
  );
};
