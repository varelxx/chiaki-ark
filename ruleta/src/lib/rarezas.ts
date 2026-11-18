/**
 * Colores de premios y ruletas. Se admite cualquier color «#rrggbb» y, por compatibilidad, las claves
 * de rareza de la primera versión (gris, verde, azul...), que siguen sirviendo de paleta rápida.
 */
export const RAREZAS: Record<string, { nombre: string; color: string; oscuro: string }> = {
  gris: { nombre: "Común (gris)", color: "#a7adb0", oscuro: "#3b4144" },
  verde: { nombre: "Verde", color: "#5fd068", oscuro: "#1d4a22" },
  azul: { nombre: "Azul", color: "#4a9dff", oscuro: "#163a66" },
  morada: { nombre: "Morada", color: "#b37bff", oscuro: "#3f2366" },
  amarilla: { nombre: "Amarilla", color: "#f5c542", oscuro: "#5c4610" },
  roja: { nombre: "Roja", color: "#ff5a4f", oscuro: "#5e1714" },
  cian: { nombre: "Cian", color: "#3fe0d0", oscuro: "#0f4d48" },
  legendaria: { nombre: "Legendaria (naranja)", color: "#ff9a2e", oscuro: "#5f3304" },
};

const HEX6 = /^#[0-9a-f]{6}$/;

/** Devuelve la clave de rareza o el color «#rrggbb» en minúsculas; null si no es un color válido. */
export function normalizarColor(valor: unknown): string | null {
  const v = String(valor ?? "").trim().toLowerCase();
  if (RAREZAS[v]) return v;
  const corto = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (corto) return `#${corto[1]}${corto[1]}${corto[2]}${corto[2]}${corto[3]}${corto[3]}`;
  const largo = /^#?([0-9a-f]{6})$/.exec(v);
  return largo ? `#${largo[1]}` : null;
}

const canal = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
const aHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");

/** Mezcla el color con negro (factor 0..1 = cuánto color queda). */
export function oscurecer(hex: string, factor: number): string {
  return aHex(canal(hex, 0) * factor, canal(hex, 1) * factor, canal(hex, 2) * factor);
}

/** Color principal y su versión oscura (para el degradado de los gajos), sea clave o hexadecimal. */
export function rareza(valor: string | null | undefined): { color: string; oscuro: string } {
  const v = normalizarColor(valor);
  if (v && RAREZAS[v]) return RAREZAS[v];
  if (v && HEX6.test(v)) return { color: v, oscuro: oscurecer(v, 0.3) };
  return RAREZAS.gris;
}

/** Hexadecimal para un <input type="color"> (que no admite claves). */
export const hexDe = (valor: string | null | undefined): string => rareza(valor).color;

/** Luminancia relativa aproximada (0 oscuro, 1 claro): para elegir texto negro o blanco encima. */
export function luminancia(hex: string): number {
  const [r, g, b] = [0, 1, 2].map((i) => {
    const c = canal(hex, i) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Clase CSS para un color. Las claves usan las clases fijas de app.css; los colores libres usan
 * «k-rrggbb», cuyas reglas se generan en el <style nonce> de cada página (ver reglasColores).
 */
export function claseColor(valor: string | null | undefined): string {
  const v = normalizarColor(valor);
  if (v && RAREZAS[v]) return `rareza-${v}`;
  if (v) return `k-${v.slice(1)}`;
  return "rareza-gris";
}

/** Reglas CSS de los colores libres usados en una página. Solo admite «#rrggbb» ya validados. */
export function reglasColores(valores: Iterable<string | null | undefined>): string {
  const vistos = new Set<string>();
  for (const valor of valores) {
    const v = normalizarColor(valor);
    if (v && HEX6.test(v)) vistos.add(v);
  }
  return [...vistos].map((v) => `.k-${v.slice(1)}{--r:${v};--ro:${oscurecer(v, 0.3)}}`).join("");
}
