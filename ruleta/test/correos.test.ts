import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { diaUtc, sumarDias, ahora } from "../src/lib/tiempo";
import { guardarConfig, leerConfig } from "../src/servicios/config";
import { estadoCorreos, procesarCola } from "../src/servicios/correos";
import { anadirTiradasManuales } from "../src/servicios/tiradas";
import { crearTiradaConToken, entrarAdmin, fijarPesos, peticion, simularBrevo } from "./ayudas";

const enCola = async () => (await env.DB.prepare("SELECT count(*) AS n FROM correos WHERE estado = 'pendiente'").first<{ n: number }>())!.n;
const manual = (correo: string) => anadirTiradasManuales(env.DB, { correo, ruletaId: 1, cantidad: 1, idioma: "es", pais: "" });

describe("cupo diario de Brevo", () => {
  it("al llegar al límite, los enlaces quedan en cola y salen cuando se renueva el cupo", async () => {
    const brevo = simularBrevo();
    await guardarConfig(env.DB, { correo_limite_diario: "2", correo_reserva_resultados: "0" });
    for (const c of ["a@ejemplo.test", "b@ejemplo.test", "c@ejemplo.test"]) await manual(c);

    const r1 = await procesarCola(env);
    expect(r1.enviados).toBe(2);
    expect(brevo.llamadas).toHaveLength(2);
    expect(await enCola()).toBe(1);
    // Mientras el día no cambie no se envía nada más.
    expect((await procesarCola(env)).motivo).toBe("cupo");
    expect(brevo.llamadas).toHaveLength(2);
    // La tirada en cola sigue viva (pendiente) y sin enlace todavía.
    const sinEnviar = await env.DB.prepare("SELECT estado, token_hash FROM tiradas WHERE correo = 'c@ejemplo.test'").first<{ estado: string; token_hash: string | null }>();
    expect(sinEnviar).toEqual({ estado: "pendiente", token_hash: null });

    // Simulamos el día siguiente moviendo el contador a ayer.
    await env.DB.prepare("UPDATE uso_correos SET dia = ?1").bind(diaUtc(sumarDias(ahora(), -1))).run();
    expect((await procesarCola(env)).enviados).toBe(1);
    expect(brevo.llamadas.map((l) => l.para)).toEqual(["a@ejemplo.test", "b@ejemplo.test", "c@ejemplo.test"]);
    expect(await enCola()).toBe(0);
  });

  it("la reserva garantiza el correo de resultado aunque los enlaces estén parados", async () => {
    const brevo = simularBrevo();
    await guardarConfig(env.DB, { correo_limite_diario: "3", correo_reserva_resultados: "1" });
    await env.DB.prepare("INSERT INTO uso_correos (dia, enviados) VALUES (?1, 2)").bind(diaUtc()).run();
    await fijarPesos(1, { "Pack de recursos ARK": 10_000 });
    const t = await crearTiradaConToken({ ruletaId: 1, correo: "gana@ejemplo.test" });
    await manual("espera@ejemplo.test");
    // El giro encola un resultado; en segundo plano se envía (cabe en la reserva) y el enlace espera.
    expect((await peticion(`/api/tirada/${t.token}/girar`, { method: "POST" })).status).toBe(200);
    await procesarCola(env);
    expect(brevo.llamadas.map((l) => l.para)).toEqual(["gana@ejemplo.test"]);
    expect(brevo.llamadas[0].asunto).toBe("Resultado de tu tirada en Tienda de Pruebas");
    expect(brevo.llamadas[0].html).toContain(">Pack de recursos ARK</p>");
    expect(await enCola()).toBe(1);
  });

  it("si Brevo responde 402 (sin créditos) se pausa la cola y no se pierde nada", async () => {
    const brevo = simularBrevo(() => new Response('{"code":"not_enough_credits","message":"Not enough credits"}', { status: 402 }));
    await manual("x@ejemplo.test");
    await manual("y@ejemplo.test");
    const r = await procesarCola(env);
    expect(r.enviados).toBe(0);
    expect(r.motivo).toBe("cupo");
    expect(brevo.llamadas).toHaveLength(1); // se para al primer rechazo
    expect(await enCola()).toBe(2);
    const config = await leerConfig(env.DB);
    expect(config.correo_pausa_hasta > ahora()).toBe(true);
    expect((await procesarCola(env)).motivo).toBe("pausa");
  });

  it("los errores temporales se reintentan; un destinatario rechazado acaba en 'error'", async () => {
    simularBrevo(() => new Response('{"code":"invalid_parameter","message":"email is not valid"}', { status: 400 }));
    await manual("rechazado@ejemplo.test");
    for (let i = 0; i < 3; i++) await procesarCola(env);
    const fila = await env.DB.prepare("SELECT estado, intentos FROM correos").first<{ estado: string; intentos: number }>();
    expect(fila).toEqual({ estado: "error", intentos: 3 });
  });

  it("el panel cuenta los correos de hoy y avisa al 80 %", async () => {
    await env.DB.prepare("INSERT INTO uso_correos (dia, enviados) VALUES (?1, 240)").bind(diaUtc()).run();
    const estado = await estadoCorreos(env.DB, await leerConfig(env.DB));
    expect(estado).toMatchObject({ enviadosHoy: 240, limite: 300, aviso: true, agotado: false });
    const cookie = await entrarAdmin();
    const html = await (await peticion("/admin", { headers: { cookie } })).text();
    expect(html).toContain("240");
    expect(html).toContain("Has usado el 80 % del cupo diario");
  });

  it("el cron envía la cola", async () => {
    const brevo = simularBrevo();
    await manual("cron@ejemplo.test");
    const ctx = createExecutionContext();
    await worker.scheduled!(createScheduledController({ cron: "*/10 * * * *", scheduledTime: Date.now() }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(brevo.llamadas.map((l) => l.para)).toEqual(["cron@ejemplo.test"]);
    // y hace el mantenimiento diario una sola vez al día
    expect((await leerConfig(env.DB)).mantenimiento_ultimo).toBe(diaUtc());
  });

  it("sin REMITENTE_EMAIL los correos esperan en la cola (no se pierden)", async () => {
    const brevo = simularBrevo();
    await manual("espera-remitente@ejemplo.test");
    const r = await procesarCola({ ...env, REMITENTE_EMAIL: undefined });
    expect(r.motivo).toBe("sin_remitente");
    expect(brevo.llamadas).toHaveLength(0);
    expect(await enCola()).toBe(1);
    expect((await procesarCola(env)).enviados).toBe(1);
  });

  it("detecta una clave SMTP de Brevo y limpia espacios de la clave", async () => {
    const brevo = simularBrevo();
    await manual("smtp@ejemplo.test");
    expect((await procesarCola({ ...env, BREVO_API_KEY: "xsmtpsib-falsa" })).motivo).toBe("clave_smtp");
    expect(brevo.llamadas).toHaveLength(0);
    expect(await enCola()).toBe(1);
    let cabecera = "";
    const espia = (await import("vitest")).vi.spyOn(globalThis, "fetch").mockImplementation(async (_e: RequestInfo | URL, init?: RequestInit) => {
      cabecera = new Headers(init?.headers).get("api-key") ?? "";
      return new Response(JSON.stringify({ messageId: "x" }), { status: 201 });
    });
    expect((await procesarCola({ ...env, BREVO_API_KEY: "  xkeysib-falsa\n" })).enviados).toBe(1);
    expect(cabecera).toBe("xkeysib-falsa");
    espia.mockRestore();
  });

  it("correos en el idioma del cliente", async () => {
    const brevo = simularBrevo();
    await anadirTiradasManuales(env.DB, { correo: "en@ejemplo.test", ruletaId: 2, cantidad: 1, idioma: "en", pais: "" });
    await procesarCola(env);
    expect(brevo.llamadas[0].asunto).toBe("Your Tienda de Pruebas spin is ready");
    expect(brevo.llamadas[0].html).toContain("Spin the wheel");
  });
});
