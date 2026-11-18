import { Hono } from "hono";
import type { Child } from "hono/jsx";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { escribirCsv } from "../lib/csv";
import { formatearEur, formatearMoneda, formatearNumeroPlano, pesoAPorcentaje } from "../lib/dinero";
import { ErrorUsuario } from "../lib/errores";
import { CODIGOS_PAISES, nombrePais, UE_EEE } from "../lib/paises";
import { analizarRuleta, probabilidadesEfectivas } from "../lib/probabilidades";
import { RAREZAS } from "../lib/rarezas";
import { verificarContrasena } from "../lib/cripto";
import { ahora, formatearFecha, normalizarFecha } from "../lib/tiempo";
import { evaluarPedido } from "../lib/tramos";
import {
  bloquearPais,
  crearPremio,
  desbloquearPais,
  descargarTiposBce,
  eliminarCuponesLibres,
  eliminarPremio,
  eliminarTipo,
  guardarPremios,
  guardarRuletas,
  guardarTipos,
  importarCupones,
  listarBloqueados,
  listarRuletas,
  listarTipos,
  resumenCupones,
  validarTipo,
  type EntradaPremio,
  type EntradaRuleta,
} from "../servicios/catalogo";
import { CONFIG_POR_DEFECTO, enteroConfig, guardarConfig, leerConfig, type Config } from "../servicios/config";
import { claveBrevo, descartarCorreos, esClaveSmtp, estadoCorreos, procesarCola, quitarPausa, reintentarCorreos, urlBase, type ResultadoCola } from "../servicios/correos";
import { borrarDatosDePersona, datosDePersona, mantenimientoDiario } from "../servicios/mantenimiento";
import {
  autorizarPedidos,
  cambiarEstadoPedidos,
  contextoElegibilidad,
  crearPedidos,
  interpretarCsv,
  listarPedidos,
  MAX_AUTORIZAR,
  validarPedido,
  type ResultadoAutorizacion,
} from "../servicios/pedidos";
import { cookieSesion, crearSesion, DURACION_SESION_H, loginBloqueado, registrarFallo, sesionValida } from "../servicios/sesion";
import {
  anadirTiradasManuales,
  ESTADOS_FILTRO,
  listarHistorial,
  marcarEntregadas,
  MAX_TIRADAS_MANUALES,
  premiosDeRuleta,
  reenviarTiradas,
  revocarTiradas,
  type FilaHistorial,
  type FiltroHistorial,
} from "../servicios/tiradas";
import type { Env, Premio, Ruleta } from "../tipos";
import { Avisos, LayoutAdmin, Paginacion, PaginaLogin, type Flash } from "../vistas/admin-base";
import { enteros, html, ipCliente, type App, type Ctx } from "./util";

export const admin = new Hono<App>();

const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
const volver = (c: Ctx, ruta: string, flash: Flash) => c.redirect(ruta + (ruta.includes("?") ? "&" : "?") + qs({ ok: flash.ok, error: flash.error }).slice(1), 303);
const flash = (c: Ctx): Flash => ({ ok: c.req.query("ok"), error: c.req.query("error") });
const fecha = (env: Env, iso: string | null | undefined) => formatearFecha(iso, env.ZONA_HORARIA);
const eur = (cents: number) => formatearEur(cents);
const texto = (v: unknown) => (typeof v === "string" ? v : "");
const pagina = (c: Ctx) => Math.max(1, Number(c.req.query("pagina")) || 1);

function vista(c: Ctx, titulo: string, contenido: Child, estado = 200, f?: Flash) {
  return html(
    c,
    <LayoutAdmin titulo={titulo} ruta={c.req.path} flash={f ?? flash(c)} tienda={c.env.TIENDA_NOMBRE}>
      {contenido}
    </LayoutAdmin>,
    estado,
  );
}

const panelConfigurado = (env: Env) => !!env.ADMIN_PASSWORD_HASH && !!env.SESSION_SECRET && env.SESSION_SECRET.length >= 32;

// ---------- Seguridad: origen de los POST + sesión ----------

const proteger = async (c: Ctx, next: () => Promise<void>) => {
  if (c.req.method === "POST") {
    const origen = c.req.header("origin");
    const sitio = c.req.header("sec-fetch-site");
    const propio = new URL(c.req.url).origin;
    // Origin debe ser el propio. Si el navegador manda "null" (políticas de referrer estrictas), vale
    // Sec-Fetch-Site: same-origin, que ninguna página puede falsificar.
    const valido = origen && origen !== "null" ? origen === propio : sitio === undefined ? !origen : sitio === "same-origin";
    if (!valido) return c.text("Origen no permitido", 403);
  }
  c.header("Cache-Control", "no-store");
  if (c.req.path === "/admin/login") return next();
  if (!(await sesionValida(c.env, getCookie(c, cookieSesion(c.req.url).nombre)))) {
    return c.req.method === "GET" ? c.redirect("/admin/login", 302) : c.text("La sesión ha caducado. Vuelve a entrar.", 401);
  }
  await next();
};
admin.use("/admin", proteger);
admin.use("/admin/*", proteger);

admin.get("/admin/login", (c) => html(c, <PaginaLogin tienda={c.env.TIENDA_NOMBRE} sinConfigurar={!panelConfigurado(c.env)} />));

admin.post("/admin/login", async (c) => {
  if (!panelConfigurado(c.env)) return html(c, <PaginaLogin tienda={c.env.TIENDA_NOMBRE} sinConfigurar />, 503);
  const ip = ipCliente(c) ?? "desconocida";
  if (await loginBloqueado(c.env.DB, ip)) {
    return html(c, <PaginaLogin tienda={c.env.TIENDA_NOMBRE} error="Demasiados intentos. Espera 15 minutos." />, 429);
  }
  const cuerpo = await c.req.parseBody();
  const ok = await verificarContrasena(texto(cuerpo.contrasena), c.env.ADMIN_PASSWORD_HASH!);
  if (!ok) {
    await registrarFallo(c.env.DB, ip);
    return html(c, <PaginaLogin tienda={c.env.TIENDA_NOMBRE} error="Contraseña incorrecta." />, 401);
  }
  const cookie = cookieSesion(c.req.url);
  setCookie(c, cookie.nombre, await crearSesion(c.env), { httpOnly: true, secure: cookie.segura, sameSite: "Strict", path: "/", maxAge: DURACION_SESION_H * 3600 });
  // Sin dominio propio: la URL pública (workers.dev) se aprende sola la primera vez que entras al panel.
  if (!c.env.URL_BASE) {
    const origen = new URL(c.req.url).origin;
    const config = await leerConfig(c.env.DB);
    if (config.url_base !== origen) await guardarConfig(c.env.DB, { url_base: origen });
  }
  return c.redirect("/admin", 303);
});

admin.post("/admin/salir", (c) => {
  const cookie = cookieSesion(c.req.url);
  deleteCookie(c, cookie.nombre, { path: "/", secure: cookie.segura });
  return c.redirect("/admin/login", 303);
});

// ---------- Resumen ----------

const BarraCorreos = ({ e }: { e: Awaited<ReturnType<typeof estadoCorreos>> }) => (
  <div class={`tarjeta ${e.agotado ? "peligro" : e.aviso ? "alerta" : ""}`}>
    <h2>Correos enviados hoy</h2>
    <p class="cifra">
      {e.enviadosHoy} <small>/ {e.limite}</small>
    </p>
    <progress max={e.limite || 1} value={Math.min(e.enviadosHoy, e.limite)}></progress>
    <p class="pequeno">Día UTC {e.dia} (el cupo gratuito de Brevo es de 300 correos al día). Reserva para resultados de giros: {e.reserva}.</p>
    {e.agotado ? (
      <p class="aviso-texto">Cupo agotado: los correos esperan en la cola y el cron los enviará cuando se renueve el cupo.</p>
    ) : e.aviso ? (
      <p class="aviso-texto">Has usado el {Math.round(e.porcentaje * 100)} % del cupo diario.</p>
    ) : null}
    {e.pausaHasta ? <p class="aviso-texto">Envíos en pausa hasta {e.pausaHasta.slice(11, 16)} UTC: {e.pausaMotivo}</p> : null}
    <p>
      En cola: <a href="/admin/correos">{e.pendientes}</a> · Con error: <a href="/admin/correos">{e.errores}</a>
    </p>
  </div>
);

admin.get("/admin", async (c) => {
  const db = c.env.DB;
  const config = await leerConfig(db);
  const [correos, ruletas, conteos] = await Promise.all([
    estadoCorreos(db, config),
    listarRuletas(db),
    db.batch([
      db.prepare("SELECT count(*) AS n FROM pedidos WHERE estado = 'pendiente'"),
      db.prepare("SELECT count(*) AS n FROM tiradas WHERE estado = 'usada' AND premio_tipo = 'ark'"),
      db.prepare("SELECT count(*) AS n FROM tiradas WHERE estado = 'pendiente' AND (expira_en IS NULL OR expira_en > ?1)").bind(ahora()),
      db.prepare("SELECT count(*) AS n FROM tipos_cambio"),
    ]),
  ]);
  const [pedidosPend, arkPend, tiradasPend, numTipos] = conteos.map((r) => (r.results[0] as { n: number }).n);
  const analisis = await Promise.all(ruletas.map(async (r) => ({ r, a: analizarRuleta(r, await premiosDeRuleta(db, r.id)) })));
  const avisosConfig: string[] = [];
  if (!claveBrevo(c.env)) avisosConfig.push("Falta el secreto BREVO_API_KEY: no se puede enviar ningún correo.");
  else if (esClaveSmtp(c.env)) {
    avisosConfig.push("BREVO_API_KEY es una clave SMTP (empieza por xsmtpsib-). Hace falta una clave de API (empieza por xkeysib-): Brevo → SMTP y API → Claves API.");
  }
  if (!urlBase(c.env, config)) avisosConfig.push("No hay URL pública para los enlaces (URL_BASE).");
  const enCloudflare = "en Cloudflare: Workers & Pages → ruleta-ark → Settings → Variables and Secrets → Add (tipo Text)";
  if (!c.env.REMITENTE_EMAIL || c.env.REMITENTE_EMAIL.endsWith("example.com")) {
    avisosConfig.push(`Falta REMITENTE_EMAIL (un remitente verificado en Brevo): sin él los correos esperan en la cola. Añádelo ${enCloudflare}.`);
  }
  if (!c.env.CONTACTO_EMAIL || c.env.CONTACTO_EMAIL.endsWith("example.com")) avisosConfig.push(`Falta CONTACTO_EMAIL (sale en los textos legales). Añádelo ${enCloudflare}.`);
  if (!c.env.RESPONSABLE_NOMBRE) avisosConfig.push(`Falta RESPONSABLE_NOMBRE (titular de la promoción en los textos legales). Añádelo ${enCloudflare}.`);
  if (numTipos === 0) avisosConfig.push("No hay tipos de cambio: los pedidos en monedas distintas del euro no se podrán autorizar.");
  if (config.webhook_activo === "1") avisosConfig.push("El webhook de pedidos está ACTIVADO.");
  return vista(
    c,
    "Resumen",
    <>
      <Avisos avisos={avisosConfig} />
      <div class="rejilla">
        <BarraCorreos e={correos} />
        <div class="tarjeta">
          <h2>Pendiente</h2>
          <p>
            Pedidos por autorizar: <a href="/admin/pedidos?estado=pendiente">{pedidosPend}</a>
          </p>
          <p>
            Premios de ARK por entregar: <a href="/admin/tiradas?estado=ark_pendiente">{arkPend}</a>
          </p>
          <p>
            Tiradas enviadas sin girar: <a href="/admin/tiradas?estado=pendiente">{tiradasPend}</a>
          </p>
        </div>
      </div>
      <h2>Coste esperado por ruleta</h2>
      <div class="rejilla">
        {analisis.map(({ r, a }) => (
          <div class={`tarjeta ${a.superaNominal || a.superaEfectivo ? "alerta" : ""}`}>
            <h3>
              {r.nombre} {r.activa ? "" : "(inactiva)"}
            </h3>
            <p>
              Desde {eur(r.umbral_cents)} · límite de coste {eur(r.limite_coste_cents)}
            </p>
            <p>
              Coste esperado: <strong>{eur(a.nominalCents)}</strong> · real con el stock actual: <strong>{eur(a.efectivoCents)}</strong>
            </p>
            <Avisos avisos={a.avisos} />
            <a href={`/admin/premios?ruleta=${r.id}`}>Editar premios</a>
          </div>
        ))}
      </div>
    </>,
  );
});

// ---------- Pedidos ----------

admin.get("/admin/pedidos", async (c) => {
  const db = c.env.DB;
  const estado = c.req.query("estado") ?? "pendiente";
  const q = c.req.query("q") ?? "";
  const p = pagina(c);
  const config = await leerConfig(db);
  const [{ pedidos, hayMas }, ctx, tipos] = await Promise.all([listarPedidos(db, { estado: estado === "todos" ? undefined : estado, q, pagina: p }), contextoElegibilidad(db, config), listarTipos(db)]);
  const ruletas = new Map(ctx.ruletas.map((r) => [r.id, r]));
  const monedas = ["EUR", ...tipos.map((t) => t.moneda)];
  return vista(
    c,
    "Pedidos",
    <>
      <nav class="pestanas">
        {[
          ["pendiente", "Pendientes de autorizar"],
          ["autorizado", "Autorizados"],
          ["descartado", "Descartados"],
          ["todos", "Todos"],
        ].map(([v, t]) => (
          <a href={`/admin/pedidos${qs({ estado: v, q })}`} class={estado === v ? "activo" : ""}>
            {t}
          </a>
        ))}
        <form method="get" class="buscar">
          <input type="hidden" name="estado" value={estado} />
          <input name="q" value={q} placeholder="Correo o n.º de pedido" />
          <button type="submit">Buscar</button>
        </form>
      </nav>
      <form method="post" action="/admin/pedidos/acciones" id="f-pedidos">
        <div class="acciones">
          {estado === "pendiente" || estado === "todos" ? (
            <>
              <button name="accion" value="autorizar" data-confirmar="¿Autorizar los pedidos marcados y enviar sus enlaces?">
                Autorizar marcados
              </button>
              <button name="accion" value="autorizar_todos" data-confirmar={`¿Autorizar todos los pedidos pendientes que cumplan las condiciones (máx. ${MAX_AUTORIZAR})?`}>
                Autorizar todos los elegibles
              </button>
              <button name="accion" value="descartar" class="secundario">
                Descartar marcados
              </button>
            </>
          ) : null}
          {estado === "descartado" ? (
            <button name="accion" value="restaurar" class="secundario">
              Volver a pendiente
            </button>
          ) : null}
        </div>
        <table>
          <thead>
            <tr>
              <th>
                <input type="checkbox" data-marcar-todos="ids" aria-label="Marcar todos" />
              </th>
              <th>Pedido</th>
              <th>Fecha</th>
              <th>Correo</th>
              <th>Importe</th>
              <th>País</th>
              <th>Ruleta</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {pedidos.map((p) => {
              const e = p.estado === "pendiente" ? evaluarPedido(p, ctx) : null;
              const ruleta = p.ruleta_id ? ruletas.get(p.ruleta_id) : e?.ok ? e.ruleta : null;
              return (
                <tr>
                  <td>
                    <input type="checkbox" name="ids" value={p.id} aria-label={`Marcar ${p.numero}`} />
                  </td>
                  <td>{p.numero}</td>
                  <td>{fecha(c.env, p.fecha)}</td>
                  <td>{p.correo}</td>
                  <td>
                    {formatearMoneda(p.importe_x100, p.moneda)}
                    {p.moneda !== "EUR" ? (
                      <small>
                        {" "}
                        ≈ {p.importe_eur_cents !== null ? eur(p.importe_eur_cents) : e?.ok ? eur(e.eurCents) : e && "eurCents" in e && e.eurCents !== undefined ? eur(e.eurCents) : "?"}
                      </small>
                    ) : null}
                  </td>
                  <td title={nombrePais(p.pais)}>{p.pais}</td>
                  <td>{ruleta ? ruleta.nombre : "—"}</td>
                  <td>
                    {p.estado === "pendiente" ? (
                      e?.ok ? (
                        <span class="etiqueta ok">Elegible</span>
                      ) : (
                        <span class="etiqueta no">{e?.ok === false ? e.texto : ""}</span>
                      )
                    ) : (
                      <span class="etiqueta">{p.estado === "autorizado" ? `Autorizado ${fecha(c.env, p.autorizado_en)}` : "Descartado"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {pedidos.length === 0 ? <p class="vacio">No hay pedidos en esta vista.</p> : null}
      </form>
      <Paginacion pagina={p} hayMas={hayMas} enlace={(n) => `/admin/pedidos${qs({ estado, q, pagina: n })}`} />

      <div class="rejilla">
        <form method="post" action="/admin/pedidos" class="tarjeta">
          <h2>Alta manual</h2>
          <label>
            N.º de pedido <input name="numero" required maxlength={64} />
          </label>
          <label>
            Correo <input name="correo" type="email" required />
          </label>
          <label>
            Importe <input name="importe" required inputmode="decimal" placeholder="24,90" />
          </label>
          <label>
            Moneda
            <select name="moneda">
              {monedas.map((m) => (
                <option value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            País
            <select name="pais" required>
              <option value=""></option>
              {CODIGOS_PAISES.map((p) => (
                <option value={p}>
                  {p} · {nombrePais(p)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fecha <input name="fecha" type="date" required value={ahora().slice(0, 10)} />
          </label>
          <button type="submit">Añadir pedido</button>
        </form>
        <form method="post" action="/admin/pedidos/importar" enctype="multipart/form-data" class="tarjeta">
          <h2>Importar CSV</h2>
          <p class="pequeno">
            Columnas: <code>pedido, correo, importe, moneda, pais, fecha</code>. Separador «,» o «;». País en código ISO de 2 letras (ES, MX, US…), moneda ISO de 3 (EUR, USD…), fecha
            AAAA-MM-DD o DD/MM/AAAA. Los números de pedido repetidos se ignoran. Máximo 2000 filas.
          </p>
          <label>
            Archivo <input type="file" name="archivo" accept=".csv,text/csv" />
          </label>
          <label>
            …o pega el contenido <textarea name="texto" rows={5} placeholder="pedido,correo,importe,moneda,pais,fecha"></textarea>
          </label>
          <button type="submit">Importar como pendientes</button>
        </form>
      </div>
    </>,
  );
});

admin.post("/admin/pedidos", async (c) => {
  const cuerpo = await c.req.parseBody();
  const r = validarPedido(cuerpo);
  if (!r.ok) return volver(c, "/admin/pedidos", { error: r.error });
  const { creados } = await crearPedidos(c.env.DB, [r.pedido], "manual");
  return volver(c, "/admin/pedidos", creados ? { ok: `Pedido ${r.pedido.numero} añadido como pendiente.` } : { error: `El pedido ${r.pedido.numero} ya existe.` });
});

admin.post("/admin/pedidos/importar", async (c) => {
  const cuerpo = await c.req.parseBody();
  let contenido = texto(cuerpo.texto);
  if (cuerpo.archivo instanceof File && cuerpo.archivo.size > 0) {
    if (cuerpo.archivo.size > 1_000_000) return volver(c, "/admin/pedidos", { error: "El archivo supera 1 MB." });
    contenido = await cuerpo.archivo.text();
  }
  if (!contenido.trim()) return volver(c, "/admin/pedidos", { error: "No has enviado ningún CSV." });
  let resultado;
  try {
    resultado = interpretarCsv(contenido);
  } catch (e) {
    if (e instanceof ErrorUsuario) return volver(c, "/admin/pedidos", { error: e.message });
    throw e;
  }
  const { creados, duplicados } = await crearPedidos(c.env.DB, resultado.filas, "csv");
  return vista(
    c,
    "Resultado de la importación",
    <div class="tarjeta">
      <p>
        <strong>{creados}</strong> pedidos importados como pendientes de autorizar. <strong>{duplicados.length}</strong> repetidos ignorados.{" "}
        <strong>{resultado.errores.length}</strong> filas con errores.
      </p>
      {duplicados.length ? <p class="pequeno">Repetidos: {duplicados.slice(0, 100).join(", ")}</p> : null}
      {resultado.errores.length ? (
        <table>
          <thead>
            <tr>
              <th>Línea</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {resultado.errores.slice(0, 200).map((e) => (
              <tr>
                <td>{e.linea}</td>
                <td>{e.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <p>
        <a href="/admin/pedidos?estado=pendiente">Ir a pedidos pendientes</a>
      </p>
    </div>,
  );
});

const ResultadoAutorizar = ({ r, cola }: { r: ResultadoAutorizacion; cola: ResultadoCola }) => (
  <div class="tarjeta">
    <p>
      <strong>{r.autorizados}</strong> pedidos autorizados · <strong>{r.correos}</strong> correos en cola · <strong>{cola.enviados}</strong> enviados ya
      {cola.motivo === "cupo" ? " (cupo diario de Brevo alcanzado: el resto se enviará con el cron)" : ""}
      {cola.motivo === "pausa" ? " (envíos en pausa: mira la sección Correos)" : ""}
      {cola.motivo === "sin_clave" ? " (falta BREVO_API_KEY: los correos esperan en la cola)" : ""}
      {cola.motivo === "sin_remitente" ? " (falta REMITENTE_EMAIL: los correos esperan en la cola)" : ""}
      {cola.motivo === "clave_smtp" ? " (BREVO_API_KEY es una clave SMTP, no de API: los correos esperan en la cola)" : ""}
      {cola.motivo === "sin_url" ? " (falta la URL pública: los correos esperan en la cola)" : ""}.
    </p>
    {r.rechazados.length ? (
      <>
        <h2>No autorizados</h2>
        <table>
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {r.rechazados.map((x) => (
              <tr>
                <td>{x.numero}</td>
                <td>{x.motivo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    ) : null}
    <p>
      <a href="/admin/pedidos?estado=pendiente">Volver a pedidos</a> · <a href="/admin/tiradas">Ver tiradas</a>
    </p>
  </div>
);

admin.post("/admin/pedidos/acciones", async (c) => {
  const db = c.env.DB;
  const cuerpo = await c.req.parseBody({ all: true });
  const accion = texto(cuerpo.accion);
  let ids = enteros(cuerpo.ids);
  if (accion === "autorizar_todos") {
    const { results } = await db.prepare("SELECT id FROM pedidos WHERE estado = 'pendiente' ORDER BY id LIMIT ?1").bind(MAX_AUTORIZAR).all<{ id: number }>();
    ids = results.map((r) => r.id);
  }
  if (!ids.length) return volver(c, "/admin/pedidos", { error: "No has marcado ningún pedido." });
  if (accion === "autorizar" || accion === "autorizar_todos") {
    const config = await leerConfig(db);
    const r = await autorizarPedidos(db, ids, config);
    const cola = r.correos ? await procesarCola(c.env) : { enviados: 0, fallidos: 0, descartados: 0 };
    return vista(c, "Resultado de la autorización", <ResultadoAutorizar r={r} cola={cola} />);
  }
  if (accion === "descartar" || accion === "restaurar") {
    const n = await cambiarEstadoPedidos(db, ids, accion);
    return volver(c, `/admin/pedidos?estado=${accion === "descartar" ? "pendiente" : "descartado"}`, { ok: `${n} pedidos actualizados.` });
  }
  return volver(c, "/admin/pedidos", { error: "Acción desconocida." });
});

// ---------- Tiradas e historial ----------

function filtroHistorial(c: Ctx): FiltroHistorial {
  const ruleta = Number(c.req.query("ruleta")) || undefined;
  return {
    estado: c.req.query("estado") || undefined,
    ruleta,
    correo: c.req.query("correo") || undefined,
    desde: normalizarFecha(c.req.query("desde") ?? "") ?? undefined,
    hasta: normalizarFecha(c.req.query("hasta") ?? "") ?? undefined,
    pagina: pagina(c),
  };
}

function estadoLegible(f: FilaHistorial, momento: string): string {
  switch (f.estado) {
    case "pendiente":
      if (f.expira_en && f.expira_en <= momento) return "Caducada";
      if (f.enlace_en_cola) return "Pendiente · enlace en cola";
      return f.enviada_en ? "Pendiente" : "Pendiente · sin enviar";
    case "usada":
      return f.premio_tipo === "ark" ? (f.ark_datos_en ? "Usada · pendiente de entrega" : "Usada · faltan datos de entrega") : "Usada";
    case "entregada":
      return "Entregada";
    case "revocada":
      return "Revocada";
  }
}

const ETIQUETAS_ESTADO: Record<string, string> = {
  pendiente: "Pendientes",
  caducada: "Caducadas",
  usada: "Usadas",
  ark_pendiente: "ARK pendientes de entrega",
  entregada: "Entregadas",
  revocada: "Revocadas",
};

admin.get("/admin/tiradas", async (c) => {
  const db = c.env.DB;
  const f = filtroHistorial(c);
  const [{ filas, hayMas }, ruletas] = await Promise.all([listarHistorial(db, f), listarRuletas(db)]);
  const momento = ahora();
  const filtroQs = { estado: f.estado, ruleta: f.ruleta, correo: f.correo, desde: f.desde, hasta: f.hasta };
  return vista(
    c,
    "Tiradas e historial",
    <>
      <form method="get" class="filtros">
        <label>
          Estado
          <select name="estado">
            <option value="">Todos</option>
            {ESTADOS_FILTRO.map((e) => (
              <option value={e} selected={f.estado === e}>
                {ETIQUETAS_ESTADO[e]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ruleta
          <select name="ruleta">
            <option value="">Todas</option>
            {ruletas.map((r) => (
              <option value={r.id} selected={f.ruleta === r.id}>
                {r.nombre}
              </option>
            ))}
          </select>
        </label>
        <label>
          Correo <input name="correo" value={f.correo ?? ""} />
        </label>
        <label>
          Desde <input type="date" name="desde" value={f.desde ?? ""} />
        </label>
        <label>
          Hasta <input type="date" name="hasta" value={f.hasta ?? ""} />
        </label>
        <button type="submit">Filtrar</button>
        <a class="boton secundario" href={`/admin/tiradas.csv${qs(filtroQs)}`}>
          Exportar CSV
        </a>
      </form>
      <form method="post" action="/admin/tiradas/acciones">
        <div class="acciones">
          <button name="accion" value="reenviar">
            Reenviar enlace
          </button>
          <button name="accion" value="entregar">
            Marcar ARK entregado
          </button>
          <button name="accion" value="revocar" class="peligro" data-confirmar="¿Revocar las tiradas pendientes marcadas? Sus enlaces dejarán de funcionar.">
            Revocar
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>
                <input type="checkbox" data-marcar-todos="ids" aria-label="Marcar todas" />
              </th>
              <th>Fecha</th>
              <th>Pedido</th>
              <th>Correo</th>
              <th>País</th>
              <th>Ruleta</th>
              <th>Premio</th>
              <th>Estado</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((t) => (
              <tr>
                <td>
                  <input type="checkbox" name="ids" value={t.id} aria-label={`Marcar tirada ${t.id}`} />
                </td>
                <td>
                  {fecha(c.env, t.creada_en)}
                  {t.usada_en ? <small class="bloque">Giro: {fecha(c.env, t.usada_en)}</small> : null}
                </td>
                <td>{t.pedido_numero ?? <em>manual</em>}</td>
                <td>{t.correo}</td>
                <td>{t.pais ?? ""}</td>
                <td>{t.ruleta_nombre}</td>
                <td>
                  {t.premio_nombre ?? ""}
                  {t.cupon_codigo ? <code class="bloque">{t.cupon_codigo}</code> : null}
                  {t.ark_gamertag ? (
                    <small class="bloque">
                      {t.ark_gamertag} · {t.ark_plataforma}
                      {t.ark_discord ? ` · Discord: ${t.ark_discord}` : ""}
                    </small>
                  ) : null}
                </td>
                <td>
                  <span class={`etiqueta estado-${t.estado}`}>{estadoLegible(t, momento)}</span>
                  {t.estado === "pendiente" && t.expira_en ? <small class="bloque">Caduca {fecha(c.env, t.expira_en)}</small> : null}
                </td>
                <td>
                  <small>{t.ip ?? ""}</small>
                  {t.ip_pais ? <small class="bloque">{t.ip_pais}</small> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filas.length === 0 ? <p class="vacio">No hay tiradas con estos filtros.</p> : null}
      </form>
      <Paginacion pagina={f.pagina ?? 1} hayMas={hayMas} enlace={(n) => `/admin/tiradas${qs({ ...filtroQs, pagina: n })}`} />

      <form method="post" action="/admin/tiradas/manual" class="tarjeta estrecha">
        <h2>Añadir tiradas a mano (sin pedido)</h2>
        <label>
          Correo <input name="correo" type="email" required />
        </label>
        <label>
          Ruleta
          <select name="ruleta" required>
            {ruletas.map((r) => (
              <option value={r.id}>{r.nombre}</option>
            ))}
          </select>
        </label>
        <label>
          Número de tiradas <input name="cantidad" type="number" min={1} max={MAX_TIRADAS_MANUALES} value="1" required />
        </label>
        <label>
          Idioma del correo
          <select name="idioma">
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </label>
        <label>
          País (opcional)
          <select name="pais">
            <option value=""></option>
            {CODIGOS_PAISES.map((p) => (
              <option value={p}>
                {p} · {nombrePais(p)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Crear y enviar</button>
      </form>
    </>,
  );
});

admin.get("/admin/tiradas.csv", async (c) => {
  const f = { ...filtroHistorial(c), pagina: 1 };
  const { filas } = await listarHistorial(c.env.DB, f, 20_000);
  const momento = ahora();
  const csv = escribirCsv(
    ["id", "creada_en", "girada_en", "pedido", "correo", "pais", "ruleta", "premio", "tipo", "coste_eur", "cupon", "estado", "ip", "pais_ip", "gamertag", "plataforma", "discord", "entregada_en"],
    filas.map((t) => [
      t.id,
      t.creada_en,
      t.usada_en,
      t.pedido_numero ?? "",
      t.correo,
      t.pais,
      t.ruleta_nombre,
      t.premio_nombre,
      t.premio_tipo,
      t.premio_coste_cents !== null ? formatearNumeroPlano(t.premio_coste_cents) : "",
      t.cupon_codigo,
      estadoLegible(t, momento),
      t.ip,
      t.ip_pais,
      t.ark_gamertag,
      t.ark_plataforma,
      t.ark_discord,
      t.entregada_en,
    ]),
  );
  return c.body(csv, 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="historial-${momento.slice(0, 10)}.csv"` });
});

admin.post("/admin/tiradas/manual", async (c) => {
  const cuerpo = await c.req.parseBody();
  try {
    const { creadas } = await anadirTiradasManuales(c.env.DB, {
      correo: cuerpo.correo,
      ruletaId: Number(cuerpo.ruleta),
      cantidad: Number(cuerpo.cantidad),
      idioma: cuerpo.idioma,
      pais: cuerpo.pais,
    });
    const cola = await procesarCola(c.env);
    return volver(c, "/admin/tiradas", { ok: `${creadas} tiradas creadas. Correos enviados ahora: ${cola.enviados}${cola.motivo ? ` (motivo de espera: ${cola.motivo})` : ""}.` });
  } catch (e) {
    if (e instanceof ErrorUsuario) return volver(c, "/admin/tiradas", { error: e.message });
    throw e;
  }
});

admin.post("/admin/tiradas/acciones", async (c) => {
  const db = c.env.DB;
  const cuerpo = await c.req.parseBody({ all: true });
  const ids = enteros(cuerpo.ids);
  if (!ids.length) return volver(c, "/admin/tiradas", { error: "No has marcado ninguna tirada." });
  const accion = texto(cuerpo.accion);
  if (accion === "reenviar") {
    const n = await reenviarTiradas(db, ids);
    const cola = n ? await procesarCola(c.env) : null;
    return volver(c, "/admin/tiradas", {
      ok: `${n} correos de reenvío en cola (solo tiradas pendientes; el enlace anterior deja de valer al enviarse el nuevo). Enviados ahora: ${cola?.enviados ?? 0}.`,
    });
  }
  if (accion === "revocar") return volver(c, "/admin/tiradas", { ok: `${await revocarTiradas(db, ids)} tiradas revocadas.` });
  if (accion === "entregar") return volver(c, "/admin/tiradas?estado=ark_pendiente", { ok: `${await marcarEntregadas(db, ids)} premios marcados como entregados.` });
  return volver(c, "/admin/tiradas", { error: "Acción desconocida." });
});

// ---------- Premios ----------

const SelectorRareza = ({ nombre, valor, form }: { nombre: string; valor: string; form?: string }) => (
  <select name={nombre} form={form}>
    {Object.entries(RAREZAS).map(([k, r]) => (
      <option value={k} selected={k === valor}>
        {r.nombre}
      </option>
    ))}
  </select>
);

admin.get("/admin/premios", async (c) => {
  const db = c.env.DB;
  const ruletas = await listarRuletas(db);
  if (!ruletas.length) return vista(c, "Premios", <p>Primero crea una ruleta en Tramos.</p>);
  const ruleta = ruletas.find((r) => r.id === Number(c.req.query("ruleta"))) ?? ruletas[0];
  const [premios, cupones] = await Promise.all([premiosDeRuleta(db, ruleta.id), resumenCupones(db, ruleta.id)]);
  const a = analizarRuleta(ruleta, premios);
  const efectivas = new Map(probabilidadesEfectivas(premios).map((x) => [x.premio.id, x.prob]));
  return vista(
    c,
    "Premios y probabilidades",
    <>
      <nav class="pestanas">
        {ruletas.map((r) => (
          <a href={`/admin/premios?ruleta=${r.id}`} class={r.id === ruleta.id ? "activo" : ""}>
            {r.nombre}
          </a>
        ))}
      </nav>
      <div class={`tarjeta ${a.superaNominal || a.superaEfectivo ? "alerta" : ""}`}>
        <p>
          Pedidos desde <strong>{eur(ruleta.umbral_cents)}</strong> · Límite de coste <strong>{eur(ruleta.limite_coste_cents)}</strong> · Suma de probabilidades{" "}
          <strong>{pesoAPorcentaje(a.sumaPesos)}</strong>
        </p>
        <p>
          Coste esperado (Σ probabilidad × coste): <strong>{eur(a.nominalCents)}</strong> · Real con el stock actual: <strong>{eur(a.efectivoCents)}</strong>
        </p>
        <Avisos avisos={a.avisos} />
      </div>
      <form method="post" action={`/admin/premios/guardar?ruleta=${ruleta.id}`}>
        <table class="editable">
          <thead>
            <tr>
              <th>Orden</th>
              <th>Nombre (es)</th>
              <th>Nombre (en)</th>
              <th>Tipo</th>
              <th>Color</th>
              <th>Probabilidad %</th>
              <th>Real hoy</th>
              <th>Stock</th>
              <th>Coste €</th>
              <th>Activo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {premios.map((p) => (
              <tr class={efectivas.has(p.id) ? "" : "atenuado"}>
                <td>
                  <input type="hidden" name="ids" value={p.id} />
                  <input name={`orden_${p.id}`} value={p.orden} class="corto" inputmode="numeric" />
                </td>
                <td>
                  <input name={`nombre_${p.id}`} value={p.nombre} required maxlength={80} />
                </td>
                <td>
                  <input name={`nombre_en_${p.id}`} value={p.nombre_en} maxlength={80} />
                </td>
                <td>{p.tipo === "cupon" ? "Cupón" : "Objeto ARK"}</td>
                <td>
                  <SelectorRareza nombre={`rareza_${p.id}`} valor={p.rareza} />
                </td>
                <td>
                  <input name={`peso_${p.id}`} value={formatearNumeroPlano(p.peso).replace(".", ",")} class="corto" inputmode="decimal" />
                </td>
                <td>{efectivas.has(p.id) ? `${(efectivas.get(p.id)! * 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %` : "fuera"}</td>
                <td>
                  {p.tipo === "cupon" ? (
                    <span title="Códigos libres en la bolsa">
                      {p.stock} libres{cupones.get(p.id)?.usados ? ` · ${cupones.get(p.id)!.usados} dados` : ""}
                    </span>
                  ) : (
                    <input name={`stock_${p.id}`} value={p.stock ?? ""} placeholder="∞" class="corto" inputmode="numeric" />
                  )}
                </td>
                <td>
                  <input name={`coste_${p.id}`} value={formatearNumeroPlano(p.coste_cents).replace(".", ",")} class="corto" inputmode="decimal" />
                </td>
                <td>
                  <input type="checkbox" name={`activo_${p.id}`} value="1" checked={p.activo === 1} />
                </td>
                <td>
                  <button type="submit" form={`borrar-${p.id}`} class="peligro mini" data-confirmar={`¿Eliminar «${p.nombre}»? Si ya ha salido en alguna tirada solo se desactivará.`}>
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="pequeno">
          Las probabilidades de los premios activos deben sumar exactamente 100 % (hasta 2 decimales). Stock vacío = ilimitado. El stock de los cupones es el número de códigos
          libres de su bolsa. El coste estimado solo se ve aquí, nunca en la página pública.
        </p>
        <button type="submit">Guardar cambios</button>
      </form>
      {premios.map((p) => (
        <form method="post" action={`/admin/premios/${p.id}/eliminar?ruleta=${ruleta.id}`} id={`borrar-${p.id}`} hidden></form>
      ))}

      <h2>Bolsas de códigos de cupón</h2>
      <p class="pequeno">
        Crea en tu tienda códigos de descuento de un solo uso y pégalos aquí (uno por línea). Cada ganador recibe uno distinto. Sin códigos libres, el premio queda fuera de la
        ruleta.
      </p>
      <div class="rejilla">
        {premios
          .filter((p) => p.tipo === "cupon")
          .map((p) => (
            <div class="tarjeta">
              <h3>{p.nombre}</h3>
              <p>
                {cupones.get(p.id)?.libres ?? 0} libres · {cupones.get(p.id)?.usados ?? 0} entregados
              </p>
              <form method="post" action={`/admin/premios/${p.id}/cupones?ruleta=${ruleta.id}`}>
                <textarea name="codigos" rows={4} placeholder={"DESC5-AB12\nDESC5-CD34"} required></textarea>
                <button type="submit">Añadir códigos</button>
              </form>
              <form method="post" action={`/admin/premios/${p.id}/cupones/vaciar?ruleta=${ruleta.id}`}>
                <button type="submit" class="peligro mini" data-confirmar="¿Borrar todos los códigos libres de este premio?">
                  Borrar códigos libres
                </button>
              </form>
            </div>
          ))}
      </div>

      <form method="post" action={`/admin/premios/nuevo?ruleta=${ruleta.id}`} class="tarjeta estrecha">
        <h2>Nuevo premio en {ruleta.nombre}</h2>
        <p class="pequeno">Empieza con probabilidad 0 %; luego reparte las probabilidades en la tabla para que sumen 100 %.</p>
        <label>
          Nombre (es) <input name="nombre" required maxlength={80} />
        </label>
        <label>
          Nombre (en) <input name="nombre_en" maxlength={80} />
        </label>
        <label>
          Tipo
          <select name="tipo">
            <option value="cupon">Cupón de descuento (bolsa de códigos)</option>
            <option value="ark">Objeto de ARK (entrega en el juego)</option>
          </select>
        </label>
        <label>
          Color <SelectorRareza nombre="rareza" valor="gris" />
        </label>
        <label>
          Coste estimado € <input name="coste" value="0" inputmode="decimal" />
        </label>
        <label>
          Stock (solo ARK, vacío = ilimitado) <input name="stock" inputmode="numeric" />
        </label>
        <button type="submit">Crear premio</button>
      </form>
    </>,
  );
});

admin.post("/admin/premios/guardar", async (c) => {
  const ruletaId = Number(c.req.query("ruleta"));
  const cuerpo = await c.req.parseBody({ all: true });
  const filas: EntradaPremio[] = enteros(cuerpo.ids).map((id) => ({
    id,
    nombre: texto(cuerpo[`nombre_${id}`]),
    nombre_en: texto(cuerpo[`nombre_en_${id}`]),
    rareza: texto(cuerpo[`rareza_${id}`]),
    peso: texto(cuerpo[`peso_${id}`]),
    stock: texto(cuerpo[`stock_${id}`]),
    coste: texto(cuerpo[`coste_${id}`]),
    activo: cuerpo[`activo_${id}`] === "1",
    orden: texto(cuerpo[`orden_${id}`]),
  }));
  const destino = `/admin/premios?ruleta=${ruletaId}`;
  try {
    await guardarPremios(c.env.DB, ruletaId, filas);
  } catch (e) {
    if (e instanceof ErrorUsuario) return volver(c, destino, { error: e.message });
    throw e;
  }
  const ruleta = (await listarRuletas(c.env.DB)).find((r) => r.id === ruletaId)!;
  const a = analizarRuleta(ruleta, await premiosDeRuleta(c.env.DB, ruletaId));
  return volver(c, destino, a.superaNominal ? { ok: "Guardado.", error: `Aviso: el coste esperado (${eur(a.nominalCents)}) supera el límite del tramo (${eur(a.limiteCents)}).` } : { ok: "Guardado." });
});

admin.post("/admin/premios/nuevo", async (c) => {
  const ruletaId = Number(c.req.query("ruleta"));
  const b = await c.req.parseBody();
  try {
    await crearPremio(c.env.DB, ruletaId, {
      nombre: texto(b.nombre),
      nombre_en: texto(b.nombre_en),
      tipo: texto(b.tipo),
      rareza: texto(b.rareza),
      peso: "0",
      stock: texto(b.stock),
      coste: texto(b.coste),
      activo: true,
      orden: "99",
    });
  } catch (e) {
    if (e instanceof ErrorUsuario) return volver(c, `/admin/premios?ruleta=${ruletaId}`, { error: e.message });
    throw e;
  }
  return volver(c, `/admin/premios?ruleta=${ruletaId}`, { ok: "Premio creado con probabilidad 0 %. Ajusta las probabilidades para que sumen 100 %." });
});

admin.post("/admin/premios/:id/eliminar", async (c) => {
  const r = await eliminarPremio(c.env.DB, Number(c.req.param("id")));
  return volver(c, `/admin/premios?ruleta=${c.req.query("ruleta")}`, {
    ok: r === "borrado" ? "Premio eliminado." : "Ese premio ya ha salido en alguna tirada: se ha desactivado (0 %) para conservar el historial.",
  });
});

admin.post("/admin/premios/:id/cupones", async (c) => {
  const b = await c.req.parseBody();
  const destino = `/admin/premios?ruleta=${c.req.query("ruleta")}`;
  try {
    const r = await importarCupones(c.env.DB, Number(c.req.param("id")), texto(b.codigos));
    return volver(c, destino, { ok: `${r.insertados} códigos añadidos · ${r.repetidos} repetidos · ${r.invalidos} no válidos.` });
  } catch (e) {
    if (e instanceof ErrorUsuario) return volver(c, destino, { error: e.message });
    throw e;
  }
});

admin.post("/admin/premios/:id/cupones/vaciar", async (c) => {
  const n = await eliminarCuponesLibres(c.env.DB, Number(c.req.param("id")));
  return volver(c, `/admin/premios?ruleta=${c.req.query("ruleta")}`, { ok: `${n} códigos libres borrados.` });
});

// ---------- Tramos ----------

const SelectorColor = ({ nombre, valor, vacio }: { nombre: string; valor: string | null; vacio?: boolean }) => (
  <select name={nombre}>
    {vacio ? <option value="">—</option> : null}
    {Object.entries(RAREZAS).map(([k, r]) => (
      <option value={k} selected={k === valor}>
        {r.nombre}
      </option>
    ))}
  </select>
);

admin.get("/admin/tramos", async (c) => {
  const ruletas = await listarRuletas(c.env.DB);
  return vista(
    c,
    "Tramos (ruletas)",
    <>
      <p>
        Cada pedido da <strong>una</strong> tirada en la ruleta activa con el importe mínimo más alto que alcance (importes en euros). Cambiar un tramo no afecta a las tiradas ya
        autorizadas.
      </p>
      <form method="post" action="/admin/tramos">
        <table class="editable">
          <thead>
            <tr>
              <th>Nombre (es)</th>
              <th>Nombre (en)</th>
              <th>Importe mínimo €</th>
              <th>Límite de coste €</th>
              <th>Color</th>
              <th>2.º color</th>
              <th>Activa</th>
            </tr>
          </thead>
          <tbody>
            {ruletas.map((r) => (
              <tr>
                <td>
                  <input type="hidden" name="ids" value={r.id} />
                  <input name={`nombre_${r.id}`} value={r.nombre} required maxlength={80} />
                </td>
                <td>
                  <input name={`nombre_en_${r.id}`} value={r.nombre_en} maxlength={80} />
                </td>
                <td>
                  <input name={`umbral_${r.id}`} value={formatearNumeroPlano(r.umbral_cents).replace(".", ",")} class="corto" inputmode="decimal" required />
                </td>
                <td>
                  <input name={`limite_${r.id}`} value={formatearNumeroPlano(r.limite_coste_cents).replace(".", ",")} class="corto" inputmode="decimal" required />
                </td>
                <td>
                  <SelectorColor nombre={`color_${r.id}`} valor={r.color} />
                </td>
                <td>
                  <SelectorColor nombre={`color2_${r.id}`} valor={r.color2} vacio />
                </td>
                <td>
                  <input type="checkbox" name={`activa_${r.id}`} value="1" checked={r.activa === 1} />
                </td>
              </tr>
            ))}
            <tr class="nueva">
              <td>
                <input name="nombre_nuevo" placeholder="Nueva ruleta (opcional)" maxlength={80} />
              </td>
              <td>
                <input name="nombre_en_nuevo" maxlength={80} />
              </td>
              <td>
                <input name="umbral_nuevo" class="corto" inputmode="decimal" />
              </td>
              <td>
                <input name="limite_nuevo" class="corto" inputmode="decimal" />
              </td>
              <td>
                <SelectorColor nombre="color_nuevo" valor="morada" />
              </td>
              <td>
                <SelectorColor nombre="color2_nuevo" valor={null} vacio />
              </td>
              <td>
                <input type="checkbox" name="activa_nuevo" value="1" checked />
              </td>
            </tr>
          </tbody>
        </table>
        <button type="submit">Guardar tramos</button>
      </form>
    </>,
  );
});

admin.post("/admin/tramos", async (c) => {
  const b = await c.req.parseBody({ all: true });
  const filas: EntradaRuleta[] = enteros(b.ids).map((id) => ({
    id,
    nombre: texto(b[`nombre_${id}`]),
    nombre_en: texto(b[`nombre_en_${id}`]),
    umbral: texto(b[`umbral_${id}`]),
    limite: texto(b[`limite_${id}`]),
    color: texto(b[`color_${id}`]),
    color2: texto(b[`color2_${id}`]),
    activa: b[`activa_${id}`] === "1",
  }));
  if (texto(b.nombre_nuevo).trim()) {
    filas.push({
      nombre: texto(b.nombre_nuevo),
      nombre_en: texto(b.nombre_en_nuevo),
      umbral: texto(b.umbral_nuevo),
      limite: texto(b.limite_nuevo),
      color: texto(b.color_nuevo),
      color2: texto(b.color2_nuevo),
      activa: b.activa_nuevo === "1",
    });
  }
  try {
    await guardarRuletas(c.env.DB, filas);
  } catch (e) {
    if (e instanceof ErrorUsuario) return volver(c, "/admin/tramos", { error: e.message });
    throw e;
  }
  return volver(c, "/admin/tramos", { ok: "Tramos guardados." });
});

// ---------- Tipos de cambio ----------

admin.get("/admin/cambios", async (c) => {
  const tipos = await listarTipos(c.env.DB);
  return vista(
    c,
    "Tipos de cambio",
    <>
      <p>
        Indica cuántas unidades de cada moneda equivalen a <strong>1 €</strong> (mismo formato que el BCE; p. ej. USD 1,08 significa 1 € = 1,08 $). Un pedido de 21,60 USD con ese
        tipo cuenta como 20,00 €. El importe en euros se congela al autorizar.
      </p>
      <form method="post" action="/admin/cambios">
        <table class="editable">
          <thead>
            <tr>
              <th>Moneda</th>
              <th>Unidades por 1 €</th>
              <th>Actualizado</th>
              <th>Fuente</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tipos.map((t) => (
              <tr>
                <td>
                  <input type="hidden" name="monedas" value={t.moneda} />
                  {t.moneda}
                </td>
                <td>
                  <input name={`tasa_${t.moneda}`} value={String(t.por_eur)} class="corto" inputmode="decimal" />
                </td>
                <td>{fecha(c.env, t.actualizado_en)}</td>
                <td>{t.fuente}</td>
                <td>
                  <button type="submit" form={`borrar-${t.moneda}`} class="peligro mini">
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
            <tr class="nueva">
              <td>
                <input name="moneda_nueva" placeholder="USD" maxlength={3} class="corto" />
              </td>
              <td>
                <input name="tasa_nueva" placeholder="1,08" class="corto" inputmode="decimal" />
              </td>
              <td colspan={3}>Nueva moneda (opcional)</td>
            </tr>
          </tbody>
        </table>
        <button type="submit">Guardar</button>
      </form>
      {tipos.map((t) => (
        <form method="post" action={`/admin/cambios/${t.moneda}/eliminar`} id={`borrar-${t.moneda}`} hidden></form>
      ))}
      <form method="post" action="/admin/cambios/bce" class="tarjeta estrecha">
        <h2>Traer tipos del Banco Central Europeo</h2>
        <p class="pequeno">Descarga los tipos de referencia del día (gratis, sin clave). Podrás revisarlos antes de guardar. El BCE no publica todas las monedas (p. ej. ARS, CLP o COP): esas, a mano.</p>
        <button type="submit">Consultar el BCE</button>
      </form>
    </>,
  );
});

admin.post("/admin/cambios", async (c) => {
  const b = await c.req.parseBody({ all: true });
  const monedas = (Array.isArray(b.monedas) ? b.monedas : b.monedas ? [b.monedas] : []).map(String);
  try {
    const tipos = monedas.map((m) => validarTipo(m, texto(b[`tasa_${m}`])));
    if (texto(b.moneda_nueva).trim()) tipos.push(validarTipo(texto(b.moneda_nueva), texto(b.tasa_nueva)));
    const actuales = new Map((await listarTipos(c.env.DB)).map((t) => [t.moneda, t.por_eur]));
    await guardarTipos(c.env.DB, tipos.filter((t) => actuales.get(t.moneda) !== t.porEur), "manual");
  } catch (e) {
    if (e instanceof ErrorUsuario) return volver(c, "/admin/cambios", { error: e.message });
    throw e;
  }
  return volver(c, "/admin/cambios", { ok: "Tipos de cambio guardados." });
});

admin.post("/admin/cambios/:moneda/eliminar", async (c) => {
  await eliminarTipo(c.env.DB, c.req.param("moneda"));
  return volver(c, "/admin/cambios", { ok: "Moneda quitada." });
});

admin.post("/admin/cambios/bce", async (c) => {
  let datos;
  try {
    datos = await descargarTiposBce();
  } catch (e) {
    if (e instanceof ErrorUsuario) return volver(c, "/admin/cambios", { error: e.message });
    throw e;
  }
  const actuales = new Map((await listarTipos(c.env.DB)).map((t) => [t.moneda, t.por_eur]));
  return vista(
    c,
    `Tipos del BCE (${datos.fecha})`,
    <form method="post" action="/admin/cambios/bce/confirmar">
      <p>Marca las monedas que quieres guardar. Las que ya tienes en la tabla vienen marcadas.</p>
      <table>
        <thead>
          <tr>
            <th>
              <input type="checkbox" data-marcar-todos="monedas" aria-label="Marcar todas" />
            </th>
            <th>Moneda</th>
            <th>Actual</th>
            <th>BCE</th>
          </tr>
        </thead>
        <tbody>
          {datos.tipos.map((t) => (
            <tr>
              <td>
                <input type="checkbox" name="monedas" value={t.moneda} checked={actuales.has(t.moneda)} />
                <input type="hidden" name={`tasa_${t.moneda}`} value={String(t.porEur)} />
              </td>
              <td>{t.moneda}</td>
              <td>{actuales.get(t.moneda) ?? "—"}</td>
              <td>{t.porEur}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="submit">Guardar las marcadas</button> <a href="/admin/cambios">Cancelar</a>
    </form>,
  );
});

admin.post("/admin/cambios/bce/confirmar", async (c) => {
  const b = await c.req.parseBody({ all: true });
  const monedas = (Array.isArray(b.monedas) ? b.monedas : b.monedas ? [b.monedas] : []).map(String);
  try {
    await guardarTipos(c.env.DB, monedas.map((m) => validarTipo(m, texto(b[`tasa_${m}`]))), "BCE");
  } catch (e) {
    if (e instanceof ErrorUsuario) return volver(c, "/admin/cambios", { error: e.message });
    throw e;
  }
  return volver(c, "/admin/cambios", { ok: `${monedas.length} tipos guardados desde el BCE.` });
});

// ---------- Países ----------

admin.get("/admin/paises", async (c) => {
  const [bloqueados, config] = await Promise.all([listarBloqueados(c.env.DB), leerConfig(c.env.DB)]);
  const set = new Set(bloqueados.map((b) => b.codigo));
  return vista(
    c,
    "Países bloqueados",
    <>
      <p>
        Los pedidos de estos países no pueden autorizarse ni sus tiradas girarse. La lista empieza vacía: añade los países donde la normativa sobre premios aleatorios ligados a
        compras no te permita la promoción (revísalo con un abogado).
      </p>
      {bloqueados.length ? (
        <table>
          <thead>
            <tr>
              <th>País</th>
              <th>Desde</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {bloqueados.map((b) => (
              <tr>
                <td>
                  {b.codigo} · {nombrePais(b.codigo)} {UE_EEE.has(b.codigo) ? <small>(UE/EEE)</small> : null}
                </td>
                <td>{fecha(c.env, b.creado_en)}</td>
                <td>
                  <form method="post" action={`/admin/paises/${b.codigo}/eliminar`}>
                    <button type="submit" class="mini secundario">
                      Desbloquear
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p class="vacio">No hay países bloqueados.</p>
      )}
      <div class="rejilla">
        <form method="post" action="/admin/paises" class="tarjeta">
          <h2>Bloquear un país</h2>
          <select name="codigo" required>
            <option value=""></option>
            {CODIGOS_PAISES.filter((p) => !set.has(p)).map((p) => (
              <option value={p}>
                {p} · {nombrePais(p)}
              </option>
            ))}
          </select>
          <button type="submit">Bloquear</button>
        </form>
        <form method="post" action="/admin/paises/geobloqueo" class="tarjeta">
          <h2>Bloqueo también por IP</h2>
          <p class="pequeno">
            Además del país del pedido, impide girar si la conexión viene de un país bloqueado (cabecera CF-IPCountry de Cloudflare). Es una capa extra: con una VPN se puede saltar
            y puede afectar a clientes de viaje.
          </p>
          <label class="check">
            <input type="checkbox" name="activo" value="1" checked={config.geobloqueo_ip === "1"} /> Activado
          </label>
          <button type="submit">Guardar</button>
        </form>
      </div>
    </>,
  );
});

admin.post("/admin/paises", async (c) => {
  const b = await c.req.parseBody();
  try {
    const codigo = await bloquearPais(c.env.DB, texto(b.codigo));
    return volver(c, "/admin/paises", { ok: `${codigo} bloqueado.` });
  } catch (e) {
    if (e instanceof ErrorUsuario) return volver(c, "/admin/paises", { error: e.message });
    throw e;
  }
});

admin.post("/admin/paises/:codigo/eliminar", async (c) => {
  await desbloquearPais(c.env.DB, c.req.param("codigo"));
  return volver(c, "/admin/paises", { ok: "País desbloqueado." });
});

admin.post("/admin/paises/geobloqueo", async (c) => {
  const b = await c.req.parseBody();
  await guardarConfig(c.env.DB, { geobloqueo_ip: b.activo === "1" ? "1" : "0" });
  return volver(c, "/admin/paises", { ok: "Guardado." });
});

// ---------- Correos ----------

admin.get("/admin/correos", async (c) => {
  const db = c.env.DB;
  const config = await leerConfig(db);
  const [estado, { results }] = await Promise.all([
    estadoCorreos(db, config),
    db
      .prepare("SELECT * FROM correos WHERE estado IN ('pendiente', 'enviando', 'error') ORDER BY estado = 'error' DESC, id LIMIT 200")
      .all<{ id: number; tipo: string; destinatario: string; estado: string; intentos: number; ultimo_error: string | null; creado_en: string }>(),
  ]);
  return vista(
    c,
    "Correos",
    <>
      <div class="rejilla">
        <BarraCorreos e={estado} />
        <div class="tarjeta">
          <h2>Acciones</h2>
          <form method="post" action="/admin/correos/procesar">
            <button type="submit">Enviar la cola ahora</button>
          </form>
          {estado.pausaHasta ? (
            <form method="post" action="/admin/correos/quitar-pausa">
              <button type="submit" class="secundario">
                Quitar la pausa
              </button>
            </form>
          ) : null}
          <p class="pequeno">El cron envía la cola cada 10 minutos. Los correos de resultado tienen prioridad sobre los enlaces.</p>
        </div>
      </div>
      <form method="post" action="/admin/correos/acciones">
        <div class="acciones">
          <button name="accion" value="reintentar">
            Reintentar marcados
          </button>
          <button name="accion" value="descartar" class="peligro" data-confirmar="¿Descartar los correos marcados? No se enviarán.">
            Descartar marcados
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>
                <input type="checkbox" data-marcar-todos="ids" aria-label="Marcar todos" />
              </th>
              <th>Creado</th>
              <th>Tipo</th>
              <th>Para</th>
              <th>Estado</th>
              <th>Intentos</th>
              <th>Último error</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr>
                <td>
                  <input type="checkbox" name="ids" value={r.id} />
                </td>
                <td>{fecha(c.env, r.creado_en)}</td>
                <td>{r.tipo === "enlace" ? "Enlace" : "Resultado"}</td>
                <td>{r.destinatario}</td>
                <td>{r.estado}</td>
                <td>{r.intentos}</td>
                <td>
                  <small>{r.ultimo_error ?? ""}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {results.length === 0 ? <p class="vacio">La cola está vacía.</p> : null}
      </form>
    </>,
  );
});

admin.post("/admin/correos/procesar", async (c) => {
  const r = await procesarCola(c.env);
  const motivos: Record<string, string> = {
    pausa: "los envíos están en pausa",
    sin_clave: "falta BREVO_API_KEY",
    sin_remitente: "falta REMITENTE_EMAIL",
    clave_smtp: "BREVO_API_KEY es una clave SMTP (xsmtpsib-), hace falta una de API (xkeysib-)",
    sin_url: "falta la URL pública",
    cupo: "cupo diario alcanzado",
    vacia: "la cola está vacía",
  };
  return volver(c, "/admin/correos", { ok: `Enviados: ${r.enviados} · fallidos: ${r.fallidos} · descartados: ${r.descartados}${r.motivo ? ` (${motivos[r.motivo]})` : ""}.` });
});

admin.post("/admin/correos/quitar-pausa", async (c) => {
  await quitarPausa(c.env.DB);
  return volver(c, "/admin/correos", { ok: "Pausa quitada." });
});

admin.post("/admin/correos/acciones", async (c) => {
  const b = await c.req.parseBody({ all: true });
  const ids = enteros(b.ids);
  if (!ids.length) return volver(c, "/admin/correos", { error: "No has marcado ningún correo." });
  if (b.accion === "reintentar") return volver(c, "/admin/correos", { ok: `${await reintentarCorreos(c.env.DB, ids)} correos vuelven a la cola.` });
  if (b.accion === "descartar") return volver(c, "/admin/correos", { ok: `${await descartarCorreos(c.env.DB, ids)} correos descartados.` });
  return volver(c, "/admin/correos", { error: "Acción desconocida." });
});

// ---------- RGPD ----------

admin.get("/admin/rgpd", async (c) => {
  const correo = c.req.query("correo") ?? "";
  const datos = correo ? await datosDePersona(c.env.DB, correo) : null;
  return vista(
    c,
    "Datos personales (RGPD)",
    <>
      <p>
        Busca un correo para ver qué datos guardamos (derecho de acceso) o borrarlos (derecho de supresión). Se guardan solo los datos mínimos: correo, n.º de pedido, importe,
        moneda, país, fecha, IP del giro (recortada a los {CONFIG_POR_DEFECTO.anonimizar_ip_dias} días por defecto) y, si hay premio de ARK, gamertag, plataforma y Discord.
      </p>
      <form method="get" class="buscar">
        <input name="correo" type="email" value={correo} required placeholder="cliente@ejemplo.com" />
        <button type="submit">Buscar</button>
      </form>
      {correo && !datos ? <p class="flash error">Correo no válido.</p> : null}
      {datos ? (
        <div class="tarjeta">
          <h2>{datos.correo}</h2>
          <p>
            {datos.pedidos.length} pedidos · {datos.tiradas.length} tiradas · {datos.correos} correos en el registro de envíos.
          </p>
          <ul>
            {datos.pedidos.map((p) => (
              <li>
                Pedido {p.numero} · {fecha(c.env, p.fecha)} · {formatearMoneda(p.importe_x100, p.moneda)} · {p.pais} · {p.estado}
              </li>
            ))}
            {datos.tiradas.map((t) => (
              <li>
                Tirada {t.id} · {t.estado} · {t.premio_nombre ?? "sin girar"} {t.ip ? `· IP ${t.ip}` : ""} {t.ark_gamertag ? `· ${t.ark_gamertag} (${t.ark_plataforma})` : ""}
              </li>
            ))}
          </ul>
          <p>
            <a class="boton secundario" href={`/admin/tiradas.csv${qs({ correo: datos.correo })}`}>
              Exportar sus tiradas (CSV)
            </a>
          </p>
          <form method="post" action="/admin/rgpd/borrar">
            <input type="hidden" name="correo" value={datos.correo} />
            <label class="check">
              <input type="checkbox" name="confirmar" value="1" required /> Confirmo que esta persona ha pedido borrar sus datos.
            </label>
            <p class="pequeno">
              Se borran correo, IP y datos de entrega, y se anulan sus tiradas pendientes. Se conservan, sin datos personales, el n.º de pedido (para que no pueda importarse otra vez
              y dar otra tirada), importes, premios y costes.
            </p>
            <button type="submit" class="peligro">
              Borrar sus datos
            </button>
          </form>
        </div>
      ) : null}
    </>,
  );
});

admin.post("/admin/rgpd/borrar", async (c) => {
  const b = await c.req.parseBody();
  if (b.confirmar !== "1") return volver(c, "/admin/rgpd", { error: "Marca la casilla de confirmación." });
  const r = await borrarDatosDePersona(c.env.DB, texto(b.correo));
  return volver(c, "/admin/rgpd", { ok: `Datos borrados: ${r.pedidos} pedidos, ${r.tiradas} tiradas y ${r.correos} correos anonimizados.` });
});

// ---------- Ajustes ----------

admin.get("/admin/ajustes", async (c) => {
  const config = await leerConfig(c.env.DB);
  const url = urlBase(c.env, config);
  return vista(
    c,
    "Ajustes",
    <form method="post" action="/admin/ajustes" class="ajustes">
      <fieldset class="tarjeta">
        <legend>Fechas de campaña (opcional)</legend>
        <p class="pequeno">Solo dan tirada los pedidos con fecha dentro de este periodo. Déjalas vacías para no limitar.</p>
        <label>
          Inicio <input type="date" name="campana_inicio" value={config.campana_inicio} />
        </label>
        <label>
          Fin <input type="date" name="campana_fin" value={config.campana_fin} />
        </label>
      </fieldset>
      <fieldset class="tarjeta">
        <legend>Correo (Brevo)</legend>
        <label>
          Límite diario de envíos <input name="correo_limite_diario" value={config.correo_limite_diario} inputmode="numeric" class="corto" />
        </label>
        <label>
          Reserva para resultados de giros <input name="correo_reserva_resultados" value={config.correo_reserva_resultados} inputmode="numeric" class="corto" />
        </label>
        <p class="pequeno">
          El plan gratuito de Brevo permite 300 correos al día. Los enlaces dejan de enviarse al llegar a «límite − reserva», para que los clientes que giran sigan recibiendo su
          resultado. Remitente: {c.env.REMITENTE_EMAIL || "sin configurar (variable REMITENTE_EMAIL en Cloudflare)"}.
        </p>
      </fieldset>
      <fieldset class="tarjeta">
        <legend>Premios de ARK</legend>
        <label>
          Plataformas (una por línea) <textarea name="plataformas_ark" rows={4}>{config.plataformas_ark}</textarea>
        </label>
      </fieldset>
      <fieldset class="tarjeta">
        <legend>Privacidad</legend>
        <label>
          Recortar IPs tras (días) <input name="anonimizar_ip_dias" value={config.anonimizar_ip_dias} inputmode="numeric" class="corto" />
        </label>
      </fieldset>
      <fieldset class="tarjeta">
        <legend>Webhook de pedidos (opcional)</legend>
        <label class="check">
          <input type="checkbox" name="webhook_activo" value="1" checked={config.webhook_activo === "1"} /> Activado
        </label>
        <p class="pequeno">
          Endpoint: <code>{url || "(URL pública)"}/api/webhook/pedidos</code> · Secreto WEBHOOK_SECRET: {c.env.WEBHOOK_SECRET ? "configurado" : "NO configurado (el webhook seguirá respondiendo 404)"}. Los
          pedidos llegan como pendientes; nunca se autorizan solos.
        </p>
      </fieldset>
      <p class="pequeno">URL pública usada en los correos: {url || "aún no conocida (entra al panel desde la URL de workers.dev o define URL_BASE)"}.</p>
      <button type="submit">Guardar ajustes</button>
    </form>,
  );
});

admin.post("/admin/ajustes", async (c) => {
  const b = await c.req.parseBody();
  const inicio = texto(b.campana_inicio) ? normalizarFecha(texto(b.campana_inicio)) : "";
  const fin = texto(b.campana_fin) ? normalizarFecha(texto(b.campana_fin)) : "";
  if (inicio === null || fin === null) return volver(c, "/admin/ajustes", { error: "Fecha de campaña no válida." });
  if (inicio && fin && fin < inicio) return volver(c, "/admin/ajustes", { error: "La fecha de fin es anterior a la de inicio." });
  const limite = enteroConfig(texto(b.correo_limite_diario), -1);
  const reserva = enteroConfig(texto(b.correo_reserva_resultados), -1);
  const dias = enteroConfig(texto(b.anonimizar_ip_dias), -1);
  if (limite < 0 || reserva < 0 || reserva > limite) return volver(c, "/admin/ajustes", { error: "Revisa el límite y la reserva de correos." });
  if (dias < 1 || dias > 3650) return volver(c, "/admin/ajustes", { error: "Los días para recortar IPs deben estar entre 1 y 3650." });
  const plataformasTxt = texto(b.plataformas_ark).split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 20).join("\n");
  if (!plataformasTxt) return volver(c, "/admin/ajustes", { error: "Indica al menos una plataforma." });
  const cambios: Partial<Config> = {
    campana_inicio: inicio,
    campana_fin: fin,
    correo_limite_diario: String(limite),
    correo_reserva_resultados: String(reserva),
    plataformas_ark: plataformasTxt,
    anonimizar_ip_dias: String(dias),
    webhook_activo: b.webhook_activo === "1" ? "1" : "0",
  };
  await guardarConfig(c.env.DB, cambios);
  return volver(c, "/admin/ajustes", { ok: "Ajustes guardados." });
});

admin.post("/admin/mantenimiento", async (c) => {
  await mantenimientoDiario(c.env, true);
  return volver(c, "/admin", { ok: "Mantenimiento ejecutado." });
});

export type { Premio, Ruleta };
