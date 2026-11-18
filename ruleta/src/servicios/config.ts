import { ahora } from "../lib/tiempo";

export interface Config {
  campana_inicio: string;          // AAAA-MM-DD o ""
  campana_fin: string;
  geobloqueo_ip: "0" | "1";        // bloquear también por la IP del visitante (CF-IPCountry)
  webhook_activo: "0" | "1";
  correo_limite_diario: string;    // cupo de Brevo (300 en el plan gratuito)
  correo_reserva_resultados: string; // correos reservados para resultados de giros
  plataformas_ark: string;         // una por línea
  anonimizar_ip_dias: string;
  url_base: string;                // se rellena sola al entrar en el panel si no hay URL_BASE
  mantenimiento_ultimo: string;
  correo_pausa_hasta: string;      // si Brevo rechaza por cupo/clave, se pausa la cola
  correo_pausa_motivo: string;
  admin_hash: string;              // hash de la contraseña cambiada desde el panel (prioridad sobre el secreto)
  sesion_version: string;          // al cambiarla se cierran todas las sesiones del panel
}

export const CONFIG_POR_DEFECTO: Config = {
  campana_inicio: "",
  campana_fin: "",
  geobloqueo_ip: "0",
  webhook_activo: "0",
  correo_limite_diario: "300",
  correo_reserva_resultados: "20",
  plataformas_ark: "Steam (PC)\nXbox\nPlayStation",
  anonimizar_ip_dias: "90",
  url_base: "",
  mantenimiento_ultimo: "",
  correo_pausa_hasta: "",
  correo_pausa_motivo: "",
  admin_hash: "",
  sesion_version: "1",
};

export async function leerConfig(db: D1Database): Promise<Config> {
  const { results } = await db.prepare("SELECT clave, valor FROM config").all<{ clave: string; valor: string }>();
  const config = { ...CONFIG_POR_DEFECTO };
  for (const { clave, valor } of results) {
    if (clave in config) (config as Record<string, string>)[clave] = valor;
  }
  return config;
}

export function sentenciaConfig(db: D1Database, clave: keyof Config, valor: string): D1PreparedStatement {
  return db.prepare("INSERT INTO config (clave, valor) VALUES (?1, ?2) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor").bind(clave, valor);
}

export async function guardarConfig(db: D1Database, cambios: Partial<Config>): Promise<void> {
  const sentencias = Object.entries(cambios).map(([k, v]) => sentenciaConfig(db, k as keyof Config, String(v ?? "")));
  if (sentencias.length) await db.batch(sentencias);
}

export const plataformas = (c: Config): string[] =>
  c.plataformas_ark.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 20);

export const enteroConfig = (valor: string, defecto: number): number => {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : defecto;
};

export const pausaActiva = (c: Config, momento = ahora()): boolean => !!c.correo_pausa_hasta && c.correo_pausa_hasta > momento;
