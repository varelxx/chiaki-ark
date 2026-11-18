/** Lector CSV (RFC 4180) con detección de separador "," o ";" y soporte de comillas y BOM. */
export function leerCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, "");
  const primeraLinea = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = contarFuera(primeraLinea, ";") > contarFuera(primeraLinea, ",") ? ";" : primeraLinea.includes("\t") && !primeraLinea.includes(",") ? "\t" : ",";
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else comillas = false;
      } else campo += c;
    } else if (c === '"' && campo === "") {
      comillas = true;
    } else if (c === sep) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else campo += c;
  }
  if (campo !== "" || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((c) => c.trim() !== ""));
}

function contarFuera(linea: string, sep: string): number {
  let n = 0;
  let comillas = false;
  for (const c of linea) {
    if (c === '"') comillas = !comillas;
    else if (c === sep && !comillas) n++;
  }
  return n;
}

/**
 * Escapa una celda para exportar. Además de las comillas, neutraliza la "inyección de fórmulas"
 * (celdas que empiezan por = + - @) para que Excel/Sheets no ejecuten nada al abrir el archivo.
 */
export function celdaCsv(valor: unknown): string {
  let s = valor === null || valor === undefined ? "" : String(valor);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function escribirCsv(cabecera: string[], filas: unknown[][]): string {
  return "﻿" + [cabecera, ...filas].map((f) => f.map(celdaCsv).join(",")).join("\r\n") + "\r\n";
}

export const normalizarCabecera = (s: string): string =>
  s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
