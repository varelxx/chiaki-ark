import { Hono } from "hono";
import { ErrorUsuario, esErrorD1, esLimiteD1 } from "../lib/errores";
import { elegirIdioma, nombreSegun, t } from "../lib/i18n";
import { probabilidadesEfectivas } from "../lib/probabilidades";
import { enteroConfig, leerConfig, plataformas } from "../servicios/config";
import { procesarCola } from "../servicios/correos";
import { listarBloqueados, listarRuletas } from "../servicios/catalogo";
import {
  buscarPorToken,
  estadoEnlace,
  girar,
  guardarDatosArk,
  paisesBloqueados,
  premiosDeRuleta,
  ruletaPorId,
  validarDatosArk,
  DIAS_CADUCIDAD,
} from "../servicios/tiradas";
import type { Idioma, Premio, Tirada } from "../tipos";
import {
  PaginaInicio,
  PaginaLegal,
  PaginaMensaje,
  PaginaProbabilidades,
  PaginaResultado,
  PaginaRuleta,
  TarjetaResultado,
  type Marco,
} from "../vistas/publico";
import type { Segmento } from "../vistas/ruleta-svg";
import { aTexto, enSegundoPlano, html, ipCliente, paisCliente, type App, type Ctx } from "./util";

export const publico = new Hono<App>();

function marco(c: Ctx, porDefecto?: Idioma): Marco {
  return { env: c.env, idioma: elegirIdioma(c.req.query("lang"), porDefecto ? null : c.req.header("accept-language"), porDefecto ?? "es"), ruta: c.req.path };
}

export const segmentosDe = (premios: Premio[], idioma: Idioma): Segmento[] =>
  probabilidadesEfectivas(premios).map(({ premio, prob }) => ({ id: premio.id, etiqueta: nombreSegun(idioma, premio), rareza: premio.rareza, prob }));

/** Página de error para el cliente. Los fallos de D1 (cupo diario agotado) dan "vuelve mañana". */
export function paginaError(c: Ctx, e: unknown, m: Marco): Promise<Response> {
  const contacto = c.env.CONTACTO_EMAIL || c.env.TIENDA_URL || c.env.TIENDA_NOMBRE;
  if (e instanceof ErrorUsuario) {
    const [tit, txt]: [Parameters<typeof t>[1], Parameters<typeof t>[1]] =
      e.codigo === "revocada"
        ? ["revocada_t", "revocada"]
        : e.codigo === "caducada"
          ? ["caducado_t", "caducado"]
          : e.codigo === "pais_bloqueado"
            ? ["pais_t", "pais"]
            : e.codigo === "sin_premios"
              ? ["no_disp_t", "no_disp"]
              : ["invalido_t", "invalido"];
    return html(c, <PaginaMensaje marco={m} titulo={t(m.idioma, tit)} texto={t(m.idioma, txt, { contacto, dias: DIAS_CADUCIDAD })} />, e.estado);
  }
  if (esErrorD1(e)) {
    const hoy = esLimiteD1(e);
    return html(
      c,
      <PaginaMensaje marco={m} titulo={t(m.idioma, hoy ? "no_disp_hoy_t" : "no_disp_t")} texto={t(m.idioma, hoy ? "no_disp_hoy" : "no_disp")} />,
      503,
    );
  }
  throw e;
}

publico.get("/", (c) => html(c, <PaginaInicio marco={marco(c)} />));

publico.get("/probabilidades", async (c) => {
  const m = marco(c);
  try {
    const ruletas = (await listarRuletas(c.env.DB)).filter((r) => r.activa === 1);
    const info = await Promise.all(ruletas.map(async (ruleta) => ({ ruleta, segmentos: segmentosDe(await premiosDeRuleta(c.env.DB, ruleta.id), m.idioma) })));
    return html(c, <PaginaProbabilidades marco={m} ruletas={info} />);
  } catch (e) {
    return paginaError(c, e, m);
  }
});

publico.get("/legal/:tipo{terminos|privacidad}", async (c) => {
  const m = marco(c);
  try {
    const [ruletas, bloqueados, config] = await Promise.all([listarRuletas(c.env.DB), listarBloqueados(c.env.DB), leerConfig(c.env.DB)]);
    return html(
      c,
      <PaginaLegal
        marco={m}
        tipo={c.req.param("tipo") as "terminos" | "privacidad"}
        ruletas={ruletas}
        bloqueados={bloqueados.map((b) => b.codigo)}
        diasIp={enteroConfig(config.anonimizar_ip_dias, 90)}
      />,
    );
  } catch (e) {
    return paginaError(c, e, m);
  }
});

async function cargarTirada(c: Ctx): Promise<{ tirada: Tirada | null; m: Marco; token: string }> {
  const token = c.req.param("token") ?? "";
  const tirada = await buscarPorToken(c.env.DB, token);
  return { tirada, token, m: marco(c, c.req.query("lang") ? undefined : tirada?.idioma) };
}

publico.get("/tirada/:token", async (c) => {
  let m = marco(c);
  try {
    const { tirada, token, m: m2 } = await cargarTirada(c);
    m = m2;
    if (!tirada) throw new ErrorUsuario("invalido", 404, "enlace_invalido");
    const estado = estadoEnlace(tirada);
    const ruleta = (await ruletaPorId(c.env.DB, tirada.ruleta_id))!;
    const config = await leerConfig(c.env.DB);
    if (estado === "usada") {
      const errorCampo = c.req.query("error");
      const claves: Record<string, Parameters<typeof t>[1]> = { gamertag: "error_gamertag", plataforma: "error_plataforma", discord: "error_discord" };
      return html(
        c,
        <PaginaResultado
          marco={m}
          tirada={tirada}
          ruleta={ruleta}
          token={token}
          plataformas={plataformas(config)}
          guardado={c.req.query("ok") === "1"}
          error={errorCampo && claves[errorCampo] ? t(m.idioma, claves[errorCampo]) : undefined}
        />,
      );
    }
    if (estado === "revocada") throw new ErrorUsuario("revocada", 410, "revocada");
    if (estado !== "valida") throw new ErrorUsuario("caducada", 410, "caducada");
    const bloqueados = await paisesBloqueados(c.env.DB);
    const ipPais = paisCliente(c);
    if ((tirada.pais && bloqueados.has(tirada.pais)) || (config.geobloqueo_ip === "1" && ipPais && bloqueados.has(ipPais.toUpperCase()))) {
      throw new ErrorUsuario("pais", 403, "pais_bloqueado");
    }
    const segmentos = segmentosDe(await premiosDeRuleta(c.env.DB, tirada.ruleta_id), m.idioma);
    if (!segmentos.length) throw new ErrorUsuario("sin premios", 503, "sin_premios");
    return html(c, <PaginaRuleta marco={m} tirada={tirada} ruleta={ruleta} segmentos={segmentos} token={token} />);
  } catch (e) {
    return paginaError(c, e, m);
  }
});

async function ejecutarGiro(c: Ctx) {
  const config = await leerConfig(c.env.DB);
  const resultado = await girar(c.env.DB, c.req.param("token") ?? "", { ip: ipCliente(c), ipPais: paisCliente(c), config });
  // El correo con el resultado se envía en segundo plano (si el cupo de Brevo lo permite; si no, queda en cola).
  enSegundoPlano(c, procesarCola(c.env, { max: 3 }));
  return { ...resultado, config };
}

/** Versión sin JavaScript: el botón es un formulario normal. */
publico.post("/tirada/:token/girar", async (c) => {
  const token = c.req.param("token");
  const lang = c.req.query("lang");
  const destino = `/tirada/${token}${lang ? `?lang=${lang}` : ""}`;
  try {
    await ejecutarGiro(c);
    return c.redirect(destino, 303);
  } catch (e) {
    if (e instanceof ErrorUsuario && e.codigo === "ya_usada") return c.redirect(destino, 303);
    const { m } = await cargarTirada(c).catch(() => ({ m: marco(c) }));
    return paginaError(c, e, m);
  }
});

/** Versión con JavaScript: devuelve el premio (ya decidido) para animar la ruleta hasta él. */
publico.post("/api/tirada/:token/girar", async (c) => {
  try {
    const { tirada, premio, config } = await ejecutarGiro(c);
    const idioma = elegirIdioma(c.req.query("lang"), null, tirada.idioma);
    const m: Marco = { env: c.env, idioma, ruta: `/tirada/${c.req.param("token")}` };
    const tarjeta = await aTexto(<TarjetaResultado marco={m} tirada={tirada} token={c.req.param("token")} plataformas={plataformas(config)} />);
    return c.json({ ok: true, premioId: premio.id, html: tarjeta });
  } catch (e) {
    if (e instanceof ErrorUsuario) return c.json({ ok: false, error: e.codigo }, e.estado);
    if (esErrorD1(e)) {
      const idioma = elegirIdioma(c.req.query("lang"), c.req.header("accept-language"));
      const hoy = esLimiteD1(e);
      return c.json({ ok: false, error: hoy ? "no_disponible_hoy" : "no_disponible", mensaje: t(idioma, hoy ? "no_disp_hoy" : "no_disp") }, 503);
    }
    throw e;
  }
});

publico.post("/tirada/:token/datos-ark", async (c) => {
  const token = c.req.param("token");
  const lang = c.req.query("lang");
  const base = `/tirada/${token}?${lang ? `lang=${lang}&` : ""}`;
  try {
    const cuerpo = await c.req.parseBody();
    const config = await leerConfig(c.env.DB);
    const datos = validarDatosArk(cuerpo, plataformas(config));
    await guardarDatosArk(c.env.DB, token, datos);
    return c.redirect(`${base}ok=1#tarjeta-premio`, 303);
  } catch (e) {
    if (e instanceof ErrorUsuario && e.estado === 422) return c.redirect(`${base}error=${e.codigo}#tarjeta-premio`, 303);
    if (e instanceof ErrorUsuario && e.estado === 409) return c.redirect(`${base.slice(0, -1)}#tarjeta-premio`, 303);
    const { m } = await cargarTirada(c).catch(() => ({ m: marco(c) }));
    return paginaError(c, e, m);
  }
});
