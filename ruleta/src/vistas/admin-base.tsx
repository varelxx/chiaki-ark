import type { FC, PropsWithChildren } from "hono/jsx";

const SECCIONES: Array<[string, string]> = [
  ["/admin", "Resumen"],
  ["/admin/pedidos", "Pedidos"],
  ["/admin/tiradas", "Tiradas e historial"],
  ["/admin/premios", "Premios"],
  ["/admin/tramos", "Tramos"],
  ["/admin/cambios", "Tipos de cambio"],
  ["/admin/paises", "Países"],
  ["/admin/correos", "Correos"],
  ["/admin/rgpd", "RGPD"],
  ["/admin/ajustes", "Ajustes"],
];

export interface Flash {
  ok?: string;
  error?: string;
}

export const LayoutAdmin: FC<PropsWithChildren<{ titulo: string; ruta: string; flash?: Flash; tienda: string }>> = ({ titulo, ruta, flash, tienda, children }) => (
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex, nofollow" />
      <meta name="referrer" content="same-origin" />
      <title>{`${titulo} · Panel · ${tienda}`}</title>
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <link rel="stylesheet" href="/css/admin.css" />
      <script src="/js/admin.js" defer></script>
    </head>
    <body>
      <header class="barra">
        <strong class="logo">{tienda} · Ruleta</strong>
        <nav>
          {SECCIONES.map(([href, texto]) => (
            <a href={href} class={(href === "/admin" ? ruta === href : ruta.startsWith(href)) ? "activo" : ""}>
              {texto}
            </a>
          ))}
        </nav>
        <form method="post" action="/admin/salir" class="salir">
          <button type="submit">Salir</button>
        </form>
      </header>
      <main>
        <h1>{titulo}</h1>
        {flash?.ok ? (
          <p class="flash ok" role="status">
            {flash.ok}
          </p>
        ) : null}
        {flash?.error ? (
          <p class="flash error" role="alert">
            {flash.error}
          </p>
        ) : null}
        {children}
      </main>
    </body>
  </html>
);

export const PaginaLogin: FC<{ error?: string; tienda: string; sinConfigurar?: boolean }> = ({ error, tienda, sinConfigurar }) => (
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex, nofollow" />
      <title>{`Entrar · ${tienda}`}</title>
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <link rel="stylesheet" href="/css/admin.css" />
    </head>
    <body class="login">
      <form method="post" action="/admin/login" class="tarjeta login-form">
        <h1>Panel de la ruleta</h1>
        {sinConfigurar ? (
          <p class="flash error">
            Faltan los secretos ADMIN_PASSWORD_HASH y/o SESSION_SECRET (mínimo 32 caracteres). Configúralos con <code>wrangler secret put</code> (ver README).
          </p>
        ) : null}
        {error ? (
          <p class="flash error" role="alert">
            {error}
          </p>
        ) : null}
        <label>
          Contraseña
          <input type="password" name="contrasena" required autocomplete="current-password" autofocus />
        </label>
        <button type="submit">Entrar</button>
      </form>
    </body>
  </html>
);

export const Paginacion: FC<{ pagina: number; hayMas: boolean; enlace: (p: number) => string }> = ({ pagina, hayMas, enlace }) =>
  pagina > 1 || hayMas ? (
    <nav class="paginacion">
      {pagina > 1 ? <a href={enlace(pagina - 1)}>← Anterior</a> : <span></span>}
      <span>Página {pagina}</span>
      {hayMas ? <a href={enlace(pagina + 1)}>Siguiente →</a> : <span></span>}
    </nav>
  ) : null;

export const Avisos: FC<{ avisos: string[] }> = ({ avisos }) =>
  avisos.length ? (
    <ul class="avisos">
      {avisos.map((a) => (
        <li>{a}</li>
      ))}
    </ul>
  ) : null;
