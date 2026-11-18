/**
 * Iconos incluidos (dibujados para esta ruleta, sin marcas de terceros). Rejilla de 64×64, trazo
 * redondeado en «currentColor»: el mismo dibujo sirve en blanco sobre los gajos y en el color del
 * premio en la tarjeta de resultado.
 */

const R = 'fill="currentColor" fill-opacity=".22"'; // relleno suave
const S = 'fill="currentColor" stroke="none"'; // macizo

export const ICONOS: Record<string, { nombre: string; svg: string }> = {
  caja: {
    nombre: "Caja de suministros",
    svg: `<path d="M32 6 56 18v28L32 58 8 46V18Z" ${R}/><path d="M8 18l24 12 24-12M32 30v28M20 12l24 12v28M20 24v28"/>`,
  },
  capsula: {
    nombre: "Cápsula con baliza",
    svg: `<path d="M23 26h18a7 7 0 0 1 7 7v15a10 10 0 0 1-10 10H26a10 10 0 0 1-10-10V33a7 7 0 0 1 7-7Z" ${R}/><path d="M16 40h32M26 26v-6h12v6M32 4v10M21 7l4 9M43 7l-4 9"/><circle cx="32" cy="49" r="3" ${S}/>`,
  },
  cofre: {
    nombre: "Cofre",
    svg: `<path d="M8 28v-6c0-8 6-12 14-12h20c8 0 14 4 14 12v6Z" ${R}/><path d="M8 28h48v26H8Z"/><path d="M19 10v44M45 10v44"/><path d="M28 23h8v12h-8Z" ${S}/>`,
  },
  regalo: {
    nombre: "Regalo",
    svg: `<path d="M10 26h44v10H10Z" ${R}/><path d="M14 36v20h36V36M32 26v30"/><path d="M32 25c-4-11-16-13-14-5 1 4 8 5 14 5Zm0 0c4-11 16-13 14-5-1 4-8 5-14 5Z"/>`,
  },
  cupon: {
    nombre: "Cupón de descuento",
    svg: `<path d="M8 18h48v9a5 5 0 0 0 0 10v9H8v-9a5 5 0 0 0 0-10Z" ${R}/><path d="M21 21v22" stroke-dasharray="3 5"/><circle cx="33" cy="26" r="3"/><circle cx="45" cy="38" r="3"/><path d="M46 24 32 40"/>`,
  },
  moneda: {
    nombre: "Moneda",
    svg: `<circle cx="32" cy="32" r="24" ${R}/><circle cx="32" cy="32" r="16"/><path d="m32 22 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" ${S}/>`,
  },
  saco: {
    nombre: "Saco de botín",
    svg: `<path d="M24 17C12 27 8 37 8 45c0 10 8 13 24 13s24-3 24-13c0-8-4-18-16-28Z" ${R}/><path d="M24 17h16M24 17l-5-9c7 3 19 3 26 0l-5 9"/><path d="m32 30 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" ${S}/>`,
  },
  gema: {
    nombre: "Gema",
    svg: `<path d="M18 10h28l12 14-26 32L6 24Z" ${R}/><path d="M6 24h52M18 10l8 14 6 32 6-32 8-14M26 24l6-14 6 14"/>`,
  },
  cristal: {
    nombre: "Cristales",
    svg: `<path d="m32 4 8 12-2 36-6 6-6-6-2-36Z" ${R}/><path d="m14 22 7 8 1 22-5 4-6-5-2-21Z" ${R}/><path d="m50 22 5 8-2 21-6 5-5-4 1-22Z" ${R}/><path d="M32 10v42"/>`,
  },
  huevo: {
    nombre: "Huevo de dino",
    svg: `<path d="M32 5C20 5 11 24 11 37c0 13 9 22 21 22s21-9 21-22C53 24 44 5 32 5Z" ${R}/><circle cx="25" cy="27" r="3.5" ${S}/><circle cx="39" cy="20" r="2.5" ${S}/><circle cx="39" cy="41" r="4" ${S}/><circle cx="24" cy="46" r="2.5" ${S}/><circle cx="31" cy="34" r="1.8" ${S}/>`,
  },
  dino: {
    nombre: "Cabeza de dino",
    svg: `<path d="M8 31C8 18 18 10 30 10c10 0 16 4 22 8 4 2 6 6 6 10 0 3-2 4-5 4H40l4 6c4 2 5 6 1 8H34c-4 0-8 4-10 10H14c0-8-6-15-6-25Z" ${R}/><path d="m40 32 2 3 2-3 2 3 2-3"/><circle cx="27" cy="20" r="3" ${S}/><circle cx="52" cy="22" r="1.6" ${S}/>`,
  },
  huella: {
    nombre: "Huella de dino",
    svg: `<path d="M32 7c4 0 5 9 4 19-1 5-7 5-8 0-1-10 0-19 4-19ZM13 15c4-2 8 5 11 14 1 5-4 7-6 3-4-7-8-15-5-17ZM51 15c-4-2-8 5-11 14-1 5 4 7 6 3 4-7 8-15 5-17ZM20 43c0-9 24-9 24 0 0 10-6 15-12 15s-12-5-12-15Z" ${R}/>`,
  },
  hueso: {
    nombre: "Hueso",
    svg: `<path transform="rotate(-40 32 32)" d="M19.7 28h24.6a7 7 0 1 1 10.3 4 7 7 0 1 1-10.3 4H19.7a7 7 0 1 1-10.3-4 7 7 0 1 1 10.3-4Z" ${R}/>`,
  },
  colmillo: {
    nombre: "Colmillo",
    svg: `<path d="M16 8h32c0 18-6 34-16 50C22 42 16 26 16 8Z" ${R}/><path d="M16 16h32M24 26c2 8 5 16 8 22"/>`,
  },
  carne: {
    nombre: "Carne",
    svg: `<path d="M21 39C11 28 15 9 31 6c16-3 29 9 27 23-2 13-15 20-27 17Z" ${R}/><path d="M30 15c8-2 16 3 17 11M26 42 16 52"/><circle cx="11" cy="51" r="4.5"/><circle cx="17" cy="57" r="4.5"/>`,
  },
  garra: {
    nombre: "Zarpazo",
    svg: `<path d="M10 48Q29.9 30.5 40 6 20.1 23.5 10 48ZM19 55Q38.9 37.5 49 13 29.1 30.5 19 55ZM28 62Q47.9 44.5 58 20 38.1 37.5 28 62Z" fill="currentColor" stroke-width="2"/>`,
  },
  calavera: {
    nombre: "Calavera",
    svg: `<path d="M32 6C18 6 10 16 10 28c0 8 4 12 8 14v8h28v-8c4-2 8-6 8-14C54 16 46 6 32 6Z" ${R}/><circle cx="23" cy="29" r="5.5" ${S}/><circle cx="41" cy="29" r="5.5" ${S}/><path d="m32 35-3 5h6Z" ${S}/><path d="M18 50v3c0 3 2 5 5 5h18c3 0 5-2 5-5v-3M26 50v7M32 50v8M38 50v7"/>`,
  },
  espada: {
    nombre: "Espada",
    svg: `<g transform="rotate(45 32 32)"><path d="m32 3 5 6v31H27V9Z" ${R}/><path d="M17 40h30M32 40v14" stroke-width="4.5"/><circle cx="32" cy="57" r="3.5"/></g>`,
  },
  pico: {
    nombre: "Pico",
    svg: `<g transform="rotate(-28 32 34)"><path d="M7 23c10-14 40-14 50 0-10-7-40-7-50 0Z" ${R}/><path d="M28 13h8v8h-8Z" ${S}/><path d="M32 21v39" stroke-width="4.5"/></g>`,
  },
  escudo: {
    nombre: "Escudo",
    svg: `<path d="m32 4 22 8v18c0 14-10 24-22 30C20 54 10 44 10 30V12Z" ${R}/><path d="M32 12v40M22 26h20"/>`,
  },
  pocion: {
    nombre: "Poción",
    svg: `<path d="M18 40h28l4 6c3 6-1 12-8 12H22c-7 0-11-6-8-12Z" ${R}/><path d="M27 6h10M29 6v15L14 46c-3 6 1 12 8 12h20c7 0 11-6 8-12L35 21V6"/><circle cx="28" cy="48" r="2" ${S}/><circle cx="36" cy="51" r="1.5" ${S}/>`,
  },
  llave: {
    nombre: "Llave",
    svg: `<circle cx="20" cy="22" r="12" ${R}/><circle cx="20" cy="22" r="4"/><path d="m29 30 25 25M44 45l-5 5M50 51l-5 5"/>`,
  },
  corona: {
    nombre: "Corona",
    svg: `<path d="m8 22 12 12 12-20 12 20 12-12-4 28H12Z" ${R}/><path d="M12 50h40v6H12Z"/><circle cx="8" cy="20" r="3" ${S}/><circle cx="32" cy="12" r="3" ${S}/><circle cx="56" cy="20" r="3" ${S}/>`,
  },
  trofeo: {
    nombre: "Trofeo",
    svg: `<path d="M18 8h28v14c0 10-6 16-14 16s-14-6-14-16Z" ${R}/><path d="M18 12h-8c0 10 4 14 9 15M46 12h8c0 10-4 14-9 15M32 38v10M22 56h20v-6c0-1-1-2-2-2H24c-1 0-2 1-2 2Z"/>`,
  },
  estrella: {
    nombre: "Estrella",
    svg: `<path d="m32 7 6.5 17.1 18.2.9-14.2 11.4 4.8 17.6L32 44l-15.3 10 4.8-17.6L7.3 25l18.2-.9Z" ${R}/>`,
  },
  rayo: {
    nombre: "Rayo",
    svg: `<path d="M36 4 12 36h18l-4 24 26-34H34Z" ${R}/>`,
  },
  fuego: {
    nombre: "Fuego",
    svg: `<path d="M32 4c4 12 16 18 16 34 0 12-8 20-16 20s-16-8-16-20c0-10 6-16 8-24 4 6 4 12 6 14 2-8 0-16 2-24Z" ${R}/><path d="M32 58c-6 0-8-6-8-10 0-6 6-10 8-16 2 6 8 10 8 16 0 4-2 10-8 10Z" ${S} fill-opacity=".85"/>`,
  },
  corazon: {
    nombre: "Corazón",
    svg: `<path d="M32 54C14 42 6 32 6 22c0-8 6-14 14-14 6 0 10 4 12 8 2-4 6-8 12-8 8 0 14 6 14 14 0 10-8 20-26 32Z" ${R}/>`,
  },
};

export const NOMBRES_ICONOS = Object.keys(ICONOS);

const ATRIBUTOS = 'fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"';

/** SVG independiente (para <img>), con el trazo en el color indicado. */
export function svgIcono(nombre: string, color = "#ffffff"): string | null {
  const i = ICONOS[nombre];
  if (!i) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" color="${color}"><g ${ATRIBUTOS}>${i.svg}</g></svg>`;
}

/** <symbol> para reutilizar el icono dentro de otro SVG con <use href="#id">. */
export function simboloIcono(nombre: string, id: string): string {
  const i = ICONOS[nombre] ?? ICONOS.caja;
  return `<symbol id="${id}" viewBox="0 0 64 64"><g ${ATRIBUTOS}>${i.svg}</g></symbol>`;
}

/** Versión de los iconos para la caché del navegador (cambia si cambia algún dibujo). */
export const VERSION_ICONOS = (() => {
  let h = 0x811c9dc5;
  const s = JSON.stringify(ICONOS);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16);
})();
