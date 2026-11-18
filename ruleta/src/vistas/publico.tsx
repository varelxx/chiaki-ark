import { urlEstatico } from "../rutas/estaticos";
import type { FC, PropsWithChildren } from "hono/jsx";
import { raw } from "hono/html";
import { formatearEur } from "../lib/dinero";
import { leerDiseno, type Diseno } from "../lib/diseno";
import { nombreSegun, t } from "../lib/i18n";
import { imagenDePremio, leerRef, urlImagen, type RefImagen } from "../lib/medios";
import { nombrePais } from "../lib/paises";
import { claseColor, hexDe, reglasColores } from "../lib/rarezas";
import { formatearFecha } from "../lib/tiempo";
import type { Env, Idioma, Ruleta, Tirada } from "../tipos";
import { calcularAngulos, svgMarco, svgRotor, type Segmento } from "./ruleta-svg";

export interface Marco {
  env: Env;
  idioma: Idioma;
  ruta: string; // ruta actual sin query, para el cambio de idioma
  nonce: string; // nonce CSP del <style> con colores e imágenes personalizados
}

const enlaceIdioma = (ruta: string, idioma: Idioma) => `${ruta}?lang=${idioma}`;

/** Estilo de una ruleta: colores del tema, colores libres usados y fondo con imagen propia. */
export function estiloRuleta(ruleta: Pick<Ruleta, "color" | "color2">, d: Diseno, colores: Array<string | null | undefined> = []): string {
  const c1 = hexDe(ruleta.color);
  const c2 = ruleta.color2 ? hexDe(ruleta.color2) : null;
  let css = `body{--c1:${c1}${c2 ? `;--c2:${c2}` : ""}}` + reglasColores(colores);
  const fondo = leerRef(d.fondo);
  if (fondo?.tipo === "img") {
    const o = (d.fondo_oscuro / 100).toFixed(2);
    css += `.fondo-imagen .fondo{background-image:linear-gradient(rgba(8,10,8,${o}),rgba(8,10,8,${o})),url(${urlImagen(fondo)})}`;
  }
  return css;
}

export const claseFondo = (d: Diseno): string => (leerRef(d.fondo)?.tipo === "img" ? "fondo-imagen" : `fondo-${d.fondo}`);

export const PaginaPublica: FC<PropsWithChildren<{ marco: Marco; titulo: string; estilo?: string; claseCuerpo?: string; script?: boolean }>> = ({
  marco,
  titulo,
  estilo,
  claseCuerpo = "fondo-reticula",
  script,
  children,
}) => {
  const { env, idioma, ruta } = marco;
  const otro: Idioma = idioma === "es" ? "en" : "es";
  return (
    <html lang={idioma}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="same-origin" />
        <meta name="color-scheme" content="dark" />
        <title>{`${titulo} · ${env.TIENDA_NOMBRE}`}</title>
        <link rel="icon" href={urlEstatico("/favicon.svg")} type="image/svg+xml" />
        <link rel="stylesheet" href={urlEstatico("/css/app.css")} />
        {estilo ? <style nonce={marco.nonce}>{raw(estilo)}</style> : null}
        {script ? <script src={urlEstatico("/js/ruleta.js")} defer></script> : null}
      </head>
      <body class={claseCuerpo}>
        <div class="fondo" aria-hidden="true"></div>
        <header class="cabecera">
          <span class="marca">{env.TIENDA_NOMBRE}</span>
          <a class="idioma" href={enlaceIdioma(ruta, otro)} hreflang={otro} lang={otro}>
            {otro === "en" ? "English" : "Español"}
          </a>
        </header>
        <main class="contenido">{children}</main>
        <footer class="pie">
          <nav>
            <a href={`/legal/terminos?lang=${idioma}`}>{t(idioma, "terminos")}</a>
            <a href={`/legal/privacidad?lang=${idioma}`}>{t(idioma, "privacidad")}</a>
            <a href={`/probabilidades?lang=${idioma}`}>{t(idioma, "todas_prob")}</a>
            {env.TIENDA_URL ? <a href={env.TIENDA_URL}>{t(idioma, "volver_tienda")}</a> : null}
          </nav>
          <p class="aviso-marca">{t(idioma, "aviso_marca", { tienda: env.TIENDA_NOMBRE })}</p>
        </footer>
      </body>
    </html>
  );
};

/** Miniatura del premio: icono blanco sobre un disco de su color, o la imagen subida. */
const Insignia: FC<{ imagen: RefImagen; color: string; clase?: string }> = ({ imagen, color, clase = "insignia" }) => (
  <span class={`${clase}${imagen.tipo === "img" ? " foto" : ""} ${claseColor(color)}`} aria-hidden="true">
    <img src={urlImagen(imagen)} alt="" width={64} height={64} loading="lazy" decoding="async" />
  </span>
);

export const TablaProbabilidades: FC<{ segmentos: Segmento[]; idioma: Idioma; nota?: boolean }> = ({ segmentos, idioma, nota = true }) => (
  <section class="probabilidades" aria-labelledby="tit-prob">
    <h2 id="tit-prob">{t(idioma, "probabilidades")}</h2>
    {nota ? <p class="nota">{t(idioma, "probabilidades_nota")}</p> : null}
    <table>
      <thead>
        <tr>
          <th scope="col">{t(idioma, "col_premio")}</th>
          <th scope="col" class="num">
            {t(idioma, "col_prob")}
          </th>
        </tr>
      </thead>
      <tbody>
        {segmentos.map((s) => (
          <tr>
            <td>
              <div class="fila-premio">
                <Insignia imagen={s.imagen} color={s.rareza} />
                <div>
                  <span class="nombre-fila">{s.etiqueta}</span>
                  {s.descripcion ? <span class="detalle-fila">{s.descripcion}</span> : null}
                </div>
              </div>
            </td>
            <td class="num">{(s.prob * 100).toLocaleString(idioma === "es" ? "es-ES" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %</td>
          </tr>
        ))}
      </tbody>
    </table>
  </section>
);

/** Texto personalizado del diseño o, si está vacío, el texto por defecto. */
export function textosRuleta(d: Diseno, ruleta: Ruleta, idioma: Idioma) {
  const elegir = (es: string, en: string, defecto: string) => (idioma === "en" ? en || es : es) || defecto;
  return {
    antetitulo: elegir(d.textos.antetitulo, d.textos.antetitulo_en, t(idioma, "cabecera")),
    titulo: elegir(d.textos.titulo, d.textos.titulo_en, nombreSegun(idioma, ruleta)),
    intro: elegir(d.textos.intro, d.textos.intro_en, t(idioma, "intro")),
    boton: elegir(d.textos.boton, d.textos.boton_en, t(idioma, "girar")),
  };
}

export interface ModoDemo {
  api: string;
  aviso: string;
}

export const PaginaRuleta: FC<{ marco: Marco; tirada: Tirada | null; ruleta: Ruleta; segmentos: Segmento[]; token: string; diseno?: Diseno; demo?: ModoDemo }> = ({
  marco,
  tirada,
  ruleta,
  segmentos,
  token,
  diseno,
  demo,
}) => {
  const { idioma, env } = marco;
  const d = diseno ?? leerDiseno(ruleta.diseno);
  const angulos = calcularAngulos(segmentos);
  const textos = textosRuleta(d, ruleta, idioma);
  const centro = d.centro ? leerRef(d.centro) : null;
  const datos = JSON.stringify({
    api: demo ? demo.api : `/api/tirada/${token}/girar?lang=${idioma}`,
    demo: !!demo,
    segmentos: angulos.map((s) => ({ id: s.id, inicio: s.inicio, fin: s.fin, color: hexDe(s.rareza) })),
    efectos: { sonido: d.sonido, confeti: d.confeti, duracion: d.duracion },
    colores: [hexDe(ruleta.color), hexDe(ruleta.color2 ?? ruleta.color)],
    textos: {
      girar: textos.boton,
      girando: t(idioma, "girando"),
      error: t(idioma, "error_red"),
      copiado: t(idioma, "copiado"),
      sonidoOn: t(idioma, "sonido_on"),
      sonidoOff: t(idioma, "sonido_off"),
    },
  }).replace(/</g, "\\u003c");
  return (
    <PaginaPublica
      marco={marco}
      titulo={textos.titulo}
      estilo={estiloRuleta(ruleta, d, segmentos.map((s) => s.rareza))}
      claseCuerpo={claseFondo(d)}
      script
    >
      <section class="escena">
        {demo ? <p class="aviso-demo">{demo.aviso}</p> : null}
        <p class="antetitulo">{textos.antetitulo}</p>
        <h1>{textos.titulo}</h1>
        <p class="intro">{textos.intro}</p>
        <div class={`ruleta marco-${d.marco}${d.luces ? " con-luces" : ""}`} id="ruleta">
          <div class="haz" aria-hidden="true"></div>
          <div class="rotor" id="rotor">
            {raw(svgRotor(angulos, d, textos.titulo))}
          </div>
          {raw(svgMarco(d, centro))}
        </div>
        <form method="post" action={demo ? "#" : `/tirada/${token}/girar?lang=${idioma}`} class="form-girar" id="form-girar">
          <button type="submit" class="boton-girar" id="boton-girar">
            {textos.boton}
          </button>
          {d.sonido ? (
            <button type="button" class="boton-sonido" id="boton-sonido" aria-pressed="true" aria-label={t(idioma, "sonido_off")} title={t(idioma, "sonido_off")} hidden>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path d="M4 9h4l5-4v14l-5-4H4Z" class="altavoz" />
                <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" class="ondas" />
                <path d="m16 9 6 6m0-6-6 6" class="mudo" />
              </svg>
            </button>
          ) : null}
        </form>
        {tirada ? <p class="caducidad">{t(idioma, "caduca_el", { fecha: formatearFecha(tirada.expira_en, env.ZONA_HORARIA, idioma, false) })}</p> : null}
        <div id="resultado" class="resultado-contenedor" aria-live="polite"></div>
        <p id="mensaje-error" class="mensaje-error" role="alert" hidden></p>
      </section>
      <TablaProbabilidades segmentos={segmentos} idioma={idioma} />
      <script type="application/json" id="datos-ruleta">
        {raw(datos)}
      </script>
    </PaginaPublica>
  );
};

export interface PropsResultado {
  marco: Marco;
  tirada: Tirada;
  token: string;
  plataformas: string[];
  error?: string;
  guardado?: boolean;
  /** Vista previa del panel: no se guarda nada y el formulario de entrega no se envía. */
  demo?: boolean;
}

export const TarjetaResultado: FC<PropsResultado> = ({ marco, tirada, token, plataformas, error, guardado, demo }) => {
  const { idioma, env } = marco;
  const premio = nombreSegun(idioma, { nombre: tirada.premio_nombre, nombre_en: tirada.premio_nombre_en });
  const descripcion = idioma === "en" ? tirada.premio_descripcion_en || tirada.premio_descripcion : tirada.premio_descripcion || tirada.premio_descripcion_en;
  const imagen = imagenDePremio({ imagen: tirada.premio_imagen, tipo: tirada.premio_tipo });
  const color = hexDe(tirada.premio_rareza);
  return (
    <article class={`tarjeta-premio ${claseColor(tirada.premio_rareza)}`} id="tarjeta-premio" data-color={color}>
      <div class="premio-visual" aria-hidden="true">
        <div class="rayos"></div>
        <img src={urlImagen(imagen, imagen.tipo === "icono" ? color : undefined)} alt="" width={128} height={128} decoding="async" />
      </div>
      <p class="antetitulo">{t(idioma, "premio")}</p>
      <h2 class="nombre-premio">{premio}</h2>
      {descripcion ? <p class="descripcion-premio">{descripcion}</p> : null}
      {tirada.premio_tipo === "cupon" && tirada.cupon_codigo ? (
        <div class="cupon">
          <p>{t(idioma, "cupon_texto")}</p>
          <div class="codigo">
            <code id="codigo-cupon">{tirada.cupon_codigo}</code>
            <button type="button" class="boton-secundario" data-copiar="codigo-cupon" data-copiado={t(idioma, "copiado")}>
              {t(idioma, "copiar")}
            </button>
          </div>
          <p>
            {t(idioma, "cupon_uso", { tienda: env.TIENDA_NOMBRE })} {env.TIENDA_URL ? <a href={env.TIENDA_URL}>{env.TIENDA_URL}</a> : null}
          </p>
        </div>
      ) : null}
      {tirada.premio_tipo === "ark" ? (
        tirada.estado === "entregada" ? (
          <p class="estado-entrega ok">{t(idioma, "entregado", { fecha: formatearFecha(tirada.entregada_en, env.ZONA_HORARIA, idioma, false) })}</p>
        ) : (
          <form method="post" action={demo ? "#" : `/tirada/${token}/datos-ark?lang=${idioma}`} class="form-ark">
            {guardado ? (
              <p class="aviso ok" role="status">
                {t(idioma, "datos_ok")}
              </p>
            ) : null}
            {error ? (
              <p class="aviso error" role="alert">
                {error}
              </p>
            ) : null}
            {tirada.ark_datos_en ? (
              <p class="estado-entrega">
                <strong>{t(idioma, "pendiente_entrega")}.</strong> {t(idioma, "datos_actuales", { gamertag: tirada.ark_gamertag ?? "", plataforma: tirada.ark_plataforma ?? "" })}{" "}
                {t(idioma, "datos_editar")}
              </p>
            ) : (
              <p>{t(idioma, "ark_texto")}</p>
            )}
            <fieldset disabled={demo} class="campos-ark">
              <label>
                {t(idioma, "gamertag")}
                <input name="gamertag" required minlength={2} maxlength={64} autocomplete="nickname" value={tirada.ark_gamertag ?? ""} />
              </label>
              <label>
                {t(idioma, "plataforma")}
                <select name="plataforma" required>
                  <option value=""></option>
                  {plataformas.map((p) => (
                    <option value={p} selected={p === tirada.ark_plataforma}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t(idioma, "discord")}
                <input name="discord" required minlength={2} maxlength={40} autocomplete="off" value={tirada.ark_discord ?? ""} />
              </label>
              <button type="submit" class="boton-secundario">
                {t(idioma, "enviar")}
              </button>
            </fieldset>
          </form>
        )
      ) : null}
    </article>
  );
};

export const PaginaResultado: FC<PropsResultado & { ruleta: Ruleta }> = (props) => {
  const d = leerDiseno(props.ruleta.diseno);
  return (
    <PaginaPublica
      marco={props.marco}
      titulo={t(props.marco.idioma, "usada_t")}
      estilo={estiloRuleta(props.ruleta, d, [props.tirada.premio_rareza])}
      claseCuerpo={claseFondo(d)}
      script
    >
      <section class="escena escena-resultado">
        <p class="antetitulo">{textosRuleta(d, props.ruleta, props.marco.idioma).titulo}</p>
        <TarjetaResultado {...props} />
      </section>
    </PaginaPublica>
  );
};

export const PaginaMensaje: FC<{ marco: Marco; titulo: string; texto: string }> = ({ marco, titulo, texto }) => (
  <PaginaPublica marco={marco} titulo={titulo}>
    <section class="escena escena-mensaje">
      <h1>{titulo}</h1>
      <p>{texto}</p>
    </section>
  </PaginaPublica>
);

export const PaginaInicio: FC<{ marco: Marco }> = ({ marco }) => (
  <PaginaPublica marco={marco} titulo={t(marco.idioma, "titulo")}>
    <section class="escena escena-mensaje">
      <p class="antetitulo">{t(marco.idioma, "cabecera")}</p>
      <h1>{t(marco.idioma, "titulo")}</h1>
      <p>{marco.idioma === "es" ? "Las tiradas se envían por correo electrónico tras cada compra que cumpla las condiciones." : "Spins are sent by email after every qualifying purchase."}</p>
      <p>
        <a href={`/probabilidades?lang=${marco.idioma}`}>{t(marco.idioma, "todas_prob")}</a>
      </p>
    </section>
  </PaginaPublica>
);

export interface InfoRuletaPublica {
  ruleta: Ruleta;
  segmentos: Segmento[];
}

export const PaginaProbabilidades: FC<{ marco: Marco; ruletas: InfoRuletaPublica[] }> = ({ marco, ruletas }) => {
  const { idioma } = marco;
  const colores = ruletas.flatMap((r) => r.segmentos.map((s) => s.rareza));
  return (
    <PaginaPublica marco={marco} titulo={t(idioma, "todas_prob")} estilo={reglasColores(colores) || undefined}>
      <section class="escena escena-texto">
        <h1>{t(idioma, "todas_prob")}</h1>
        <p>{t(idioma, "probabilidades_nota")}</p>
        {ruletas.map(({ ruleta, segmentos }) => (
          <div class="bloque-ruleta">
            <h2>
              {nombreSegun(idioma, ruleta)} <small>· {idioma === "es" ? "pedidos desde" : "orders from"} {formatearEur(ruleta.umbral_cents, idioma)}</small>
            </h2>
            {segmentos.length ? <TablaProbabilidades segmentos={segmentos} idioma={idioma} nota={false} /> : <p>{t(idioma, "no_disp")}</p>}
          </div>
        ))}
      </section>
    </PaginaPublica>
  );
};

export const PaginaLegal: FC<{ marco: Marco; tipo: "terminos" | "privacidad"; ruletas: Ruleta[]; bloqueados: string[]; diasIp: number }> = ({
  marco,
  tipo,
  ruletas,
  bloqueados,
  diasIp,
}) => {
  const { idioma, env } = marco;
  const v = {
    tienda: env.TIENDA_NOMBRE,
    titular: env.RESPONSABLE_NOMBRE || env.TIENDA_NOMBRE,
    pais: env.RESPONSABLE_PAIS ? nombrePais(env.RESPONSABLE_PAIS, idioma) : "",
    contacto: env.CONTACTO_EMAIL ?? "",
  };
  const tramos = ruletas
    .filter((r) => r.activa === 1)
    .map((r) => `${formatearEur(r.umbral_cents, idioma)} → ${nombreSegun(idioma, r)}`);
  const paises = bloqueados.length ? bloqueados.map((c) => nombrePais(c, idioma)).join(", ") : null;
  const contenido =
    tipo === "terminos"
      ? idioma === "es"
        ? terminosEs(v, tramos, paises)
        : terminosEn(v, tramos, paises)
      : idioma === "es"
        ? privacidadEs(v, diasIp)
        : privacidadEn(v, diasIp);
  return (
    <PaginaPublica marco={marco} titulo={t(idioma, tipo)}>
      <section class="escena escena-texto legal">
        <h1>{t(idioma, tipo)}</h1>
        {contenido}
      </section>
    </PaginaPublica>
  );
};

type Vars = { tienda: string; titular: string; pais: string; contacto: string };

const correo = (c: string) => (c ? <a href={`mailto:${c}`}>{c}</a> : <span>—</span>);

const terminosEs = (v: Vars, tramos: string[], paises: string | null) => (
  <>
    <h2>1. Organizador</h2>
    <p>
      La promoción la organiza {v.titular}
      {v.pais ? ` (${v.pais})` : ""}, titular de la tienda {v.tienda}. Contacto: {correo(v.contacto)}.
    </p>
    <h2>2. Quién participa y cómo</h2>
    <p>
      Cada pedido que alcance un importe mínimo da derecho a <strong>una</strong> tirada en la ruleta del tramo más alto alcanzado (solo cuenta ese tramo):
    </p>
    <ul>
      {tramos.map((x) => (
        <li>{x}</li>
      ))}
    </ul>
    <p>
      Los importes en otras monedas se convierten a euros con el tipo de cambio vigente cuando se autoriza la tirada. Revisamos cada pedido antes de autorizarla; los pedidos
      cancelados, devueltos o fraudulentos no dan tirada y podemos anular las tiradas pendientes asociadas.
    </p>
    <h2>3. El enlace de la tirada</h2>
    <p>Recibirás un enlace personal por correo electrónico. Sirve para un único giro y caduca a los 30 días de su envío. No lo compartas: quien lo abra puede usar la tirada.</p>
    <h2>4. Cómo se decide el premio</h2>
    <p>
      El premio lo decide nuestro servidor en el momento del giro con un generador de números aleatorios criptográfico; la animación solo lo muestra. Las probabilidades de cada
      ruleta se publican en la propia página de la tirada y en la página de probabilidades. Si un premio se queda sin existencias, se excluye y las probabilidades del resto se
      recalculan en proporción.
    </p>
    <h2>5. Premios</h2>
    <p>
      Las condiciones particulares de cada premio (por ejemplo, el importe mínimo de compra o la caducidad de un cupón) aparecen junto a él en la tabla de
      probabilidades, antes de girar. <strong>Cupones de descuento:</strong> código de un solo uso para una compra en {v.tienda}, con esas condiciones y las de la tienda. <strong>Premios del videojuego:</strong> se
      entregan dentro del juego en la plataforma que indiques; necesitamos tu gamertag o ID. Si no podemos contactar contigo o los datos no permiten la entrega, te escribiremos
      para resolverlo. Ningún premio se puede cambiar por dinero.
    </p>
    <h2>6. Territorio</h2>
    <p>
      {paises ? `La promoción no está disponible para pedidos de: ${paises}. ` : ""}Tampoco está disponible donde la ley lo prohíba o lo someta a requisitos que no cumplamos.
    </p>
    <h2>7. Cambios y fin de la promoción</h2>
    <p>Podemos modificar o terminar la promoción en cualquier momento. Respetaremos las tiradas ya enviadas mientras su enlace siga vigente.</p>
    <h2>8. Marcas</h2>
    <p>
      Promoción independiente de {v.tienda}, sin relación con Studio Wildcard, Snail Games ni ARK: Survival Ascended, cuyas marcas pertenecen a sus titulares.
    </p>
    <h2>9. Ley aplicable</h2>
    <p>Se aplica la ley del país del organizador, sin perjuicio de los derechos que te reconozca la normativa de consumo de tu país de residencia.</p>
  </>
);

const terminosEn = (v: Vars, tramos: string[], paises: string | null) => (
  <>
    <h2>1. Organiser</h2>
    <p>
      This promotion is run by {v.titular}
      {v.pais ? ` (${v.pais})` : ""}, owner of the {v.tienda} shop. Contact: {correo(v.contacto)}.
    </p>
    <h2>2. Who can take part and how</h2>
    <p>
      Every order that reaches a minimum amount grants <strong>one</strong> spin on the wheel of the highest tier reached (only that tier counts):
    </p>
    <ul>
      {tramos.map((x) => (
        <li>{x}</li>
      ))}
    </ul>
    <p>
      Amounts in other currencies are converted to euros at the exchange rate in force when the spin is authorised. We review every order before authorising its spin; cancelled,
      refunded or fraudulent orders do not qualify and we may cancel their pending spins.
    </p>
    <h2>3. The spin link</h2>
    <p>You will receive a personal link by email. It works for one spin only and expires 30 days after it is sent. Do not share it: whoever opens it can use the spin.</p>
    <h2>4. How the prize is decided</h2>
    <p>
      The prize is decided by our server at the moment of the spin using a cryptographic random number generator; the animation only reveals it. The odds of every wheel are
      published on the spin page and on the odds page. If a prize runs out of stock it is excluded and the remaining odds are recalculated proportionally.
    </p>
    <h2>5. Prizes</h2>
    <p>
      Any specific conditions of a prize (for example a minimum purchase amount or a coupon's expiry) are shown next to it in the odds table, before you spin.{" "}
      <strong>Discount coupons:</strong> single-use code for one purchase at {v.tienda}, subject to those conditions and the shop's own. <strong>In-game prizes:</strong> delivered inside the
      game on the platform you choose; we need your gamertag or ID. If we cannot reach you or the details do not allow delivery, we will email you to sort it out. No prize can be
      exchanged for cash.
    </p>
    <h2>6. Territory</h2>
    <p>
      {paises ? `The promotion is not available for orders from: ${paises}. ` : ""}It is also not available where the law forbids it or imposes requirements we do not meet.
    </p>
    <h2>7. Changes and end of the promotion</h2>
    <p>We may change or end the promotion at any time. Spins already sent will be honoured while their link is valid.</p>
    <h2>8. Trademarks</h2>
    <p>Independent promotion by {v.tienda}, not related to Studio Wildcard, Snail Games or ARK: Survival Ascended, whose trademarks belong to their owners.</p>
    <h2>9. Governing law</h2>
    <p>The law of the organiser's country applies, without prejudice to the rights granted to you by the consumer law of your country of residence.</p>
  </>
);

const privacidadEs = (v: Vars, dias: number) => (
  <>
    <h2>Responsable</h2>
    <p>
      {v.titular}
      {v.pais ? ` (${v.pais})` : ""}, titular de {v.tienda}. Contacto para privacidad: {correo(v.contacto)}.
    </p>
    <h2>Qué datos tratamos</h2>
    <ul>
      <li>Del pedido: correo electrónico, número de pedido, importe, moneda, país y fecha.</li>
      <li>Al girar: dirección IP y país aproximado de conexión (para prevenir fraude) y el premio obtenido.</li>
      <li>Si ganas un premio del juego: gamertag o ID, plataforma y usuario de Discord (para coordinar la entrega).</li>
    </ul>
    <h2>Para qué y con qué base</h2>
    <p>
      Para gestionar la promoción, enviarte el enlace y el resultado y entregarte el premio (ejecución de las bases de la promoción, art. 6.1.b RGPD) y para prevenir el fraude
      (interés legítimo, art. 6.1.f RGPD). No hacemos perfiles ni enviamos publicidad con estos datos.
    </p>
    <h2>Quién más los trata</h2>
    <p>
      Cloudflare, Inc. (alojamiento y base de datos) y Brevo / Sendinblue SAS (envío de correos), como encargados del tratamiento. Cloudflare puede tratar datos fuera del Espacio
      Económico Europeo con las garantías del RGPD (cláusulas contractuales tipo y Marco de Privacidad de Datos UE-EE. UU.).
    </p>
    <h2>Cuánto tiempo</h2>
    <p>
      La IP se recorta (se elimina su parte final) a los {dias} días. El resto, mientras dure la promoción y los plazos legales aplicables, salvo que pidas antes que lo borremos.
    </p>
    <h2>Tus derechos</h2>
    <p>
      Puedes pedir acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a {correo(v.contacto)}. También puedes reclamar ante la autoridad de control
      (en España, la AEPD: www.aepd.es).
    </p>
    <h2>Cookies</h2>
    <p>La página de la tirada no usa cookies ni herramientas de seguimiento. Las tipografías se sirven desde nuestro propio servidor.</p>
  </>
);

const privacidadEn = (v: Vars, dias: number) => (
  <>
    <h2>Controller</h2>
    <p>
      {v.titular}
      {v.pais ? ` (${v.pais})` : ""}, owner of {v.tienda}. Privacy contact: {correo(v.contacto)}.
    </p>
    <h2>What data we process</h2>
    <ul>
      <li>From your order: email address, order number, amount, currency, country and date.</li>
      <li>When you spin: IP address and approximate connection country (fraud prevention) and the prize you won.</li>
      <li>If you win an in-game prize: gamertag or ID, platform and Discord username (to arrange the delivery).</li>
    </ul>
    <h2>Why and on what legal basis</h2>
    <p>
      To run the promotion, send you the link and the result and deliver your prize (performance of the promotion terms, Art. 6(1)(b) GDPR) and to prevent fraud (legitimate
      interest, Art. 6(1)(f) GDPR). We do not profile you or send advertising with this data.
    </p>
    <h2>Who else processes it</h2>
    <p>
      Cloudflare, Inc. (hosting and database) and Brevo / Sendinblue SAS (email delivery), as processors. Cloudflare may process data outside the European Economic Area under GDPR
      safeguards (standard contractual clauses and the EU-US Data Privacy Framework).
    </p>
    <h2>How long</h2>
    <p>Your IP address is truncated (its last part removed) after {dias} days. Everything else is kept while the promotion lasts and for the legal periods that apply, unless you ask us to delete it sooner.</p>
    <h2>Your rights</h2>
    <p>
      You can request access, rectification, erasure, objection, restriction and portability by writing to {correo(v.contacto)}. You may also complain to your data protection
      authority.
    </p>
    <h2>Cookies</h2>
    <p>The spin page uses no cookies or tracking tools. Fonts are served from our own server.</p>
  </>
);
