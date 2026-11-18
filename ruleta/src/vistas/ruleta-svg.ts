import { rareza } from "../lib/rarezas";
import { esc } from "./correos";

export interface Segmento {
  id: number;
  etiqueta: string;
  rareza: string;
  prob: number; // 0..1
}

export interface SegmentoAngulos extends Segmento {
  inicio: number; // grados, sentido horario desde arriba
  fin: number;
}

/** Los segmentos ocupan exactamente su probabilidad: lo que se ve es lo que hay. */
export function calcularAngulos(segmentos: Segmento[]): SegmentoAngulos[] {
  let acumulado = 0;
  return segmentos.map((s, i) => {
    const inicio = acumulado;
    acumulado = i === segmentos.length - 1 ? 360 : acumulado + s.prob * 360;
    return { ...s, inicio, fin: acumulado };
  });
}

const R = 228;
const rad = (g: number) => (g * Math.PI) / 180;
const punto = (r: number, g: number) => `${(r * Math.sin(rad(g))).toFixed(2)} ${(-r * Math.cos(rad(g))).toFixed(2)}`;

function partirEtiqueta(texto: string, max: number): string[] {
  const palabras = texto.split(/\s+/);
  const lineas: string[] = [];
  let actual = "";
  for (const p of palabras) {
    if ((actual + " " + p).trim().length > max && actual) {
      lineas.push(actual);
      actual = p;
    } else actual = (actual + " " + p).trim();
  }
  if (actual) lineas.push(actual);
  if (lineas.length > 2) return [lineas[0], lineas.slice(1).join(" ").slice(0, max - 1) + "…"];
  return lineas;
}

export function svgRuleta(segmentos: SegmentoAngulos[], titulo: string): string {
  const defs: string[] = [];
  const piezas: string[] = [];
  const textos: string[] = [];
  segmentos.forEach((s, i) => {
    const c = rareza(s.rareza);
    const id = `g${i}`;
    defs.push(
      `<radialGradient id="${id}" cx="0" cy="0" r="${R}" gradientUnits="userSpaceOnUse"><stop offset="0.15" stop-color="${c.oscuro}"/><stop offset="0.78" stop-color="${c.color}" stop-opacity="0.78"/><stop offset="1" stop-color="${c.color}"/></radialGradient>`,
    );
    const ancho = s.fin - s.inicio;
    const d =
      ancho >= 359.999
        ? `M 0 ${-R} A ${R} ${R} 0 1 1 0 ${R} A ${R} ${R} 0 1 1 0 ${-R} Z`
        : `M 0 0 L ${punto(R, s.inicio)} A ${R} ${R} 0 ${ancho > 180 ? 1 : 0} 1 ${punto(R, s.fin)} Z`;
    piezas.push(`<path d="${d}" fill="url(#${id})" class="segmento" data-id="${s.id}"><title>${esc(s.etiqueta)} · ${(s.prob * 100).toFixed(2)} %</title></path>`);
    // Etiqueta radial, legible desde el centro hacia el borde.
    const medio = s.inicio + ancho / 2;
    const tamano = Math.max(9, Math.min(17, rad(ancho) * 120 * 0.42));
    const lineas = ancho < 16 ? [s.etiqueta.length > 16 ? s.etiqueta.slice(0, 15) + "…" : s.etiqueta] : partirEtiqueta(s.etiqueta, 16);
    const tspans = lineas
      .map((l, j) => `<tspan x="0" dy="${j === 0 ? (-(lineas.length - 1) * tamano * 0.55).toFixed(1) : (tamano * 1.1).toFixed(1)}">${esc(l)}</tspan>`)
      .join("");
    // En la mitad izquierda se gira 180° para que el texto no quede boca abajo.
    const izquierda = medio > 180;
    const transformacion = izquierda
      ? `rotate(${(medio + 90).toFixed(2)}) translate(${(-R * 0.6).toFixed(1)} 0)`
      : `rotate(${(medio - 90).toFixed(2)}) translate(${(R * 0.6).toFixed(1)} 0)`;
    textos.push(
      `<text transform="${transformacion}" font-size="${tamano.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" class="etiqueta">${tspans}</text>`,
    );
  });
  const divisiones = segmentos.length > 1 ? segmentos.map((s) => `<line x1="0" y1="0" x2="${punto(R, s.inicio).replace(" ", '" y2="')}" class="division"/>`).join("") : "";
  const remaches = Array.from({ length: 24 }, (_, i) => `<circle cx="${(244 * Math.sin(rad(i * 15))).toFixed(2)}" cy="${(-244 * Math.cos(rad(i * 15))).toFixed(2)}" r="3.2" class="remache"/>`).join("");
  return `<svg class="ruleta-svg" viewBox="-260 -260 520 520" role="img" aria-label="${esc(titulo)}" xmlns="http://www.w3.org/2000/svg">
<defs>${defs.join("")}<radialGradient id="hub" cx="0" cy="0" r="52" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3a423a"/><stop offset="1" stop-color="#121612"/></radialGradient></defs>
<circle r="256" class="aro-exterior"/><circle r="250" class="aro"/>${remaches}
<g id="rotor" class="rotor">${piezas.join("")}${divisiones}${textos.join("")}<circle r="${R}" class="borde-interior"/></g>
<g class="centro"><circle r="52" fill="url(#hub)" class="hub"/><circle r="40" class="hub-anillo"/>
<path d="M-17 -16 q8 14 2 34 M-3 -21 q9 16 3 40 M11 -17 q8 14 2 33" class="garra"/></g>
<path d="M0 -204 L-16 -259 L0 -249 L16 -259 Z" class="puntero"/>
</svg>`;
}
