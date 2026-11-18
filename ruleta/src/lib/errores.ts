/** Error con mensaje pensado para mostrarse tal cual (al cliente o en el panel). */
export class ErrorUsuario extends Error {
  constructor(mensaje: string, public readonly estado: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 503 = 400, public readonly codigo = "error") {
    super(mensaje);
    this.name = "ErrorUsuario";
  }
}

/**
 * ¿Es un fallo de la base de datos D1? Cuando se agota el cupo diario gratuito, D1 rechaza las
 * consultas con errores "D1_ERROR"/"D1_..."; tratamos cualquier error de D1 como "no disponible"
 * para el cliente. Como todas las escrituras críticas van en lotes (transacciones), un fallo no
 * deja nada a medias: ninguna tirada se pierde.
 */
export function esErrorD1(e: unknown): boolean {
  const m = mensaje(e);
  return /D1_|SQLITE|D1 DB|database/i.test(m) || (e instanceof Error && e.name === "D1Error");
}

/** Heurística para distinguir "cupo diario agotado" de un fallo puntual. */
export function esLimiteD1(e: unknown): boolean {
  return esErrorD1(e) && /limit|exceeded|quota|too many|rows (read|written)|daily/i.test(mensaje(e));
}

export function esRestriccion(e: unknown): boolean {
  return /constraint|CHECK|UNIQUE/i.test(mensaje(e));
}

export const mensaje = (e: unknown): string => (e instanceof Error ? `${e.message} ${(e as { cause?: unknown }).cause ?? ""}` : String(e));
