/** Colores de rareza (estética de cápsulas de suministros). Claves usadas en premios.rareza y ruletas.color. */
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

export const rareza = (clave: string | null | undefined) => RAREZAS[clave ?? ""] ?? RAREZAS.gris;
