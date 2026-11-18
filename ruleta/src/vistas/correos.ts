import { t, nombreSegun } from "../lib/i18n";
import { formatearFecha } from "../lib/tiempo";
import type { Env, Idioma, Tirada } from "../tipos";

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface CorreoListo {
  asunto: string;
  html: string;
  texto: string;
}

/*
 * Diseño deliberadamente sobrio, como una notificación de pedido: fondo blanco, tipografía del
 * sistema, sin imágenes ni botones de colores y con el enlace a la vista. Los correos con aspecto
 * de anuncio (fondo oscuro, botones grandes, palabras como «premio» en el asunto) son los que
 * Gmail suele mandar a la pestaña Promociones. La estética de la ruleta se queda en la web.
 */
const P = 'style="margin:0 0 14px"';

function envoltorio(env: Env, urlBase: string, idioma: Idioma, cuerpo: string): string {
  const terminos = `<a href="${esc(urlBase)}/legal/terminos?lang=${idioma}" style="color:#555">${esc(urlBase.replace(/^https?:\/\//, ""))}/legal/terminos</a>`;
  const privacidad = `<a href="${esc(urlBase)}/legal/privacidad?lang=${idioma}" style="color:#555">${esc(urlBase.replace(/^https?:\/\//, ""))}/legal/privacidad</a>`;
  return `<!doctype html><html lang="${idioma}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:24px 16px;background:#ffffff;color:#222222;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5">
<div style="max-width:560px">
${cuerpo}
<p style="margin:28px 0 0;font-size:12px;color:#777777">${t(idioma, "c_pie", { tienda: esc(env.TIENDA_NOMBRE), terminos, privacidad })}</p>
</div></body></html>`;
}

const firmaHtml = (env: Env, idioma: Idioma) => `<p style="margin:20px 0 0">${esc(t(idioma, "c_firma"))}<br>${esc(env.TIENDA_NOMBRE)}</p>`;
const firmaTexto = (env: Env, idioma: Idioma) => `${t(idioma, "c_firma")}\n${env.TIENDA_NOMBRE}`;
const enlaceHtml = (url: string) => `<a href="${esc(url)}" style="color:#1a56b8;word-break:break-all">${esc(url)}</a>`;

function listaPedidos(pedidos: string[]): string {
  return pedidos.length <= 3 ? pedidos.join(", ") : `${pedidos.slice(0, 3).join(", ")}…`;
}

export interface EnlaceCorreo {
  url: string;
  ruleta: { nombre: string; nombre_en: string };
  pedido: string | null;
}

export function correoEnlace(env: Env, urlBase: string, idioma: Idioma, enlaces: EnlaceCorreo[], expira: string): CorreoListo {
  const n = enlaces.length;
  const tienda = env.TIENDA_NOMBRE;
  const fecha = formatearFecha(expira, env.ZONA_HORARIA, idioma, false);
  const pedidos = [...new Set(enlaces.map((e) => e.pedido).filter((p): p is string => !!p))];
  const todosConPedido = pedidos.length > 0 && enlaces.every((e) => e.pedido);

  let asunto: string;
  let intro: string;
  if (n === 1) {
    asunto = enlaces[0].pedido ? t(idioma, "c_enlace_asunto_pedido", { pedido: enlaces[0].pedido }) : t(idioma, "c_enlace_asunto", { tienda });
    intro = enlaces[0].pedido ? t(idioma, "c_enlace_texto_pedido", { pedido: enlaces[0].pedido, tienda }) : t(idioma, "c_enlace_texto", { tienda });
  } else {
    asunto = todosConPedido ? t(idioma, "c_enlace_asunto_n_pedidos", { pedidos: listaPedidos(pedidos), n }) : t(idioma, "c_enlace_asunto_n", { tienda, n });
    intro = t(idioma, "c_enlace_texto_n", { tienda, n });
  }

  const etiqueta = (e: EnlaceCorreo, i: number) => {
    const ruleta = nombreSegun(idioma, e.ruleta);
    return e.pedido ? t(idioma, "c_tirada_n_pedido", { i: i + 1, pedido: e.pedido, ruleta }) : t(idioma, "c_tirada_n", { i: i + 1, ruleta });
  };

  const bloques =
    n === 1
      ? `<p ${P}>${esc(t(idioma, "c_enlace_abrir"))}<br>${enlaceHtml(enlaces[0].url)}</p>`
      : `<p ${P}>${esc(t(idioma, "c_enlace_abrir_n"))}</p>` +
        enlaces.map((e, i) => `<p ${P}>${esc(etiqueta(e, i))}:<br>${enlaceHtml(e.url)}</p>`).join("");

  const cuerpo = `<p ${P}>${esc(t(idioma, "c_hola"))}</p>
<p ${P}>${esc(intro)}</p>
${bloques}
<p ${P}>${esc(t(idioma, "c_caduca", { fecha }))}</p>
${firmaHtml(env, idioma)}`;

  const texto = [
    t(idioma, "c_hola"),
    intro,
    n === 1 ? `${t(idioma, "c_enlace_abrir")}\n${enlaces[0].url}` : [t(idioma, "c_enlace_abrir_n"), ...enlaces.map((e, i) => `${etiqueta(e, i)}:\n${e.url}`)].join("\n\n"),
    t(idioma, "c_caduca", { fecha }),
    firmaTexto(env, idioma),
  ].join("\n\n");

  return { asunto, html: envoltorio(env, urlBase, idioma, cuerpo), texto };
}

export function correoResultado(env: Env, urlBase: string, tirada: Tirada, ruleta: { nombre: string; nombre_en: string }, pedido: string | null = null): CorreoListo {
  const idioma = tirada.idioma;
  const premio = nombreSegun(idioma, { nombre: tirada.premio_nombre, nombre_en: tirada.premio_nombre_en });
  const nombreRuleta = nombreSegun(idioma, ruleta);
  const asunto = pedido ? t(idioma, "c_resultado_asunto_pedido", { pedido }) : t(idioma, "c_resultado_asunto", { tienda: env.TIENDA_NOMBRE });

  let detalle = "";
  let detalleTexto = "";
  if (tirada.premio_tipo === "cupon" && tirada.cupon_codigo) {
    const uso = t(idioma, "cupon_uso", { tienda: env.TIENDA_NOMBRE });
    detalle = `<p ${P}>${esc(t(idioma, "c_resultado_cupon"))}<br><span style="font-family:Consolas,Menlo,monospace;font-size:18px;font-weight:bold;letter-spacing:1px">${esc(tirada.cupon_codigo)}</span></p>
<p ${P}>${esc(uso)}${env.TIENDA_URL ? ` ${enlaceHtml(env.TIENDA_URL)}` : ""}</p>`;
    detalleTexto = `${t(idioma, "c_resultado_cupon")} ${tirada.cupon_codigo}\n${uso}${env.TIENDA_URL ? ` ${env.TIENDA_URL}` : ""}`;
  } else if (tirada.premio_tipo === "ark") {
    const clave = tirada.ark_datos_en ? "c_resultado_ark_ok" : "c_resultado_ark";
    detalle = `<p ${P}>${esc(t(idioma, clave))}</p>`;
    detalleTexto = t(idioma, clave);
  }

  const cuerpo = `<p ${P}>${esc(t(idioma, "c_hola"))}</p>
<p ${P}>${esc(t(idioma, "c_resultado_texto", { ruleta: nombreRuleta }))}<br><strong>${esc(premio)}</strong></p>
${detalle}
${firmaHtml(env, idioma)}`;

  const texto = [t(idioma, "c_hola"), `${t(idioma, "c_resultado_texto", { ruleta: nombreRuleta })}\n${premio}`, detalleTexto, firmaTexto(env, idioma)].filter(Boolean).join("\n\n");
  return { asunto, html: envoltorio(env, urlBase, idioma, cuerpo), texto };
}
