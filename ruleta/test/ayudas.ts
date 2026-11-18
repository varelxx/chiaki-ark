import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { vi } from "vitest";
import worker from "../src/index";
import { generarToken, hashToken } from "../src/lib/cripto";
import { ahora, sumarDias } from "../src/lib/tiempo";
import type { Env } from "../src/tipos";

export const ORIGEN = "https://ruleta.test";

export async function peticion(ruta: string, init: RequestInit = {}, entorno: Env = env): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch!(new Request(ORIGEN + ruta, { redirect: "manual", ...init }) as Request<unknown, IncomingRequestCfProperties>, entorno, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export const formulario = (datos: Record<string, string | string[]>): URLSearchParams => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(datos)) for (const x of Array.isArray(v) ? v : [v]) p.append(k, x);
  return p;
};

/** Entra en el panel y devuelve la cabecera Cookie para las siguientes peticiones. */
export async function entrarAdmin(): Promise<string> {
  const r = await peticion("/admin/login", { method: "POST", headers: { origin: ORIGEN }, body: formulario({ contrasena: env.TEST_CONTRASENA }) });
  const cookie = r.headers.get("set-cookie");
  if (r.status !== 303 || !cookie) throw new Error(`Login fallido: ${r.status}`);
  return cookie.split(";")[0];
}

/** Mensaje del panel ("Guardado", errores...) que viaja en la cookie de un solo uso ruleta_flash. */
export function flashDe(r: Response): { ok?: string; error?: string } {
  const cookie = r.headers.getSetCookie().find((c) => c.startsWith("ruleta_flash="));
  if (!cookie) return {};
  return JSON.parse(decodeURIComponent(cookie.split(";")[0].slice("ruleta_flash=".length)));
}

export async function postAdmin(ruta: string, cookie: string, datos: Record<string, string | string[]> | FormData): Promise<Response> {
  return peticion(ruta, { method: "POST", headers: { origin: ORIGEN, cookie }, body: datos instanceof FormData ? datos : formulario(datos) });
}

export interface LlamadaBrevo {
  para: string;
  asunto: string;
  html: string;
  texto: string;
}

/** Sustituye fetch hacia Brevo. `responder` permite simular errores (402 cupo, 401 clave...). */
export function simularBrevo(responder: (n: number) => Response = () => new Response(JSON.stringify({ messageId: "<id@brevo>" }), { status: 201 })) {
  const llamadas: LlamadaBrevo[] = [];
  const original = globalThis.fetch;
  const espia = vi.spyOn(globalThis, "fetch").mockImplementation(async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = entrada instanceof Request ? entrada.url : String(entrada);
    if (url.startsWith("https://brevo.invalid/")) {
      const cuerpo = JSON.parse(String(init?.body ?? "{}"));
      llamadas.push({ para: cuerpo.to?.[0]?.email, asunto: cuerpo.subject, html: cuerpo.htmlContent, texto: cuerpo.textContent });
      return responder(llamadas.length);
    }
    return original(entrada as RequestInfo, init);
  });
  return { llamadas, restaurar: () => espia.mockRestore() };
}

/** Crea una tirada pendiente con un token conocido (como si el correo ya se hubiera enviado). */
export async function crearTiradaConToken(o: { ruletaId: number; correo?: string; pais?: string | null; expira?: string; idioma?: "es" | "en" }): Promise<{ id: number; token: string }> {
  const token = generarToken();
  const r = await env.DB.prepare(
    `INSERT INTO tiradas (correo, pais, idioma, ruleta_id, origen, estado, token_hash, expira_en, enviada_en, creada_en)
     VALUES (?1, ?2, ?3, ?4, 'manual', 'pendiente', ?5, ?6, ?7, ?7) RETURNING id`,
  )
    .bind(o.correo ?? `cliente${Math.random().toString(36).slice(2, 8)}@ejemplo.test`, o.pais ?? null, o.idioma ?? "es", o.ruletaId, await hashToken(token), o.expira ?? sumarDias(ahora(), 30), ahora())
    .first<{ id: number }>();
  return { id: r!.id, token };
}

/** Deja una ruleta con pesos concretos (por nombre de premio) para forzar resultados en los tests. */
export async function fijarPesos(ruletaId: number, pesos: Record<string, number>): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("UPDATE premios SET peso = 0 WHERE ruleta_id = ?1").bind(ruletaId),
    ...Object.entries(pesos).map(([nombre, peso]) => env.DB.prepare("UPDATE premios SET peso = ?3 WHERE ruleta_id = ?1 AND nombre = ?2").bind(ruletaId, nombre, peso)),
  ]);
}

export async function idPremio(ruletaId: number, nombre: string): Promise<number> {
  const r = await env.DB.prepare("SELECT id FROM premios WHERE ruleta_id = ?1 AND nombre = ?2").bind(ruletaId, nombre).first<{ id: number }>();
  if (!r) throw new Error(`No existe el premio ${nombre}`);
  return r.id;
}

export const extraerToken = (texto: string): string[] => [...texto.matchAll(/\/tirada\/([A-Za-z0-9_-]{43})/g)].map((m) => m[1]);
