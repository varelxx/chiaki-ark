/**
 * Aleatoriedad criptográfica para elegir premios.
 *
 * - Los números salen de crypto.getRandomValues (CSPRNG del runtime de Workers).
 * - Para obtener un entero uniforme en [0, n) se usa "rejection sampling": se descartan los valores
 *   de 32 bits que caen en el último tramo incompleto, así no hay sesgo por el módulo.
 */
export interface FuenteAzar {
  siguiente32(): number;
}

const DOS_32 = 2 ** 32;

export class AzarCripto implements FuenteAzar {
  private readonly buffer: Uint32Array;
  private pos: number;

  /** `tamano` = cuántos enteros de 32 bits se piden de golpe (máx. 16384 = 64 KiB por llamada). */
  constructor(tamano = 16) {
    this.buffer = new Uint32Array(Math.min(Math.max(1, tamano), 16384));
    this.pos = this.buffer.length;
  }

  siguiente32(): number {
    if (this.pos >= this.buffer.length) {
      crypto.getRandomValues(this.buffer);
      this.pos = 0;
    }
    return this.buffer[this.pos++];
  }
}

export function enteroUniforme(n: number, azar: FuenteAzar): number {
  if (!Number.isInteger(n) || n <= 0 || n > DOS_32) throw new RangeError(`Rango no válido: ${n}`);
  const limite = Math.floor(DOS_32 / n) * n;
  let x: number;
  do {
    x = azar.siguiente32();
  } while (x >= limite);
  return x % n;
}

/**
 * Elige un elemento con probabilidad proporcional a su peso (entero >= 0).
 * Los elementos con peso 0 nunca salen. Si todos pesan 0 devuelve null.
 * Como solo se usa la suma de los pesos de los elementos recibidos, quitar los premios
 * sin stock renormaliza automáticamente las probabilidades del resto.
 */
export function elegirPonderado<T extends { peso: number }>(elementos: readonly T[], azar: FuenteAzar): T | null {
  let total = 0;
  for (const e of elementos) {
    if (!Number.isInteger(e.peso) || e.peso < 0) throw new RangeError(`Peso no válido: ${e.peso}`);
    total += e.peso;
  }
  if (total === 0) return null;
  let r = enteroUniforme(total, azar);
  for (const e of elementos) {
    if (r < e.peso) return e;
    r -= e.peso;
  }
  throw new Error("Inalcanzable: la suma de pesos cambió durante la elección");
}
