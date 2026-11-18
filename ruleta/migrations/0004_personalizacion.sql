-- Personalización completa de las ruletas: biblioteca de imágenes, imagen/descripción por premio,
-- colores libres (#rrggbb, además de las claves de rareza de siempre) y diseño por ruleta.
-- Solo añade columnas y una tabla: los datos existentes no cambian.

-- Imágenes subidas desde el panel. Se guardan en base64 dentro de D1 (gratis, sin R2).
-- Se sirven en /img/<id>-<hash> con caché de un año: la URL cambia si cambia el contenido.
CREATE TABLE imagenes (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  datos TEXT NOT NULL,                       -- contenido en base64
  tamano INTEGER NOT NULL CHECK (tamano > 0 AND tamano <= 1000000),
  hash TEXT NOT NULL UNIQUE,                 -- SHA-256 en hexadecimal (evita duplicados)
  creada_en TEXT NOT NULL
);

-- Imagen del premio: 'icono:<nombre>' (iconos incluidos), 'img:<id>:<hash>' (biblioteca) o NULL (automática).
ALTER TABLE premios ADD COLUMN imagen TEXT;
-- Detalles o condiciones que ve el cliente (p. ej. «En compras desde 5 € · caduca a los 30 días»).
ALTER TABLE premios ADD COLUMN descripcion TEXT;
ALTER TABLE premios ADD COLUMN descripcion_en TEXT;

-- Diseño de la ruleta (JSON): estilo del aro, luces, centro, fondo, textos, sonido, confeti...
ALTER TABLE ruletas ADD COLUMN diseno TEXT NOT NULL DEFAULT '{}';

-- Copia en la tirada de lo que vio el cliente al ganar (igual que el nombre y el color).
ALTER TABLE tiradas ADD COLUMN premio_imagen TEXT;
ALTER TABLE tiradas ADD COLUMN premio_descripcion TEXT;
ALTER TABLE tiradas ADD COLUMN premio_descripcion_en TEXT;
