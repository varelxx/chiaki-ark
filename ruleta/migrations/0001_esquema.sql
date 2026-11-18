-- Esquema de la ruleta de premios (Cloudflare D1 / SQLite).
-- Convenciones:
--   * Fechas en ISO 8601 UTC (texto), p. ej. 2026-11-18T10:00:00.000Z. Las fechas de pedido son AAAA-MM-DD.
--   * Importes en céntimos (enteros) para evitar errores de redondeo.
--   * Pesos de premios en "puntos básicos": 10000 = 100 %, 4500 = 45 %, 1 = 0,01 %.

-- Ajustes editables desde el panel (clave/valor).
CREATE TABLE config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

-- Ruletas = tramos. Un pedido recibe la ruleta activa con el umbral más alto que alcance.
CREATE TABLE ruletas (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  nombre_en TEXT NOT NULL,
  color TEXT NOT NULL,                 -- clave de rareza para el tema visual (verde, azul, amarilla...)
  color2 TEXT,                         -- segundo color opcional (p. ej. amarilla/roja)
  umbral_cents INTEGER NOT NULL CHECK (umbral_cents > 0),
  limite_coste_cents INTEGER NOT NULL CHECK (limite_coste_cents >= 0),
  activa INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0, 1))
);

CREATE TABLE premios (
  id INTEGER PRIMARY KEY,
  ruleta_id INTEGER NOT NULL REFERENCES ruletas(id),
  nombre TEXT NOT NULL,
  nombre_en TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('cupon', 'ark')),
  rareza TEXT NOT NULL DEFAULT 'gris',
  peso INTEGER NOT NULL DEFAULT 0 CHECK (peso BETWEEN 0 AND 10000),
  -- NULL = ilimitado. Para cupones es obligatorio: es el número de códigos libres de la bolsa.
  -- El CHECK (stock >= 0) es lo que hace atómico el giro: si dos giros compiten por la última
  -- unidad, el segundo lote falla y se deshace entero (la tirada sigue pendiente).
  stock INTEGER CHECK (stock IS NULL OR stock >= 0),
  coste_cents INTEGER NOT NULL DEFAULT 0 CHECK (coste_cents >= 0),
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  orden INTEGER NOT NULL DEFAULT 0,
  CHECK (tipo <> 'cupon' OR stock IS NOT NULL)
);
CREATE INDEX premios_ruleta ON premios (ruleta_id, orden);

-- Tipos de cambio: unidades de la moneda por 1 EUR (mismo formato que publica el BCE).
CREATE TABLE tipos_cambio (
  moneda TEXT PRIMARY KEY CHECK (length(moneda) = 3),
  por_eur REAL NOT NULL CHECK (por_eur > 0),
  actualizado_en TEXT NOT NULL,
  fuente TEXT NOT NULL DEFAULT 'manual'
);

CREATE TABLE paises_bloqueados (
  codigo TEXT PRIMARY KEY CHECK (length(codigo) = 2),
  creado_en TEXT NOT NULL
);

CREATE TABLE pedidos (
  id INTEGER PRIMARY KEY,
  numero TEXT NOT NULL UNIQUE,
  correo TEXT NOT NULL,
  importe_x100 INTEGER NOT NULL CHECK (importe_x100 >= 0),  -- importe en la moneda original x 100
  moneda TEXT NOT NULL,
  pais TEXT NOT NULL,
  fecha TEXT NOT NULL,
  idioma TEXT NOT NULL DEFAULT 'en',
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'autorizado', 'descartado')),
  origen TEXT NOT NULL CHECK (origen IN ('manual', 'csv', 'webhook')),
  -- Se congelan al autorizar:
  importe_eur_cents INTEGER,
  tipo_cambio REAL,
  ruleta_id INTEGER REFERENCES ruletas(id),
  lote TEXT,
  creado_en TEXT NOT NULL,
  autorizado_en TEXT,
  descartado_en TEXT
);
CREATE INDEX pedidos_estado ON pedidos (estado, id);
CREATE INDEX pedidos_correo ON pedidos (correo);
CREATE INDEX pedidos_lote ON pedidos (lote);

CREATE TABLE tiradas (
  id INTEGER PRIMARY KEY,
  pedido_id INTEGER UNIQUE REFERENCES pedidos(id),   -- NULL en tiradas manuales; UNIQUE = 1 tirada por pedido
  correo TEXT NOT NULL,
  pais TEXT,
  idioma TEXT NOT NULL DEFAULT 'es',
  ruleta_id INTEGER NOT NULL REFERENCES ruletas(id),
  origen TEXT NOT NULL CHECK (origen IN ('pedido', 'manual')),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'usada', 'entregada', 'revocada')),
  lote TEXT,
  token_hash TEXT UNIQUE,      -- SHA-256 del token; el token en claro solo viaja en el correo
  expira_en TEXT,              -- se fija al enviar el enlace (30 días)
  enviada_en TEXT,
  creada_en TEXT NOT NULL,
  usada_en TEXT,
  revocada_en TEXT,
  giro_nonce TEXT,
  premio_id INTEGER REFERENCES premios(id),
  premio_nombre TEXT,
  premio_nombre_en TEXT,
  premio_tipo TEXT,
  premio_rareza TEXT,
  premio_coste_cents INTEGER,
  cupon_codigo TEXT,
  ip TEXT,
  ip_pais TEXT,
  ark_gamertag TEXT,
  ark_plataforma TEXT,
  ark_discord TEXT,
  ark_datos_en TEXT,
  entregada_en TEXT,
  borrado_en TEXT,
  -- Un premio de tipo cupón nunca puede quedar sin código: si la bolsa está vacía, el lote del giro
  -- falla y se deshace (la tirada sigue pendiente).
  CHECK (premio_tipo IS NOT 'cupon' OR cupon_codigo IS NOT NULL)
);
CREATE INDEX tiradas_estado ON tiradas (estado, id);
CREATE INDEX tiradas_correo ON tiradas (correo);
CREATE INDEX tiradas_lote ON tiradas (lote);
CREATE INDEX tiradas_usada ON tiradas (usada_en);

-- Bolsa de códigos de cupón creados en la tienda e importados en el panel.
CREATE TABLE cupones (
  id INTEGER PRIMARY KEY,
  premio_id INTEGER NOT NULL REFERENCES premios(id),
  codigo TEXT NOT NULL UNIQUE,
  tirada_id INTEGER UNIQUE REFERENCES tiradas(id),
  creado_en TEXT NOT NULL,
  asignado_en TEXT
);
CREATE INDEX cupones_libres ON cupones (premio_id, tirada_id);

-- Cola de correos. Los enlaces NO se guardan aquí: el token se genera en el momento del envío.
CREATE TABLE correos (
  id INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('enlace', 'resultado')),
  destinatario TEXT NOT NULL,
  idioma TEXT NOT NULL DEFAULT 'es',
  tirada_ids TEXT NOT NULL,                -- JSON: [1, 2, 3]
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviando', 'enviado', 'error', 'descartado')),
  intentos INTEGER NOT NULL DEFAULT 0,
  ultimo_error TEXT,
  lote TEXT,
  creado_en TEXT NOT NULL,
  reclamado_en TEXT,
  enviado_en TEXT,
  brevo_id TEXT
);
CREATE INDEX correos_estado ON correos (estado, tipo, id);
CREATE INDEX correos_lote ON correos (lote);

-- Contador diario de correos enviados (día UTC, como el cupo de Brevo).
CREATE TABLE uso_correos (
  dia TEXT PRIMARY KEY,
  enviados INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE intentos_login (
  id INTEGER PRIMARY KEY,
  ip TEXT NOT NULL,
  creado_en TEXT NOT NULL
);
CREATE INDEX intentos_login_ip ON intentos_login (ip, creado_en);
CREATE INDEX intentos_login_fecha ON intentos_login (creado_en);
