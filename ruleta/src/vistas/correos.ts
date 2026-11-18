import { t, nombreSegun } from "../lib/i18n";
import { rareza } from "../lib/rarezas";
import { formatearFecha } from "../lib/tiempo";
import type { Env, Idioma, Tirada } from "../tipos";

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface CorreoListo {
  asunto: string;
  html: string;
  texto: string;
}

function envoltorio(env: Env, urlBase: string, idioma: Idioma, cuerpo: string): string {
  const tienda = esc(env.TIENDA_NOMBRE);
  const terminos = `<a href="${esc(urlBase)}/legal/terminos?lang=${idioma}" style="color:#9fb4a0">${esc(t(idioma, "terminos"))}</a>`;
  const privacidad = `<a href="${esc(urlBase)}/legal/privacidad?lang=${idioma}" style="color:#9fb4a0">${esc(t(idioma, "privacidad"))}</a>`;
  return `<!doctype html><html lang="${idioma}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="dark light"></head>
<body style="margin:0;padding:0;background:#0e110e;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e6e9e2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0e110e"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#161b16;border:1px solid #2b332b;border-radius:10px">
<tr><td style="padding:20px 24px;border-bottom:1px solid #2b332b;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#9fb4a0">${tienda} · ${esc(t(idioma, "cabecera"))}</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55;color:#e6e9e2">${cuerpo}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #2b332b;font-size:12px;line-height:1.5;color:#8a948a">${t(idioma, "c_pie", { tienda, terminos, privacidad })}<br>${esc(t(idioma, "aviso_marca", { tienda: env.TIENDA_NOMBRE }))}</td></tr>
</table></td></tr></table></body></html>`;
}

const boton = (href: string, texto: string, color: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:${color};color:#0e110e;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:6px;letter-spacing:1px;text-transform:uppercase">${esc(texto)}</a>`;

export function correoEnlace(
  env: Env,
  urlBase: string,
  idioma: Idioma,
  enlaces: Array<{ url: string; ruleta: { nombre: string; nombre_en: string; color: string } }>,
  expira: string,
): CorreoListo {
  const n = enlaces.length;
  const tienda = env.TIENDA_NOMBRE;
  const fecha = formatearFecha(expira, env.ZONA_HORARIA, idioma, false);
  const asunto = n === 1 ? t(idioma, "c_enlace_asunto", { tienda }) : t(idioma, "c_enlace_asunto_n", { tienda, n });
  const bloques = enlaces
    .map((e, i) => {
      const nombre = nombreSegun(idioma, e.ruleta);
      return `<p style="margin:18px 0 6px;font-weight:600">${esc(n > 1 ? t(idioma, "c_tirada_n", { i: i + 1, ruleta: nombre }) : nombre)}</p>
<p style="margin:0 0 8px">${boton(e.url, t(idioma, "c_boton"), rareza(e.ruleta.color).color)}</p>
<p style="margin:0;font-size:12px;color:#8a948a;word-break:break-all">${esc(e.url)}</p>`;
    })
    .join("");
  const cuerpo = `<p style="margin:0 0 12px">${esc(t(idioma, "c_hola"))}</p>
<p style="margin:0 0 4px">${esc(n === 1 ? t(idioma, "c_enlace_texto", { tienda }) : t(idioma, "c_enlace_texto_n", { tienda, n }))}</p>
${bloques}
<p style="margin:20px 0 0;font-size:13px;color:#b9c2b6">${esc(t(idioma, "c_caduca", { fecha }))}</p>`;
  const texto = [
    t(idioma, "c_hola"),
    n === 1 ? t(idioma, "c_enlace_texto", { tienda }) : t(idioma, "c_enlace_texto_n", { tienda, n }),
    ...enlaces.map((e, i) => `${n > 1 ? t(idioma, "c_tirada_n", { i: i + 1, ruleta: nombreSegun(idioma, e.ruleta) }) + ": " : ""}${e.url}`),
    t(idioma, "c_caduca", { fecha }),
    `${urlBase}/legal/terminos?lang=${idioma}`,
  ].join("\n\n");
  return { asunto, html: envoltorio(env, urlBase, idioma, cuerpo), texto };
}

export function correoResultado(env: Env, urlBase: string, tirada: Tirada, ruleta: { nombre: string; nombre_en: string }): CorreoListo {
  const idioma = tirada.idioma;
  const premio = nombreSegun(idioma, { nombre: tirada.premio_nombre, nombre_en: tirada.premio_nombre_en });
  const color = rareza(tirada.premio_rareza).color;
  const asunto = t(idioma, "c_resultado_asunto", { premio });
  let detalle = "";
  let detalleTexto = "";
  if (tirada.premio_tipo === "cupon" && tirada.cupon_codigo) {
    detalle = `<p style="margin:16px 0 6px">${esc(t(idioma, "c_resultado_cupon"))}</p>
<p style="margin:0 0 8px;font-family:Consolas,Menlo,monospace;font-size:22px;letter-spacing:2px;color:${color};border:1px dashed ${color};padding:10px 14px;display:inline-block">${esc(tirada.cupon_codigo)}</p>
<p style="margin:0">${esc(t(idioma, "cupon_uso", { tienda: env.TIENDA_NOMBRE }))}${env.TIENDA_URL ? ` <a href="${esc(env.TIENDA_URL)}" style="color:${color}">${esc(env.TIENDA_URL)}</a>` : ""}</p>`;
    detalleTexto = `${t(idioma, "c_resultado_cupon")} ${tirada.cupon_codigo}\n${t(idioma, "cupon_uso", { tienda: env.TIENDA_NOMBRE })}`;
  } else if (tirada.premio_tipo === "ark") {
    const clave = tirada.ark_datos_en ? "c_resultado_ark_ok" : "c_resultado_ark";
    detalle = `<p style="margin:16px 0 0">${esc(t(idioma, clave))}</p>`;
    detalleTexto = t(idioma, clave);
  }
  const cuerpo = `<p style="margin:0 0 12px">${esc(t(idioma, "c_hola"))}</p>
<p style="margin:0 0 10px">${esc(t(idioma, "c_resultado_texto", { ruleta: nombreSegun(idioma, ruleta) }))}</p>
<p style="margin:0;font-size:24px;font-weight:700;color:${color}">${esc(premio)}</p>${detalle}`;
  const texto = [t(idioma, "c_hola"), t(idioma, "c_resultado_texto", { ruleta: nombreSegun(idioma, ruleta) }), premio, detalleTexto].filter(Boolean).join("\n\n");
  return { asunto, html: envoltorio(env, urlBase, idioma, cuerpo), texto };
}
