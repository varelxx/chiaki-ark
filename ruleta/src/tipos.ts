/** Binding de Workers Rate Limiting. */
export interface Limitador {
  limit(opciones: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  // Límite de peticiones por IP (opcionales: si faltan, no se limita).
  LIMITE_PUBLICO?: Limitador;
  LIMITE_SENSIBLE?: Limitador;

  // Secretos (wrangler secret put ...)
  BREVO_API_KEY?: string;
  ADMIN_PASSWORD_HASH?: string;
  SESSION_SECRET?: string;
  WEBHOOK_SECRET?: string;

  // Variables públicas (wrangler.jsonc > vars)
  URL_BASE?: string;
  TIENDA_NOMBRE: string;
  TIENDA_URL?: string;
  // Datos personales: se configuran en el panel de Cloudflare (no en el repositorio público).
  REMITENTE_EMAIL?: string;
  REMITENTE_NOMBRE?: string;
  CONTACTO_EMAIL?: string;
  RESPONSABLE_NOMBRE?: string;
  RESPONSABLE_PAIS?: string;
  ZONA_HORARIA?: string;
  BREVO_API_URL?: string;
}

export type Idioma = "es" | "en";

export interface Ruleta {
  id: number;
  nombre: string;
  nombre_en: string;
  color: string;
  color2: string | null;
  umbral_cents: number;
  limite_coste_cents: number;
  activa: number;
  /** JSON con el diseño (ver lib/diseno.ts). */
  diseno: string;
}

export interface Premio {
  id: number;
  ruleta_id: number;
  nombre: string;
  nombre_en: string;
  tipo: "cupon" | "ark";
  rareza: string;
  peso: number;
  stock: number | null;
  coste_cents: number;
  activo: number;
  orden: number;
  /** «icono:<nombre>», «img:<id>:<hash>» o null (automática según el tipo). */
  imagen: string | null;
  descripcion: string | null;
  descripcion_en: string | null;
}

export interface Pedido {
  id: number;
  numero: string;
  correo: string;
  importe_x100: number;
  moneda: string;
  pais: string;
  fecha: string;
  idioma: Idioma;
  estado: "pendiente" | "autorizado" | "descartado";
  origen: "manual" | "csv" | "webhook";
  importe_eur_cents: number | null;
  tipo_cambio: number | null;
  ruleta_id: number | null;
  creado_en: string;
  autorizado_en: string | null;
}

export type EstadoTirada = "pendiente" | "usada" | "entregada" | "revocada";

export interface Tirada {
  id: number;
  pedido_id: number | null;
  correo: string;
  pais: string | null;
  idioma: Idioma;
  ruleta_id: number;
  origen: "pedido" | "manual";
  estado: EstadoTirada;
  token_hash: string | null;
  expira_en: string | null;
  enviada_en: string | null;
  creada_en: string;
  usada_en: string | null;
  revocada_en: string | null;
  premio_id: number | null;
  premio_nombre: string | null;
  premio_nombre_en: string | null;
  premio_tipo: "cupon" | "ark" | null;
  premio_rareza: string | null;
  premio_coste_cents: number | null;
  premio_imagen: string | null;
  premio_descripcion: string | null;
  premio_descripcion_en: string | null;
  cupon_codigo: string | null;
  ip: string | null;
  ip_pais: string | null;
  ark_gamertag: string | null;
  ark_plataforma: string | null;
  ark_discord: string | null;
  ark_datos_en: string | null;
  entregada_en: string | null;
  /** Nota del panel para enlaces directos (a quién se le dio). Los enlaces directos tienen correo = "". */
  nota: string | null;
}
