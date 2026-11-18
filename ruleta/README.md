# Ruleta de premios (temática de supervivencia, colores de rareza)

Aplicación web para dar **una tirada en una ruleta de premios** por cada pedido de tu tienda online que supere un importe. Las tiradas se autorizan a mano desde un panel, se envían por correo con un enlace único y el premio lo decide el servidor con un generador aleatorio criptográfico.

Todo funciona con **planes gratuitos**:

| Pieza | Servicio gratuito |
|---|---|
| Web, API y cron | Cloudflare Workers (plan Free) en `https://ruleta-ark.<tu-subdominio>.workers.dev` |
| Base de datos | Cloudflare D1 (SQLite) |
| Correos | Brevo, plan gratuito (300 correos/día) por API |
| CSS, JS y tipografía | Workers Static Assets (no cuentan como peticiones al Worker) |

No usa Vercel ni ningún servicio de pago, ni dominio propio.

> [!WARNING]
> **Antes de lanzar, revisa con un abogado la normativa de CADA país donde vendes sobre premios aleatorios ligados a compras** (sorteos promocionales, «loot boxes», combinaciones aleatorias con fines publicitarios, protección de menores, impuestos sobre premios…). En algunos países este tipo de promociones necesita autorización o está prohibido. Los textos legales que trae la app son **plantillas**. Usa la lista de **países bloqueados** del panel para excluir los países donde no puedas hacer la promoción.
>
> Revisa también las condiciones de uso de *ARK: Survival Ascended* (Studio Wildcard / Snail Games) sobre entregar objetos o criaturas del juego a cambio de compras con dinero real. Dependen de dónde entregues (servidor oficial o no oficial) y pueden prohibirlo. La app no usa logotipos, arte ni marcas del juego, y muestra un aviso de no afiliación.

---

## Índice

1. [Cómo funciona](#1-cómo-funciona)
2. [Despliegue paso a paso](#2-despliegue-paso-a-paso)
3. [Uso diario](#3-uso-diario)
4. [Formato del CSV de pedidos](#4-formato-del-csv-de-pedidos)
5. [Webhook opcional](#5-webhook-opcional-desactivado-por-defecto)
6. [Límites gratuitos y qué pasa al llegar a ellos](#6-límites-gratuitos-y-qué-pasa-al-llegar-a-ellos)
7. [Decisiones tomadas (y por qué)](#7-decisiones-tomadas-y-por-qué)
8. [Seguridad y RGPD](#8-seguridad-y-rgpd)
9. [Desarrollo local y tests](#9-desarrollo-local-y-tests)
10. [Lo que quedó sin decidir](#10-lo-que-quedó-sin-decidir)

---

## 1. Cómo funciona

```
Pedido (manual / CSV / webhook)  ──►  «pendiente de autorizar»
        │  tú pulsas «Autorizar» (uno a uno o en lote)
        ▼
Se congela el importe en € y el tramo  ──►  se crea 1 tirada  ──►  correo con /tirada/{token}
        │  el cliente abre el enlace y pulsa «Girar»
        ▼
El servidor elige el premio (crypto.getRandomValues)  ──►  el navegador anima hasta él
        ▼
Cupón: código único de la bolsa   ·   Objeto de ARK: formulario gamertag + plataforma (+ Discord)
        ▼
Correo con el resultado  ·  Panel: historial, «marcar entregado», exportar CSV
```

- **Tramos** (editables en el panel): ≥ 10 € → Ruleta 1 (cápsula verde), ≥ 20 € → Ruleta 2 (cápsula azul), ≥ 35 € → Ruleta 3 (cápsula amarilla/roja). Solo cuenta el tramo más alto y cada pedido da **una** tirada.
- **Monedas**: los importes se comparan en euros. Los pedidos en otras monedas se convierten con la tabla de tipos de cambio del panel. Hay un botón para traer los tipos oficiales del BCE.
- **Un mismo correo** puede acumular varias tiradas. Si se autorizan a la vez, van en un único correo con un enlace por tirada.

---

## 2. Despliegue paso a paso

Necesitas Node.js 20 o superior, una cuenta gratuita de [Cloudflare](https://dash.cloudflare.com/sign-up) y otra de [Brevo](https://www.brevo.com/).

### 2.1 Instalar

```bash
cd ruleta
npm install
npx wrangler login            # abre el navegador para autorizar tu cuenta de Cloudflare
```

> El archivo `.npmrc` activa `legacy-peer-deps` porque el plugin de tests de Cloudflare declara dependencias que npm 10 no resuelve bien. No afecta a lo que se despliega.

### 2.2 Crear la base de datos D1

```bash
npx wrangler d1 create ruleta-ark
```

Copia el `database_id` que te devuelve y pégalo en `wrangler.jsonc`, en lugar de `00000000-0000-0000-0000-000000000000`. Después crea las tablas y los datos de ejemplo:

```bash
npm run db:migrate:remote     # = wrangler d1 migrations apply DB --remote
```

### 2.3 Rellenar tus datos en `wrangler.jsonc` → `vars`

| Variable | Qué poner |
|---|---|
| `TIENDA_NOMBRE`, `TIENDA_URL` | Nombre y web de tu tienda (salen en la página y los correos) |
| `REMITENTE_EMAIL`, `REMITENTE_NOMBRE` | Remitente **verificado en Brevo** |
| `CONTACTO_EMAIL` | Correo para dudas y peticiones de privacidad (sale en los textos legales) |
| `RESPONSABLE_NOMBRE`, `RESPONSABLE_PAIS` | Titular de la promoción (nombre o razón social) y país (código ISO, p. ej. `ES`) |
| `ZONA_HORARIA` | Para mostrar fechas (por defecto `Europe/Madrid`) |
| `URL_BASE` | Déjala vacía: se aprende sola la primera vez que entras al panel desde workers.dev |

### 2.4 Preparar Brevo

1. En **Senders, domains & dedicated IPs**, añade y verifica el remitente. **Recomendado:** si tu tienda tiene dominio, autentícalo (registros DKIM y DMARC que te da Brevo). Con una dirección de Gmail/Outlook como remitente, los correos llegarán peor o irán a spam.
2. En **SMTP & API → API Keys**, crea una clave API.
3. **Importante:** en **Security → Authorised IPs**, desactiva el bloqueo de IPs desconocidas. Las IPs de salida de Cloudflare Workers cambian, y con el bloqueo activo Brevo rechazaría los envíos. El panel lo avisa con «Brevo rechaza la clave API o la IP».

### 2.5 Subir los secretos

```bash
npm run hash-password         # genera una contraseña fuerte, su hash y un SESSION_SECRET
npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put SESSION_SECRET
npx wrangler secret put BREVO_API_KEY
# opcional, solo si vas a usar el webhook:
npx wrangler secret put WEBHOOK_SECRET
```

Si prefieres usar tu propia contraseña: `npm run hash-password -- --leer` (mínimo 16 caracteres). La lista completa de secretos está en [`.env.example`](.env.example).

### 2.6 Publicar

```bash
npx wrangler deploy
```

Wrangler te dará la URL: `https://ruleta-ark.<tu-subdominio>.workers.dev`. El cron (cada 10 minutos) queda programado automáticamente.

### 2.7 Primera configuración en el panel (`/admin`)

1. Entra con tu contraseña. La URL pública se guarda sola para los enlaces de los correos.
2. **Tipos de cambio** → «Consultar el BCE» y guarda las monedas que uses. Las que no publica el BCE (ARS, CLP, COP…) se añaden a mano.
3. **Premios** → en cada premio de descuento, pega los **códigos de un solo uso que hayas creado en tu tienda**. Sin códigos, el premio queda fuera de la ruleta y el resumen lo avisa.
4. Revisa probabilidades, costes y límites de cada ruleta (deben sumar 100 %). Revisa también **Tramos**, **Países** y **Ajustes** (fechas de campaña, plataformas de ARK, cupo de correo).
5. Prueba completa: **Tiradas → Añadir tiradas a mano** con tu propio correo, abre el enlace y gira.

Opcional y gratuito: protege `/admin/*` con **Cloudflare Access** (Zero Trust, gratis hasta 50 usuarios). Así añades un inicio de sesión con código por correo antes de la contraseña.

---

## 3. Uso diario

- **Pedidos**: alta manual o **Importar CSV**. Los pedidos entran como *pendientes de autorizar* y no se envía nada hasta que pulses **Autorizar marcados** o **Autorizar todos los elegibles** (hasta 200 cada vez). Cada fila te dice si es elegible o por qué no: no llega al mínimo, país bloqueado, falta el tipo de cambio o está fuera de campaña.
- **Tiradas e historial**: fecha, pedido, correo, país, ruleta, premio, estado (pendiente / usada / entregada / revocada / caducada) e IP. Desde aquí puedes **reenviar** el enlace (genera uno nuevo y el anterior deja de valer), **revocar** tiradas pendientes, **marcar como entregados** los premios de ARK, **exportar a CSV** y **añadir N tiradas a mano** a un correo, sin pedido.
- **Correos**: contador de envíos del día frente al límite de 300 (avisa al 80 %), cola, errores, reintentos y botón «Enviar la cola ahora».
- **RGPD**: busca un correo para ver sus datos, exportarlos o borrarlos a petición.

---

## 4. Formato del CSV de pedidos

Cabecera obligatoria (en cualquier orden, también vale en inglés: `order, email, amount, currency, country, date`):

```csv
pedido,correo,importe,moneda,pais,fecha
#1001,ana@ejemplo.com,12.50,EUR,ES,2026-11-10
#1002,bruno@ejemplo.com,24.90,EUR,MX,2026-11-10
#1003,carla@ejemplo.com,45.00,USD,US,2026-11-11
#1004,dmitri@ejemplo.com,8.00,EUR,DE,2026-11-11
#1005,eva@ejemplo.com,"38,00",GBP,GB,12/11/2026
```

(Es el archivo [`ejemplos/pedidos-ejemplo.csv`](ejemplos/pedidos-ejemplo.csv); un test comprueba que se importa sin errores.)

- Separador `,` o `;` (detección automática). Puede llevar BOM de Excel.
- `importe`: `12.50` o `12,50`, **sin separador de miles**.
- `moneda`: código ISO 4217 de 3 letras (EUR, USD, GBP…).
- `pais`: código ISO 3166 de 2 letras (ES, MX, US…). `UK` se acepta como `GB`.
- `fecha`: `AAAA-MM-DD` (también con hora ISO) o `DD/MM/AAAA`.
- Los números de pedido ya existentes se ignoran: reimportar el mismo archivo no da tiradas dobles. Máximo 2000 filas por importación.

---

## 5. Webhook opcional (desactivado por defecto)

`POST /api/webhook/pedidos` responde **404** salvo que actives «Webhook» en **Ajustes** **y** exista el secreto `WEBHOOK_SECRET`. Los pedidos llegan como *pendientes*: el webhook **nunca autoriza** nada.

- Cuerpo JSON: un pedido o una lista de hasta 100.
  `{"pedido":"#1006","correo":"x@ejemplo.com","importe":"22.00","moneda":"EUR","pais":"PT","fecha":"2026-11-15"}`
- Cabecera `X-Firma: sha256=<HMAC-SHA256 en hexadecimal del cuerpo exacto, con WEBHOOK_SECRET>`.

```bash
CUERPO='{"pedido":"#1006","correo":"x@ejemplo.com","importe":"22.00","moneda":"EUR","pais":"PT","fecha":"2026-11-15"}'
FIRMA=$(printf '%s' "$CUERPO" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')
curl -X POST "https://ruleta-ark.<sub>.workers.dev/api/webhook/pedidos" -H "X-Firma: sha256=$FIRMA" -d "$CUERPO"
```

---

## 6. Límites gratuitos y qué pasa al llegar a ellos

Valores del plan gratuito tal como los conocía al escribir esto. **Compruébalos en la documentación de Cloudflare y Brevo**, porque cambian. Desde la sesión de desarrollo no se pudo consultar developers.cloudflare.com.

| Límite | Valor aproximado | Qué hace la app |
|---|---|---|
| Brevo: correos/día | 300 | Cuenta los envíos por día UTC. Al llegar a «límite − reserva» los enlaces esperan en la cola; la reserva (20 por defecto) queda para los correos de resultado de los giros. El cron reintenta cada 10 minutos. Si Brevo responde «sin créditos», la cola se pausa 1 hora y no se pierde nada. El panel avisa al 80 %. |
| D1: filas leídas/escritas por día | ~5 M / ~100 k | Si D1 rechaza una consulta, el cliente ve «Ruleta no disponible hoy, vuelve mañana». Cada giro es una única transacción (lote de D1): o se aplica entero o no se aplica, así que **la tirada sigue pendiente** y el enlace seguirá funcionando. |
| Workers: peticiones/día | ~100 k | Los archivos estáticos no cuentan. Si se superan, Cloudflare muestra su propia página de error (no se puede personalizar en el plan gratuito). |
| Workers: CPU por petición | ~10 ms | La contraseña usa PBKDF2 con 30.000 iteraciones (unos 5 ms medidos en workerd). |
| Workers: subpeticiones por invocación | ~50 | Se envían como máximo 25 correos por ejecución; el resto sigue el cron. |
| Cron triggers por cuenta | ~5 | La app usa 1. |

---

## 7. Decisiones tomadas (y por qué)

**Las que me confirmaste**
- **Tienda sin integración → CSV genérico** (`pedido, correo, importe, moneda, pais, fecha`) y webhook JSON genérico firmado con HMAC.
- **Cupones = bolsa de códigos**: tú creas en la tienda los códigos de un solo uso y los importas por premio. Así el código que recibe el cliente siempre funciona. El stock de un premio de cupón es el número de códigos libres.
- **Segmentos proporcionales a la probabilidad**: lo que se ve en la ruleta coincide con las probabilidades publicadas.
- **Español e inglés**: la página sigue el idioma del navegador (con `?lang=` para cambiarlo) y los correos el país del pedido: los países hispanohablantes reciben español y el resto, inglés. El panel está solo en español.
- **Entrega de ARK**: gamertag/ID + plataforma (lista editable) + Discord opcional.
- **Límite de coste: solo avisar**. El panel avisa si el coste esperado (con los pesos configurados o con el stock real) supera el límite, pero deja guardar. Lo que sí se exige es que las probabilidades activas sumen exactamente 100 %.
- **Extras** (elegí los que recomiendo): botón de tipos del BCE, recorte de IPs a los 90 días, fechas de campaña opcionales y bloqueo por IP del visitante (**desactivado** por defecto: con una VPN se salta y puede bloquear a clientes de viaje).
- **Carpeta `ruleta/`** y `paths-ignore: ruleta/**` en `.github/workflows/build-ark.yml`, para que los cambios de la ruleta no lancen la compilación de chiaki-ng.

**Las que tomé yo**
- **Hono + HTML renderizado en el servidor**, sin framework de cliente. El panel funciona sin JavaScript y la ruleta también: el botón «Girar» es un formulario normal y el JS solo añade la animación. Pesa poco y queda lejos del límite de tamaño del plan gratuito.
- **SVG para la ruleta**: se ve nítida a cualquier tamaño, es accesible (cada segmento tiene título) y se gira con `transform`. Respeta `prefers-reduced-motion`.
- **El enlace «solo sirve una vez» para girar**. Después, el mismo enlace muestra el resultado (y el formulario de ARK si faltan datos), en vez de dar error. Si el cliente cierra la página antes de rellenar sus datos, puede volver a abrirlo.
- **La caducidad de 30 días cuenta desde que el correo se envía de verdad**, no desde la autorización (si se queda en la cola por el cupo de Brevo, no pierde días).
- **El token se genera en el momento del envío** y solo se guarda su hash SHA-256. Ni la cola de correos ni la base de datos tienen nunca el token en claro. Por eso **reenviar** genera un enlace nuevo y anula el anterior.
- **El importe en € y el tramo se congelan al autorizar**: cambiar después los tipos de cambio o los tramos no afecta a las tiradas ya creadas.
- **Si bloqueas un país después de autorizar**, las tiradas pendientes de ese país no se pueden girar, pero no se borran.
- **Giro atómico**: un único lote de D1 con el `UPDATE … WHERE estado = 'pendiente'` (se comprueba que afecte a 1 fila), la resta del stock con `CHECK (stock >= 0)`, la asignación del código de cupón y el correo de resultado. Dos giros a la vez con el mismo enlace: gana uno y el otro recibe un 409. Dos tiradas compitiendo por la última unidad: una la gana y la otra se repite entre los premios que quedan.
- **Elección del premio**: `crypto.getRandomValues` con *rejection sampling* (sin sesgo de módulo). Los pesos se guardan en centésimas de punto porcentual (10000 = 100 %).
- **Contraseña**: PBKDF2-SHA256 con 30.000 iteraciones. Es un compromiso con el límite de CPU del plan gratuito; por eso el script genera por defecto una contraseña aleatoria larga. Además, 5 intentos fallidos por IP (y 50 en total) bloquean 15 minutos.
- **Día de Brevo = día UTC** (hay fuentes que dicen que el cupo se renueva a las 00:00 UTC; compruébalo en tu cuenta). La app también se para si Brevo dice que no quedan créditos, así que un desfase de horario no hace perder correos.
- **Tipografía Rajdhani (licencia OFL) servida desde tu propio Worker**, sin Google Fonts, porque cargar fuentes de Google desde la UE ha dado problemas con el RGPD. La página pública **no usa cookies** ni analítica.
- **Sin dominio propio**, los enlaces son `*.workers.dev`. Algunos filtros de spam desconfían de esos enlaces; ver la sección 10.

---

## 8. Seguridad y RGPD

- Token de tirada de 32 bytes (`crypto.getRandomValues`) en base64url, guardado como SHA-256, de un solo giro y con caducidad de 30 días.
- CSP estricta (`script-src 'self'`, sin scripts ni estilos en línea), `frame-ancestors 'none'`, `Referrer-Policy: same-origin` (el token nunca viaja a otros sitios) y `noindex`.
- Panel: cookie de sesión firmada con HMAC (`__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict`, 12 h), comprobación de `Origin` en todos los POST (CSRF) y límite de intentos de inicio de sesión.
- Exportación CSV protegida contra la inyección de fórmulas en Excel.
- **Datos mínimos**: correo, n.º de pedido, importe, moneda, país y fecha. Al girar, la IP y el país de conexión. En premios de ARK, gamertag, plataforma y Discord opcional.
- **Recorte automático de IPs** a los 90 días (configurable). Los destinatarios de correos ya enviados también se anonimizan pasado ese plazo.
- **Derecho de acceso y supresión**: sección RGPD del panel. Al borrar se conservan, sin datos personales, el n.º de pedido (para que no se pueda reimportar y dar otra tirada), los importes, los premios y los costes.
- Textos de **términos** y **privacidad** en `/legal/terminos` y `/legal/privacidad` (ES/EN), con las probabilidades publicadas en la página de cada tirada y en `/probabilidades`.
- `npm audit`: 0 vulnerabilidades en las dependencias que se despliegan. Las que marca en desarrollo (`picomatch`, a través de vitest) no llegan a producción.

---

## 9. Desarrollo local y tests

```bash
cp .env.example .dev.vars            # y rellénalo (npm run hash-password para el hash)
npm run db:migrate:local
npm run dev                          # http://localhost:8787  ·  panel en /admin
npm test                             # 59 tests en el runtime real de Workers (Miniflare + D1 local)
npm run typecheck
```

En local, el panel usa una cookie sin `Secure` porque `wrangler dev` sirve por HTTP; en producción siempre es HTTPS.

Los tests (`test/`) nunca llaman a Brevo de verdad. Cubren:

| Archivo | Qué comprueba |
|---|---|
| `tramos.test.ts` | Tramos 10/20/35 € (límites exactos), tramo más alto, ruletas inactivas, conversión de moneda, falta de tipo de cambio, fechas de campaña, una tirada por pedido, importe congelado, tramos editables, números de pedido únicos |
| `probabilidades.test.ts` | **1.000.000 de giros por ruleta**: cada frecuencia dentro de 5σ de su peso y chi-cuadrado por debajo del valor crítico (p = 0,001); exclusión y renormalización de premios sin stock; ausencia de sesgo de módulo |
| `giro.test.ts` | Token de 32 bytes guardado solo como hash y con caducidad de 30 días; **un solo uso**; **doble giro** simultáneo (6 peticiones → 1 éxito y 5 × 409, el stock baja una vez); última unidad; enlaces caducados, revocados o inventados; reenvío; cupones únicos; formulario de ARK; versión sin JavaScript; **fallo de D1 → «vuelve mañana» sin perder la tirada** |
| `paises.test.ts` | **País bloqueado**: no se autoriza, no se dan tiradas manuales, no se gira si se bloquea después, bloqueo opcional por IP, publicación en los términos |
| `coste.test.ts` | **Límite de coste**: 0,655 / 1,375 / 3,10 €, aviso con los pesos configurados y con el stock real, el panel guarda y avisa, exige que la suma sea 100 % |
| `correos.test.ts` | Cupo diario (cola y envío al día siguiente), reserva para resultados, pausa si Brevo responde 402, reintentos, aviso al 80 %, cron, idioma |
| `panel.test.ts` | Login, bloqueo por intentos, cookie segura, CSRF, CSV → autorizar → correos, exportación CSV, «entregado», borrado RGPD, webhook desactivado/firmado, lector de CSV |

### Estructura

```
ruleta/
├── migrations/            0001_esquema.sql, 0002_datos_ejemplo.sql
├── public/                css, js, fuentes (OFL), favicon, _headers
├── scripts/hash-password.mjs
├── src/
│   ├── index.tsx          Hono + cabeceras de seguridad + manejo de errores de D1 + cron
│   ├── lib/               azar, probabilidades, tramos, dinero, csv, cripto, i18n, países…
│   ├── servicios/         pedidos, tiradas (giro), correos (Brevo + cola), catálogo, sesión, mantenimiento
│   ├── rutas/             publico.tsx, admin.tsx, webhook.ts
│   └── vistas/            páginas públicas, SVG de la ruleta, panel, correos
├── test/
└── ejemplos/pedidos-ejemplo.csv
```

---

## 10. Lo que quedó sin decidir

Cosas que dependen de ti, de tu abogado o de tu tienda:

1. **Revisión legal país por país** de las promociones con premio aleatorio ligado a compras, y qué países bloquear. La lista empieza vacía.
2. **Edad mínima**: muchos jugadores de ARK pueden ser menores. Decide si exiges 18+ (o consentimiento parental) y añádelo a los términos.
3. **Condiciones de uso de ARK**: si entregar criaturas u objetos por compras está permitido donde los entregas (servidor oficial o no oficial) y en qué **plazo de entrega** te comprometes.
4. **Textos legales definitivos**: los de la app son plantillas. Falta revisar la ley aplicable, los plazos de conservación de los datos de pedido, la base legal y las transferencias internacionales (Cloudflare en EE. UU.).
5. **Qué cuenta como importe**: con o sin envío, con o sin impuestos. La app compara exactamente el importe que introduces.
6. **Devoluciones**: qué hacer si se devuelve un pedido cuya tirada ya se usó (cupón entregado o premio de ARK). La app permite revocar tiradas *pendientes*, no las usadas.
7. **Condiciones de los cupones** (caducidad, compra mínima, si se acumulan con otros descuentos): se configuran en tu tienda al crear los códigos.
8. **Remitente de correo**: dominio propio autenticado en Brevo (recomendado) o dirección gratuita (peor entrega). Valora también si un dominio propio para la ruleta compensa que los enlaces sean `workers.dev`.
9. **Valores de premios, probabilidades, costes y límites**: los actuales son los de ejemplo.
10. **Hora exacta en que Brevo renueva el cupo** (la app asume 00:00 UTC) y **valores actuales de los límites gratuitos** de Cloudflare (sección 6).
11. **Conservar o no la IP**: hoy se guarda para prevenir fraude y se recorta a los 90 días. Puedes acortar el plazo en Ajustes.
