import type { Diseno } from "../lib/diseno";
import { simboloIcono } from "../lib/iconos";
import { urlImagen, type RefImagen } from "../lib/medios";
import { rareza } from "../lib/rarezas";
import { esc } from "./correos";

export interface Segmento {
  id: number;
  etiqueta: string;
  rareza: string; // color: clave de rareza o #rrggbb
  prob: number; // 0..1
  imagen: RefImagen;
  descripcion: string | null;
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

/*
 * La ruleta son dos SVG superpuestos con el mismo sistema de coordenadas:
 *   - el ROTOR (gajos, iconos, textos), que gira con una transformación CSS (la tarjeta gráfica lo
 *     mueve sin redibujarlo: va fluido incluso en móviles modestos);
 *   - el MARCO (aro, luces, puntero y centro), fijo encima.
 */
export const VISTA = "-275 -275 550 550";
const R = 226; // radio de los gajos
const R_ARO = 241; // radio medio del aro (y de las luces)
const R_CENTRO = 50;

const rad = (g: number) => (g * Math.PI) / 180;
const f = (n: number) => n.toFixed(2);
const punto = (r: number, g: number) => `${f(r * Math.sin(rad(g)))} ${f(-r * Math.cos(rad(g)))}`;
const cuerda = (r: number, anchoGrados: number) => 2 * r * Math.sin(rad(Math.min(anchoGrados, 180)) / 2);

export function partirEtiqueta(texto: string, max: number): string[] {
  const palabras = texto.split(/[ \t\n]+/).filter(Boolean); // sin partir por espacios de no separación
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
  return lineas.map((l) => (l.length > max + 4 ? l.slice(0, max + 3) + "…" : l));
}

/** Imagen (icono o archivo) centrada en el origen, de lado `lado`. */
function figura(img: RefImagen, lado: number, idsIconos: Map<string, string>, clase: string): string {
  const x = f(-lado / 2);
  if (img.tipo === "icono") {
    const id = idsIconos.get(img.nombre)!;
    return `<use href="#${id}" x="${x}" y="${x}" width="${f(lado)}" height="${f(lado)}" color="#fff" class="${clase}"/>`;
  }
  return `<image href="${esc(urlImagen(img))}" x="${x}" y="${x}" width="${f(lado)}" height="${f(lado)}" preserveAspectRatio="xMidYMid meet" class="${clase} foto"/>`;
}

/** Texto radial: se lee desde el centro hacia el borde (en la mitad izquierda, girado para no quedar del revés). */
function textoRadial(etiqueta: string, medio: number, rCentro: number, largo: number, ancho: number): string {
  if (largo < 24 || ancho < 9) return "";
  let lineas = partirEtiqueta(etiqueta, 13);
  const caracteres = Math.max(...lineas.map((l) => l.length), 1);
  let tamano = Math.min(18, ancho / (lineas.length * 1.15), largo / (caracteres * 0.56));
  if (lineas.length === 2 && tamano < 10) {
    // Si en dos líneas no cabe, una sola línea recortada.
    const unica = etiqueta.length > 16 ? etiqueta.slice(0, 15) + "…" : etiqueta;
    const t1 = Math.min(17, ancho / 1.15, largo / (unica.length * 0.56));
    if (t1 > tamano) {
      lineas = [unica];
      tamano = t1;
    }
  }
  if (tamano < 7.5) return "";
  const tspans = lineas
    .map((l, j) => `<tspan x="0" dy="${j === 0 ? f(-(lineas.length - 1) * tamano * 0.55) : f(tamano * 1.1)}">${esc(l)}</tspan>`)
    .join("");
  const izquierda = medio > 180;
  const transformacion = izquierda ? `rotate(${f(medio + 90)}) translate(${f(-rCentro)} 0)` : `rotate(${f(medio - 90)}) translate(${f(rCentro)} 0)`;
  return `<text transform="${transformacion}" font-size="${f(tamano)}" text-anchor="middle" dominant-baseline="central" class="etiqueta">${tspans}</text>`;
}

/** Reparte un texto en dos líneas lo más equilibradas posible. */
function dosLineas(texto: string): string[] {
  const palabras = texto.split(" ");
  if (palabras.length < 2) return [texto];
  let mejor: string[] = [texto];
  let peor = Infinity;
  for (let i = 1; i < palabras.length; i++) {
    const a = palabras.slice(0, i).join(" ");
    const b = palabras.slice(i).join(" ");
    const largo = Math.max(a.length, b.length);
    if (largo < peor) {
      peor = largo;
      mejor = [a, b];
    }
  }
  return mejor;
}

/**
 * Texto horizontal respecto al gajo (perpendicular al radio), para gajos anchos: cabe más grande.
 * Se queda con la opción (una o dos líneas) que permita la letra más grande.
 */
function textoTangencial(etiqueta: string, medio: number, rCentro: number, ancho: number, alto: number, maximo = 23): string {
  let elegida: string[] = [];
  let tamano = 0;
  for (const lineas of [[etiqueta], dosLineas(etiqueta)]) {
    const caracteres = Math.max(...lineas.map((l) => l.length), 1);
    const t = Math.min(maximo, ancho / (caracteres * 0.56), alto / (lineas.length * 1.12));
    if (t > tamano + 0.5) {
      tamano = t;
      elegida = lineas;
    }
  }
  if (tamano < 8) return "";
  const tspans = elegida
    .map((l, j) => `<tspan x="0" y="${f(-rCentro + (j - (elegida.length - 1) / 2) * tamano * 1.08)}">${esc(l)}</tspan>`)
    .join("");
  return `<text transform="rotate(${f(medio)})" font-size="${f(tamano)}" text-anchor="middle" dominant-baseline="central" class="etiqueta">${tspans}</text>`;
}

/** Los «%» y «€» no se separan de su número al partir líneas. */
const unirSimbolos = (t: string) => t.replace(/ (%|€)/g, "\u00a0$1");

export function svgRotor(segmentos: SegmentoAngulos[], d: Pick<Diseno, "etiquetas">, titulo: string): string {
  const idsIconos = new Map<string, string>();
  for (const s of segmentos) if (s.imagen.tipo === "icono" && !idsIconos.has(s.imagen.nombre)) idsIconos.set(s.imagen.nombre, `ic-${s.imagen.nombre}`);
  const defs: string[] = [...[...idsIconos].map(([nombre, id]) => simboloIcono(nombre, id))];
  const gajos: string[] = [];
  const contenido: string[] = [];
  const gemas: string[] = [];
  segmentos.forEach((s, i) => {
    const c = rareza(s.rareza);
    const id = `g${i}`;
    defs.push(
      `<radialGradient id="${id}" cx="0" cy="0" r="${R}" gradientUnits="userSpaceOnUse"><stop offset="0.12" stop-color="${c.oscuro}"/><stop offset="0.62" stop-color="${c.color}" stop-opacity="0.82"/><stop offset="0.93" stop-color="${c.color}"/><stop offset="1" stop-color="${c.oscuro}"/></radialGradient>`,
    );
    const ancho = s.fin - s.inicio;
    const medio = s.inicio + ancho / 2;
    const dPath =
      ancho >= 359.999
        ? `M 0 ${-R} A ${R} ${R} 0 1 1 0 ${R} A ${R} ${R} 0 1 1 0 ${-R} Z`
        : `M 0 0 L ${punto(R, s.inicio)} A ${R} ${R} 0 ${ancho > 180 ? 1 : 0} 1 ${punto(R, s.fin)} Z`;
    const pista = `${s.etiqueta} · ${(s.prob * 100).toFixed(2)} %${s.descripcion ? ` · ${s.descripcion}` : ""}`;
    gajos.push(`<path d="${dPath}" fill="url(#${id})" class="gajo" data-id="${s.id}"><title>${esc(pista)}</title></path>`);

    // Gajos muy estrechos: una gema en el borde para que se vean, sin texto ni icono.
    if (ancho < 7) {
      gemas.push(`<g transform="rotate(${f(medio)}) translate(0 ${-R + 13})"><path d="M0 -7 5 0 0 7 -5 0Z" fill="${c.color}" class="gema"/></g>`);
      return;
    }
    const modo = d.etiquetas;
    const etiqueta = unirSimbolos(s.etiqueta);
    const partes: string[] = [];
    const anchoGajo = ancho >= 34; // gajos anchos: texto horizontal y más grande
    if (modo === "imagen") {
      const rImg = R * 0.6;
      const lado = Math.min(cuerda(rImg, ancho) * 0.68, 100);
      if (lado >= 16) partes.push(`<g transform="rotate(${f(medio)}) translate(0 ${f(-rImg)})">${figura(s.imagen, lado, idsIconos, "icono")}</g>`);
      else contenido.push(textoRadial(etiqueta, medio, R * 0.6, R - 76, cuerda(R * 0.4, ancho)));
    } else if (modo === "texto") {
      if (anchoGajo) {
        const rT = R * 0.62;
        contenido.push(textoTangencial(etiqueta, medio, rT, cuerda(rT - 22, ancho) * 0.84, 70, 26));
      } else contenido.push(textoRadial(etiqueta, medio, (R + 58) / 2 + 6, R - 74, cuerda(R * 0.45, ancho)));
    } else if (anchoGajo) {
      const rImg = R * 0.72;
      const lado = Math.min(cuerda(rImg, ancho) * 0.5, 66);
      partes.push(`<g transform="rotate(${f(medio)}) translate(0 ${f(-rImg)})">${figura(s.imagen, lado, idsIconos, "icono")}</g>`);
      const arriba = rImg - lado / 2 - 8;
      const alto = Math.min(arriba - (R_CENTRO + 16), 58);
      const rT = arriba - alto / 2;
      contenido.push(textoTangencial(etiqueta, medio, rT, cuerda(rT - alto / 2, ancho) * 0.86, alto));
    } else {
      const rImg = R * 0.77;
      const lado = Math.min(cuerda(rImg, ancho) * 0.62, 54);
      const conIcono = lado >= 15;
      if (conIcono) partes.push(`<g transform="rotate(${f(medio)}) translate(0 ${f(-rImg)})">${figura(s.imagen, lado, idsIconos, "icono")}</g>`);
      const fin = conIcono ? rImg - lado / 2 - 7 : R - 16;
      const inicio = R_CENTRO + 10;
      const rTexto = (inicio + fin) / 2;
      contenido.push(textoRadial(etiqueta, medio, rTexto, fin - inicio, cuerda(inicio + 14, ancho)));
    }
    contenido.push(...partes);
  });
  const divisiones =
    segmentos.length > 1 ? segmentos.map((s) => `<line x1="0" y1="0" x2="${punto(R, s.inicio).replace(" ", '" y2="')}" class="division"/>`).join("") : "";
  return `<svg class="rotor-svg" viewBox="${VISTA}" role="img" aria-label="${esc(titulo)}" xmlns="http://www.w3.org/2000/svg">
<defs>${defs.join("")}<radialGradient id="vineta" cx="0" cy="0" r="${R}" gradientUnits="userSpaceOnUse"><stop offset="0.25" stop-color="#000" stop-opacity="0.35"/><stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="0.86" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/></radialGradient></defs>
<circle r="${R + 4}" class="disco"/>
<g class="gajos">${gajos.join("")}</g>
<circle r="${R}" fill="url(#vineta)" class="sombra"/>
${divisiones}${gemas.join("")}<g class="contenido">${contenido.join("")}</g>
</svg>`;
}

/** Aro, luces, puntero y centro: la parte fija. */
export function svgMarco(d: Pick<Diseno, "marco" | "luces">, centro: RefImagen | null): string {
  const n = 24;
  const luces = d.luces
    ? Array.from({ length: n }, (_, i) => `<circle cx="${f(R_ARO * Math.sin(rad(i * (360 / n))))}" cy="${f(-R_ARO * Math.cos(rad(i * (360 / n))))}" r="4.6" class="luz ${i % 2 ? "impar" : "par"}"/>`).join("")
    : Array.from({ length: n }, (_, i) => `<circle cx="${f(R_ARO * Math.sin(rad(i * (360 / n) + 7.5)))}" cy="${f(-R_ARO * Math.cos(rad(i * (360 / n) + 7.5)))}" r="3" class="remache"/>`).join("");
  let interior: string;
  if (centro?.tipo === "img") {
    interior = `<clipPath id="recorte-centro"><circle r="39"/></clipPath><image href="${esc(urlImagen(centro))}" x="-39" y="-39" width="78" height="78" preserveAspectRatio="xMidYMid slice" clip-path="url(#recorte-centro)"/>`;
  } else if (centro?.tipo === "icono") {
    interior = `${simboloIcono(centro.nombre, "ic-centro")}<use href="#ic-centro" x="-27" y="-27" width="54" height="54" class="icono-centro"/>`;
  } else {
    interior = `${simboloIcono("garra", "ic-centro")}<use href="#ic-centro" x="-24" y="-24" width="48" height="48" class="icono-centro"/>`;
  }
  return `<svg class="marco-svg" viewBox="${VISTA}" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<defs>
<linearGradient id="aro-luz" x1="0" y1="-1" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop offset="0" class="aro-a"/><stop offset="0.5" class="aro-b"/><stop offset="1" class="aro-c"/></linearGradient>
<radialGradient id="cubo" cx="-0.3" cy="-0.35" r="1.1"><stop offset="0" class="cubo-a"/><stop offset="1" class="cubo-b"/></radialGradient>
</defs>
<circle r="${R_ARO}" class="aro" stroke="url(#aro-luz)"/>
<circle r="${R + 1}" class="borde-int"/><circle r="${R_ARO + 15}" class="borde-ext"/>
<g class="luces">${luces}</g>
<g class="centro"><circle r="${R_CENTRO + 6}" class="cubo-sombra"/><circle r="${R_CENTRO}" fill="url(#cubo)" class="cubo"/><circle r="${R_CENTRO - 7}" class="cubo-anillo"/>${interior}</g>
<g class="puntero"><path d="M0 -203C-9 -217-21 -237-21 -251a21 21 0 1 1 42 0c0 14-12 34-21 48Z" class="puntero-cuerpo"/><circle cy="-251" r="8" class="puntero-gema"/></g>
</svg>`;
}
