import type { Context } from "hono";
import type { Env } from "../tipos";

export type App = {
  Bindings: Env;
  Variables: {
    /** Nonce de esta respuesta para el <style> con los colores e imágenes personalizados (CSP). */
    nonce: string;
    /** Si es true, la página se puede mostrar en un iframe del propio panel (vista previa del diseño). */
    enmarcable?: boolean;
  };
};
export type Ctx = Context<App>;

/** Renderiza un elemento JSX como documento HTML completo. */
export async function html(c: Ctx, elemento: unknown, estado = 200): Promise<Response> {
  const cuerpo = await Promise.resolve(String(await (elemento as { toString(): string | Promise<string> }).toString()));
  return c.html("<!doctype html>" + cuerpo, estado as 200);
}

export async function aTexto(elemento: unknown): Promise<string> {
  return String(await (elemento as { toString(): string | Promise<string> }).toString());
}

export const ipCliente = (c: Ctx): string | null => c.req.header("cf-connecting-ip") ?? null;

export const paisCliente = (c: Ctx): string | null =>
  ((c.req.raw as Request & { cf?: { country?: string } }).cf?.country as string | undefined) ?? c.req.header("cf-ipcountry") ?? null;

/** Ejecuta trabajo en segundo plano si hay contexto de ejecución (en producción siempre lo hay). */
export function enSegundoPlano(c: Ctx, promesa: Promise<unknown>): void {
  const p = promesa.catch((e) => console.error("Tarea en segundo plano:", e));
  try {
    c.executionCtx.waitUntil(p);
  } catch {
    /* sin ExecutionContext (algunos tests): la promesa sigue su curso */
  }
}

export const enteros = (valores: unknown): number[] =>
  (Array.isArray(valores) ? valores : valores === undefined ? [] : [valores]).map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
