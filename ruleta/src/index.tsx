import { Hono } from "hono";
import { esErrorD1, esLimiteD1 } from "./lib/errores";
import { elegirIdioma, t } from "./lib/i18n";
import { admin } from "./rutas/admin";
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
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
});

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
