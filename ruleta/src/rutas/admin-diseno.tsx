import type { Hono } from "hono";
import { AzarCripto, elegirPonderado } from "../lib/azar";
import { CAMPOS_TEXTO, DURACION_MAX, DURACION_MIN, disenoDesdeFormulario, ETIQUETAS, FONDOS, leerDiseno, MARCOS, type CampoTexto, type Diseno } from "../lib/diseno";
import { ErrorUsuario } from "../lib/errores";
import { elegirIdioma } from "../lib/i18n";
import { MAX_BYTES_BIBLIOTECA, MAX_BYTES_IMAGEN, urlImagen } from "../lib/medios";
import { analizarRuleta, estaDisponible } from "../lib/probabilidades";
import { guardarDiseno, listarRuletas } from "../servicios/catalogo";
import { leerConfig, plataformas } from "../servicios/config";
import { eliminarImagen, espacioUsado, listarImagenes, refDe, renombrarImagen, subirImagenes, usosDeImagenes } from "../servicios/imagenes";
import { premiosDeRuleta, ruletaPorId } from "../servicios/tiradas";
import type { Idioma, Ruleta, Tirada } from "../tipos";
import { Avisos } from "../vistas/admin-base";
import { PaginaRuleta, TarjetaResultado, type Marco } from "../vistas/publico";
import { fecha, PaletaColores, SelectorColor, SelectorImagen, texto, vista, volver } from "./admin-comun";
import { segmentosDe } from "./publico";
import { aTexto, html, type App, type Ctx } from "./util";

const ETIQUETAS_TEXTO: Record<CampoTexto, string> = {
  antetitulo: "Antetítulo",
  antetitulo_en: "Antetítulo (en)",
  titulo: "Título",
  titulo_en: "Título (en)",
  intro: "Texto de introducción",
  intro_en: "Texto de introducción (en)",
  boton: "Texto del botón",
  boton_en: "Texto del botón (en)",
};

const kb = (b: number) => (b >= 1_000_000 ? `${(b / 1_000_000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1000))} kB`);

/** Página de la ruleta en modo vista previa (dentro del iframe del panel o en otra pestaña). */
async function vistaPrevia(c: Ctx, ruleta: Ruleta, diseno: Diseno, color: string, color2: string | null): Promise<Response> {
  const idioma: Idioma = elegirIdioma(c.req.query("lang"), null, "es");
  const premios = await premiosDeRuleta(c.env.DB, ruleta.id);
  const segmentos = segmentosDe(premios, idioma);
  const marco: Marco = { env: c.env, idioma, ruta: `/admin/diseno/${ruleta.id}/vista`, nonce: c.get("nonce") };
  c.set("enmarcable", true); // se muestra dentro del panel (mismo origen)
  c.header("Cache-Control", "no-store");
  if (!segmentos.length) {
    return html(
      c,
      <html lang="es">
        <body>
          <p>Esta ruleta no tiene ningún premio disponible (activo, con probabilidad y con stock o códigos). Añádelos en Premios.</p>
        </body>
      </html>,
    );
  }
  return html(
    c,
    <PaginaRuleta
      marco={marco}
      tirada={null}
      ruleta={{ ...ruleta, color, color2 }}
      segmentos={segmentos}
      token=""
      diseno={diseno}
      demo={{
        api: `/admin/diseno/${ruleta.id}/simular?lang=${idioma}`,
        aviso: idioma === "es" ? "Vista previa: los giros son de prueba, no gastan tiradas ni guardan nada." : "Preview: test spins only, nothing is used or saved.",
      }}
    />,
  );
}

export function rutasDiseno(admin: Hono<App>) {
  // ---------- Diseño ----------

  admin.get("/admin/diseno", async (c) => {
    const db = c.env.DB;
    const ruletas = await listarRuletas(db);
    if (!ruletas.length) return vista(c, "Diseño", <p>Primero crea una ruleta en Tramos.</p>);
    const ruleta = ruletas.find((r) => r.id === Number(c.req.query("ruleta"))) ?? ruletas[0];
    const [imagenes, premios] = await Promise.all([listarImagenes(db), premiosDeRuleta(db, ruleta.id)]);
    const d = leerDiseno(ruleta.diseno);
    const a = analizarRuleta(ruleta, premios);
    const fuera = a.agotados.length ? a.avisos.filter((x) => x.includes("queda fuera")) : [];
    const sinImagenes = imagenes.length === 0;
    return vista(
      c,
      "Diseño de la ruleta",
      <>
        <PaletaColores />
        <nav class="pestanas">
          {ruletas.map((r) => (
            <a href={`/admin/diseno?ruleta=${r.id}`} class={r.id === ruleta.id ? "activo" : ""}>
              {r.nombre}
              {r.activa ? "" : " (inactiva)"}
            </a>
          ))}
        </nav>
        <div class="diseno">
          <form method="post" action={`/admin/diseno/${ruleta.id}`} class="diseno-form" id="form-diseno" data-vista-previa-auto>
            <fieldset>
              <legend>Colores</legend>
              <div class="fila-campos">
                <label>
                  Color principal <SelectorColor nombre="color" valor={ruleta.color} />
                </label>
                <label>
                  Segundo color <SelectorColor nombre="color2" valor={ruleta.color2 ?? ruleta.color} />
                </label>
                <label class="check">
                  <input type="checkbox" name="usar_color2" value="1" checked={!!ruleta.color2} /> Usar segundo color
                </label>
              </div>
              <p class="pequeno">El color de cada gajo es el de su premio (se cambia en Premios).</p>
            </fieldset>
            <fieldset>
              <legend>Ruleta</legend>
              <label>
                Estilo del aro
                <select name="marco">
                  {Object.entries(MARCOS).map(([k, v]) => (
                    <option value={k} selected={d.marco === k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label class="check">
                <input type="checkbox" name="luces" value="1" checked={d.luces} /> Luces en el aro (parpadean al girar y al ganar)
              </label>
              <label>
                En los gajos
                <select name="etiquetas">
                  {Object.entries(ETIQUETAS).map(([k, v]) => (
                    <option value={k} selected={d.etiquetas === k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Centro de la ruleta (logo)
                <SelectorImagen nombre="centro" valor={d.centro || null} imagenes={imagenes} vacio={{ texto: "Zarpazo (por defecto)", miniatura: urlImagen({ tipo: "icono", nombre: "garra" }) }} porDefecto={{ tipo: "icono", nombre: "garra" }} />
              </label>
            </fieldset>
            <fieldset>
              <legend>Fondo de la página</legend>
              <label>
                Fondo
                <select name="fondo">
                  {Object.entries(FONDOS).map(([k, v]) => (
                    <option value={k} selected={d.fondo === k}>
                      {v}
                    </option>
                  ))}
                  {imagenes.length ? (
                    <optgroup label="Tus imágenes">
                      {imagenes.map((i) => (
                        <option value={refDe(i)} selected={d.fondo === refDe(i)}>
                          {i.nombre}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </label>
              <label>
                <span class="rango">
                  Oscurecer la imagen de fondo: <output>{d.fondo_oscuro}</output> %
                </span>
                <input type="range" name="fondo_oscuro" min={0} max={90} step={5} value={d.fondo_oscuro} data-salida />
              </label>
              {sinImagenes ? (
                <p class="pequeno">
                  Para usar tu propio logo o fondo, súbelo antes en <a href="/admin/imagenes">Imágenes</a>.
                </p>
              ) : null}
            </fieldset>
            <fieldset>
              <legend>Textos</legend>
              <p class="pequeno">Vacío = texto por defecto. Si dejas vacío el inglés, se usa el español.</p>
              <div class="rejilla-textos">
                {(Object.keys(CAMPOS_TEXTO) as CampoTexto[]).map((k) =>
                  k.startsWith("intro") ? (
                    <label class="ancho">
                      {ETIQUETAS_TEXTO[k]}
                      <textarea name={`texto_${k}`} rows={2} maxlength={CAMPOS_TEXTO[k]}>
                        {d.textos[k]}
                      </textarea>
                    </label>
                  ) : (
                    <label>
                      {ETIQUETAS_TEXTO[k]}
                      <input name={`texto_${k}`} value={d.textos[k]} maxlength={CAMPOS_TEXTO[k]} />
                    </label>
                  ),
                )}
              </div>
            </fieldset>
            <fieldset>
              <legend>Efectos</legend>
              <label class="check">
                <input type="checkbox" name="sonido" value="1" checked={d.sonido} /> Sonido (clics al girar y fanfarria; el cliente puede silenciarlo)
              </label>
              <label class="check">
                <input type="checkbox" name="confeti" value="1" checked={d.confeti} /> Confeti al ganar
              </label>
              <label>
                <span class="rango">
                  Duración del giro: <output>{d.duracion}</output> s
                </span>
                <input type="range" name="duracion" min={DURACION_MIN} max={DURACION_MAX} step={1} value={d.duracion} data-salida />
              </label>
            </fieldset>
            <div class="acciones">
              <button type="submit">Guardar diseño</button>
              <button type="submit" formaction={`/admin/diseno/${ruleta.id}/vista`} formtarget="vista-previa" class="secundario" id="boton-previsualizar">
                Previsualizar sin guardar
              </button>
              <a class="boton secundario" href={`/admin/diseno/${ruleta.id}/vista`} target="_blank" rel="noopener">
                Abrir en pestaña nueva ↗
              </a>
            </div>
          </form>
          <div class="vista-previa">
            <p class="pequeno">
              Vista previa en vivo (se actualiza sola al cambiar algo). Pulsa «Girar» para probarla: los giros de prueba no gastan tiradas.
            </p>
            {fuera.length ? <Avisos avisos={fuera} /> : null}
            <iframe name="vista-previa" src={`/admin/diseno/${ruleta.id}/vista`} title="Vista previa de la ruleta" loading="lazy"></iframe>
          </div>
        </div>
      </>,
    );
  });

  admin.post("/admin/diseno/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const destino = `/admin/diseno?ruleta=${id}`;
    try {
      const b = await c.req.parseBody();
      const { diseno, imagenes } = disenoDesdeFormulario(b);
      await guardarDiseno(c.env.DB, id, { color: b.color, color2: b.usar_color2 === "1" ? b.color2 : null, diseno, imagenes });
    } catch (e) {
      if (e instanceof ErrorUsuario) return volver(c, destino, { error: e.message });
      throw e;
    }
    return volver(c, destino, { ok: "Diseño guardado. Ya lo ven tus clientes." });
  });

  // Vista previa con el diseño guardado.
  admin.get("/admin/diseno/:id/vista", async (c) => {
    const ruleta = await ruletaPorId(c.env.DB, Number(c.req.param("id")));
    if (!ruleta) return c.text("Ruleta no encontrada", 404);
    return vistaPrevia(c, ruleta, leerDiseno(ruleta.diseno), ruleta.color, ruleta.color2);
  });

  // Vista previa con los cambios del formulario, sin guardarlos.
  admin.post("/admin/diseno/:id/vista", async (c) => {
    const ruleta = await ruletaPorId(c.env.DB, Number(c.req.param("id")));
    if (!ruleta) return c.text("Ruleta no encontrada", 404);
    const b = await c.req.parseBody();
    let diseno: Diseno;
    try {
      diseno = disenoDesdeFormulario(b).diseno;
    } catch (e) {
      if (e instanceof ErrorUsuario) return c.text(e.message, 422);
      throw e;
    }
    const color = /^#[0-9a-f]{6}$/i.test(texto(b.color)) ? texto(b.color).toLowerCase() : ruleta.color;
    const color2 = b.usar_color2 === "1" && /^#[0-9a-f]{6}$/i.test(texto(b.color2)) ? texto(b.color2).toLowerCase() : null;
    return vistaPrevia(c, ruleta, diseno, color, color2);
  });

  // Giro de prueba: elige con las probabilidades reales, pero no escribe nada en la base de datos.
  admin.post("/admin/diseno/:id/simular", async (c) => {
    const ruleta = await ruletaPorId(c.env.DB, Number(c.req.param("id")));
    if (!ruleta) return c.json({ ok: false, error: "no_encontrada" }, 404);
    const premio = elegirPonderado((await premiosDeRuleta(c.env.DB, ruleta.id)).filter(estaDisponible), new AzarCripto());
    if (!premio) return c.json({ ok: false, error: "sin_premios", mensaje: "No hay premios disponibles." }, 503);
    const idioma: Idioma = elegirIdioma(c.req.query("lang"), null, "es");
    const momento = new Date().toISOString();
    const tirada: Tirada = {
      id: 0, pedido_id: null, correo: "", pais: null, idioma, ruleta_id: ruleta.id, origen: "manual", estado: "usada", token_hash: null,
      expira_en: null, enviada_en: null, creada_en: momento, usada_en: momento, revocada_en: null, premio_id: premio.id, premio_nombre: premio.nombre,
      premio_nombre_en: premio.nombre_en, premio_tipo: premio.tipo, premio_rareza: premio.rareza, premio_coste_cents: premio.coste_cents,
      premio_imagen: premio.imagen, premio_descripcion: premio.descripcion, premio_descripcion_en: premio.descripcion_en,
      cupon_codigo: premio.tipo === "cupon" ? "EJEMPLO-1234" : null, ip: null, ip_pais: null, ark_gamertag: null, ark_plataforma: null,
      ark_discord: null, ark_datos_en: null, entregada_en: null, nota: null,
    };
    const marco: Marco = { env: c.env, idioma, ruta: "/", nonce: c.get("nonce") };
    const tarjeta = await aTexto(<TarjetaResultado marco={marco} tirada={tirada} token="" plataformas={plataformas(await leerConfig(c.env.DB))} demo />);
    return c.json({ ok: true, premioId: premio.id, html: tarjeta });
  });

  // ---------- Imágenes ----------

  admin.get("/admin/imagenes", async (c) => {
    const db = c.env.DB;
    const [imagenes, usos, espacio] = await Promise.all([listarImagenes(db), usosDeImagenes(db), espacioUsado(db)]);
    const porcentaje = Math.min(100, Math.round((espacio.bytes / MAX_BYTES_BIBLIOTECA) * 100));
    return vista(
      c,
      "Imágenes",
      <>
        <p>
          Sube logos, fotos o dibujos de tus premios y fondos. Luego elígelos en <a href="/admin/premios">Premios</a> (imagen de cada premio) o en{" "}
          <a href="/admin/diseno">Diseño</a> (centro de la ruleta y fondo de la página). Puedes subir todas las que quieras hasta llenar el espacio.
        </p>
        <form method="post" action="/admin/imagenes" enctype="multipart/form-data" class="tarjeta estrecha" id="form-imagenes">
          <h2>Subir imágenes</h2>
          <label>
            Archivos (PNG, JPEG, WebP o GIF; puedes elegir varios)
            <input type="file" name="archivos" multiple required accept="image/png,image/jpeg,image/webp,image/gif" data-reducir />
          </label>
          <label>
            Uso
            <select name="uso" data-uso>
              <option value="premio">Premio o logo (se reduce a 512 px)</option>
              <option value="fondo">Fondo de página (se reduce a 1920 px)</option>
            </select>
          </label>
          <p class="pequeno" data-estado-subida>
            Consejo: para premios quedan mejor los PNG con fondo transparente. Las imágenes grandes se reducen en tu navegador antes de subirlas (máx. {kb(MAX_BYTES_IMAGEN)}{" "}
            cada una).
          </p>
          <div class="previas" data-previas></div>
          <button type="submit">Subir</button>
        </form>
        <div class={`tarjeta ${porcentaje >= 80 ? "alerta" : ""}`}>
          <p>
            {espacio.total} imágenes · {kb(espacio.bytes)} de {kb(MAX_BYTES_BIBLIOTECA)} ({porcentaje} %)
          </p>
          <progress max={100} value={porcentaje}></progress>
        </div>
        {imagenes.length ? (
          <div class="galeria">
            {imagenes.map((i) => {
              const uso = usos.get(i.id) ?? [];
              return (
                <figure class="tarjeta">
                  <div class="marco-imagen">
                    <img src={urlImagen({ tipo: "img", id: i.id, hash: i.hash.slice(0, 16) })} alt="" loading="lazy" />
                  </div>
                  <figcaption>
                    <form method="post" action={`/admin/imagenes/${i.id}/renombrar`} class="renombrar">
                      <input name="nombre" value={i.nombre} maxlength={60} aria-label="Nombre" />
                      <button type="submit" class="secundario mini">
                        Renombrar
                      </button>
                    </form>
                    <p class="pequeno">
                      {i.tipo.replace("image/", "").toUpperCase()} · {kb(i.tamano)} · {fecha(c.env, i.creada_en)}
                    </p>
                    <p class="pequeno">{uso.length ? `En uso: ${uso.join(", ")}` : "Sin usar"}</p>
                    <form method="post" action={`/admin/imagenes/${i.id}/eliminar`}>
                      <button type="submit" class="peligro mini" disabled={uso.length > 0} data-confirmar={`¿Borrar «${i.nombre}»?`}>
                        Borrar
                      </button>
                    </form>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        ) : (
          <p class="vacio">Aún no has subido ninguna imagen. Mientras tanto puedes usar los iconos incluidos.</p>
        )}
      </>,
    );
  });

  admin.post("/admin/imagenes", async (c) => {
    try {
      const b = await c.req.parseBody({ all: true });
      const valores = Array.isArray(b.archivos) ? b.archivos : b.archivos === undefined ? [] : [b.archivos];
      const archivos = valores.filter((v): v is File => typeof v !== "string" && v.size > 0);
      const r = await subirImagenes(c.env.DB, archivos);
      const partes = [`${r.subidas} imágenes subidas`];
      if (r.repetidas) partes.push(`${r.repetidas} ya estaban en la biblioteca`);
      return volver(c, "/admin/imagenes", { ok: r.subidas || r.repetidas ? partes.join(" · ") + "." : undefined, error: r.errores.join(" ") || undefined });
    } catch (e) {
      if (e instanceof ErrorUsuario) return volver(c, "/admin/imagenes", { error: e.message });
      throw e;
    }
  });

  admin.post("/admin/imagenes/:id/renombrar", async (c) => {
    const b = await c.req.parseBody();
    await renombrarImagen(c.env.DB, Number(c.req.param("id")), texto(b.nombre));
    return volver(c, "/admin/imagenes", { ok: "Nombre cambiado." });
  });

  admin.post("/admin/imagenes/:id/eliminar", async (c) => {
    try {
      await eliminarImagen(c.env.DB, Number(c.req.param("id")));
      return volver(c, "/admin/imagenes", { ok: "Imagen borrada." });
    } catch (e) {
      if (e instanceof ErrorUsuario) return volver(c, "/admin/imagenes", { error: e.message });
      throw e;
    }
  });
}

