import { Hono } from "hono";
import { esErrorD1, esLimiteD1 } from "./lib/errores";
import { elegirIdioma, t } from "./lib/i18n";
import { admin } from "./rutas/admin";
import { ESTATICOS } from "./estaticos.generado";
import { estaticos } from "./rutas/estaticos";
import { publico } from "./rutas/publico";
import type { App } from "./rutas/util";
import { webhook } from "./rutas/webhook";
import { procesarCola } from "./servicios/correos";
import { mantenimientoDiario } from "./servicios/mantenimiento";
import type { Env } from "./tipos";

export const app = new Hono<App>();

// Cabeceras de seguridad. Sin scripts ni estilos en línea: todo sale de /js y /css (mismo origen).
app.use("*", async (c, next) => {
  await next();
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  // same-origin: el token de la URL nunca viaja a otros sitios, y los formularios propios envían Origin
  // (con no-referrer los navegadores mandan "Origin: null" y la protección CSRF del panel los rechazaría).
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
  c.header("X-Frame-Options", "DENY");
  c.header("Cross-Origin-Opener-Policy", "same-origin");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  c.header("X-Robots-Tag", "noindex, nofollow");
  if (new URL(c.req.url).protocol === "https:") c.header("Strict-Transport-Security", "max-age=31536000");
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
});

/*
 * Límite de peticiones por IP (Workers Rate Limiting, gratis). Sin él, alguien podría lanzar miles de
 * peticiones y agotar los cupos diarios gratuitos de Workers/D1 (denegación de servicio).
 *  - LIMITE_SENSIBLE (10/min): girar, formulario de ARK, login y webhook.
 *  - LIMITE_PUBLICO (60/min): el resto de páginas públicas.
 * Los estáticos y el panel con sesión no se limitan. Sin IP (solo en tests locales) no se limita.
 */
app.use("*", async (c, next) => {
  const ruta = c.req.path;
  const ip = c.req.header("cf-connecting-ip");
  if (!ip || ESTATICOS[ruta]) return next();
  const sensible =
    c.req.method === "POST" && (/^\/(api\/)?tirada\//.test(ruta) || ruta === "/admin/login" || ruta === "/admin/seguridad/contrasena" || ruta.startsWith("/api/webhook"));
  const limitador = sensible ? c.env.LIMITE_SENSIBLE : ruta.startsWith("/admin") ? undefined : c.env.LIMITE_PUBLICO;
  if (!limitador) return next();
  // Nota: el contador es por IP y por centro de datos de Cloudflare, y es aproximado (Cloudflare lo
  // sincroniza en segundo plano). Frena abusos desde una IP; no es un límite exacto.
  let permitido = true;
  try {
    permitido = (await limitador.limit({ key: ip })).success;
  } catch (e) {
    console.error("Rate limit:", e); // si el limitador falla, no bloqueamos a los clientes
  }
  if (permitido) return next();
  const idioma = elegirIdioma(c.req.query("lang"), c.req.header("accept-language"));
  c.header("Retry-After", "60");
  if (ruta.startsWith("/api/")) return c.json({ ok: false, error: "demasiadas_peticiones", mensaje: t(idioma, "demasiadas") }, 429);
  return c.text(t(idioma, "demasiadas"), 429);
});

app.route("/", estaticos);
app.route("/", publico);
app.route("/", admin);
app.route("/", webhook);

app.notFound((c) => c.text("No encontrado", 404));

// Si D1 falla (cupo diario agotado o caída), el cliente ve un mensaje claro. Como las escrituras van
// en lotes transaccionales, no queda nada a medias y ninguna tirada se pierde.
app.onError((e, c) => {
  console.error(e);
  if (esErrorD1(e)) {
    const idioma = elegirIdioma(c.req.query("lang"), c.req.header("accept-language"));
    const hoy = esLimiteD1(e);
    const texto = t(idioma, hoy ? "no_disp_hoy" : "no_disp");
    if (c.req.path.startsWith("/api/")) return c.json({ ok: false, error: hoy ? "no_disponible_hoy" : "no_disponible", mensaje: texto }, 503);
    return c.text(texto, 503);
  }
  return c.text("Error interno", 500);
});

export default {
  fetch: app.fetch,
  /** Cron (cada 10 min): envía la cola de correos y, una vez al día, el mantenimiento de privacidad. */
  async scheduled(_evento: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        try {
          await procesarCola(env);
        } catch (e) {
          console.error("Cola de correos:", e);
        }
        try {
          await mantenimientoDiario(env);
        } catch (e) {
          console.error("Mantenimiento:", e);
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
