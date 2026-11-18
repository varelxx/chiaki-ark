import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { hashToken } from "../src/lib/cripto";
import { ahora, sumarDias } from "../src/lib/tiempo";
import { leerConfig } from "../src/servicios/config";
import { importarCupones } from "../src/servicios/catalogo";
import { procesarCola } from "../src/servicios/correos";
import { autorizarPedidos, crearPedidos, validarPedido } from "../src/servicios/pedidos";
import { anadirTiradasManuales, reenviarTiradas, revocarTiradas } from "../src/servicios/tiradas";
import type { Env, Tirada } from "../src/tipos";
import { crearTiradaConToken, extraerToken, fijarPesos, formulario, idPremio, peticion, simularBrevo } from "./ayudas";

const girar = (token: string, init: RequestInit = {}, entorno?: Env) => peticion(`/api/tirada/${token}/girar`, { method: "POST", ...init }, entorno);
const tirada = (id: number) => env.DB.prepare("SELECT * FROM tiradas WHERE id = ?1").bind(id).first<Tirada>();

describe("enlace único", () => {
  it("token aleatorio de 32 bytes, guardado solo como hash y con caducidad de 30 días", async () => {
    const brevo = simularBrevo();
    const r = validarPedido({ numero: "P-100", correo: "Cliente@Ejemplo.test", importe: "25", moneda: "EUR", pais: "ES", fecha: "2026-11-10" });
    if (!r.ok) throw new Error(r.error);
    await crearPedidos(env.DB, [r.pedido], "manual");
    await autorizarPedidos(env.DB, [1], await leerConfig(env.DB));
    expect(brevo.llamadas).toHaveLength(0); // nada se envía hasta procesar la cola autorizada
    await procesarCola(env);

    expect(brevo.llamadas).toHaveLength(1);
    expect(brevo.llamadas[0].para).toBe("cliente@ejemplo.test");
    const [token] = extraerToken(brevo.llamadas[0].html);
    expect(token).toHaveLength(43); // 32 bytes en base64url
    const t = (await tirada(1))!;
    expect(t.token_hash).toBe(await hashToken(token));
    expect(t.token_hash).not.toContain(token);
    // Ninguna tabla guarda el token en claro.
    const volcado = JSON.stringify((await env.DB.prepare("SELECT * FROM tiradas").all()).results) + JSON.stringify((await env.DB.prepare("SELECT * FROM correos").all()).results);
    expect(volcado).not.toContain(token);
    const dias = (Date.parse(t.expira_en!) - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(29.99);
    expect(dias).toBeLessThan(30.01);
    expect(t.enviada_en).not.toBeNull();
  });

  it("la página muestra la ruleta con las probabilidades publicadas", async () => {
    const { token } = await crearTiradaConToken({ ruletaId: 2 });
    const r = await peticion(`/tirada/${token}`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('id="rotor"');
    expect(html).toContain("Probabilidades");
    expect(html).toContain("Cápsula roja ARK");
    expect(html).not.toContain("Descuento 10 %</td>"); // sin códigos: no aparece
    expect(html).toContain("/legal/terminos");
    expect(html).toContain("/legal/privacidad");
    expect(r.headers.get("content-security-policy")).toContain("script-src 'self'");
  });

  it("solo sirve una vez: el segundo giro devuelve 409 y la página enseña el resultado", async () => {
    simularBrevo();
    const { id, token } = await crearTiradaConToken({ ruletaId: 1 });
    const primero = await girar(token);
    expect(primero.status).toBe(200);
    const cuerpo = (await primero.json()) as { ok: boolean; premioId: number; html: string };
    expect(cuerpo.ok).toBe(true);
    const t = (await tirada(id))!;
    expect(t.estado).toBe("usada");
    expect(t.premio_id).toBe(cuerpo.premioId);

    const segundo = await girar(token);
    expect(segundo.status).toBe(409);
    expect(((await segundo.json()) as { error: string }).error).toBe("ya_usada");
    expect((await tirada(id))!.premio_id).toBe(cuerpo.premioId); // el premio no cambia

    const pagina = await (await peticion(`/tirada/${token}`)).text();
    expect(pagina).not.toContain('id="rotor"');
    expect(pagina).toContain(t.premio_nombre!);
  });

  it("enlace caducado, revocado o inventado no permite girar", async () => {
    const caducada = await crearTiradaConToken({ ruletaId: 1, expira: sumarDias(ahora(), -1) });
    expect((await girar(caducada.token)).status).toBe(410);
    expect((await peticion(`/tirada/${caducada.token}`)).status).toBe(410);

    const revocada = await crearTiradaConToken({ ruletaId: 1 });
    expect(await revocarTiradas(env.DB, [revocada.id])).toBe(1);
    expect((await girar(revocada.token)).status).toBe(410);

    expect((await girar("x".repeat(43))).status).toBe(404);
    expect((await peticion("/tirada/no-es-un-token")).status).toBe(404);
  });

  it("reenviar genera un enlace nuevo y el antiguo deja de valer", async () => {
    const brevo = simularBrevo();
    const { id, token } = await crearTiradaConToken({ ruletaId: 1, correo: "reenvio@ejemplo.test" });
    expect(await reenviarTiradas(env.DB, [id])).toBe(1);
    expect(await reenviarTiradas(env.DB, [id])).toBe(0); // ya hay uno en cola
    await procesarCola(env);
    const [nuevo] = extraerToken(brevo.llamadas[0].html);
    expect(nuevo).not.toBe(token);
    expect((await peticion(`/tirada/${token}`)).status).toBe(404);
    expect((await peticion(`/tirada/${nuevo}`)).status).toBe(200);
  });

  it("tiradas manuales: N tiradas para un correo, todas en un mismo mensaje", async () => {
    const brevo = simularBrevo();
    await anadirTiradasManuales(env.DB, { correo: "vip@ejemplo.test", ruletaId: 3, cantidad: 3, idioma: "en", pais: "" });
    await procesarCola(env);
    expect(brevo.llamadas).toHaveLength(1);
    expect(new Set(extraerToken(brevo.llamadas[0].html)).size).toBe(3);
    expect(brevo.llamadas[0].asunto).toContain("3 spins");
  });
});

describe("doble giro", () => {
  it("dos giros simultáneos con el mismo enlace: solo uno gana (UPDATE condicional)", async () => {
    simularBrevo();
    const premio = await idPremio(2, "Cápsula roja ARK");
    await fijarPesos(2, { "Cápsula roja ARK": 10_000 });
    await env.DB.prepare("UPDATE premios SET stock = 10 WHERE id = ?1").bind(premio).run();
    const { id, token } = await crearTiradaConToken({ ruletaId: 2 });

    const respuestas = await Promise.all(Array.from({ length: 6 }, () => girar(token)));
    const estados = respuestas.map((r) => r.status).sort();
    expect(estados.filter((s) => s === 200)).toHaveLength(1);
    expect(estados.filter((s) => s === 409)).toHaveLength(5);
    // El stock baja una sola vez y solo hay un correo de resultado.
    expect((await env.DB.prepare("SELECT stock FROM premios WHERE id = ?1").bind(premio).first<{ stock: number }>())!.stock).toBe(9);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM correos WHERE tipo = 'resultado'").first<{ n: number }>())!.n).toBe(1);
    expect((await tirada(id))!.estado).toBe("usada");
  });

  it("la última unidad de stock: una tirada la gana y la otra espera sin perderse", async () => {
    simularBrevo();
    const premio = await idPremio(3, "Dino domesticado legendario");
    await fijarPesos(3, { "Dino domesticado legendario": 10_000 });
    await env.DB.prepare("UPDATE premios SET stock = 1 WHERE id = ?1").bind(premio).run();
    const a = await crearTiradaConToken({ ruletaId: 3 });
    const b = await crearTiradaConToken({ ruletaId: 3 });
    const [ra, rb] = await Promise.all([girar(a.token), girar(b.token)]);
    expect([ra.status, rb.status].sort()).toEqual([200, 503]);
    expect((await env.DB.prepare("SELECT stock FROM premios WHERE id = ?1").bind(premio).first<{ stock: number }>())!.stock).toBe(0);
    const estados = [(await tirada(a.id))!.estado, (await tirada(b.id))!.estado].sort();
    expect(estados).toEqual(["pendiente", "usada"]); // la perdedora sigue pendiente
  });
});

describe("cupones", () => {
  it("cada ganador recibe un código distinto de la bolsa y el stock es el número de códigos", async () => {
    const brevo = simularBrevo();
    const premio = await idPremio(1, "Descuento 5 %");
    await fijarPesos(1, { "Descuento 5 %": 10_000 });
    const imp = await importarCupones(env.DB, premio, "CUPON-A\nCUPON-B\nCUPON-A\n<mal>");
    expect(imp).toEqual({ insertados: 2, repetidos: 1, invalidos: 1 });
    expect((await env.DB.prepare("SELECT stock FROM premios WHERE id = ?1").bind(premio).first<{ stock: number }>())!.stock).toBe(2);

    const t1 = await crearTiradaConToken({ ruletaId: 1, correo: "uno@ejemplo.test" });
    const t2 = await crearTiradaConToken({ ruletaId: 1, correo: "dos@ejemplo.test" });
    const t3 = await crearTiradaConToken({ ruletaId: 1, correo: "tres@ejemplo.test" });
    expect((await girar(t1.token)).status).toBe(200);
    expect((await girar(t2.token)).status).toBe(200);
    const codigos = [(await tirada(t1.id))!.cupon_codigo, (await tirada(t2.id))!.cupon_codigo].sort();
    expect(codigos).toEqual(["CUPON-A", "CUPON-B"]);
    // Sin códigos y sin otros premios: no hay premio disponible, la tirada sigue pendiente.
    expect((await girar(t3.token)).status).toBe(503);
    expect((await tirada(t3.id))!.estado).toBe("pendiente");
    // El correo de resultado lleva el código.
    const resultado = brevo.llamadas.find((l) => l.para === "uno@ejemplo.test")!;
    expect(resultado.html).toContain((await tirada(t1.id))!.cupon_codigo!);
  });

  it("si la bolsa se desincroniza, nunca se entrega un cupón sin código", async () => {
    const premio = await idPremio(1, "Descuento 10 %");
    await fijarPesos(1, { "Descuento 10 %": 10_000 });
    await env.DB.prepare("UPDATE premios SET stock = 5 WHERE id = ?1").bind(premio).run(); // stock sin códigos reales
    const t = await crearTiradaConToken({ ruletaId: 1 });
    expect((await girar(t.token)).status).toBe(503);
    expect((await tirada(t.id))!.estado).toBe("pendiente");
    expect((await env.DB.prepare("SELECT stock FROM premios WHERE id = ?1").bind(premio).first<{ stock: number }>())!.stock).toBe(0);
  });
});

describe("premios de ARK", () => {
  it("formulario de gamertag/plataforma y estado pendiente de entrega", async () => {
    await fijarPesos(1, { "Cápsula azul ARK": 10_000 });
    const t = await crearTiradaConToken({ ruletaId: 1 });
    simularBrevo();
    const cuerpo = (await (await girar(t.token)).json()) as { html: string };
    expect(cuerpo.html).toContain('name="gamertag"');
    expect(cuerpo.html).toContain('name="discord"');

    const malo = await peticion(`/tirada/${t.token}/datos-ark`, { method: "POST", body: formulario({ gamertag: "Superviviente", plataforma: "Nintendo" }) });
    expect(malo.headers.get("location")).toContain("error=plataforma");

    const bueno = await peticion(`/tirada/${t.token}/datos-ark`, { method: "POST", body: formulario({ gamertag: "Superviviente_77", plataforma: "Xbox", discord: "surv#1" }) });
    expect(bueno.status).toBe(303);
    const fila = (await tirada(t.id))!;
    expect(fila).toMatchObject({ estado: "usada", ark_gamertag: "Superviviente_77", ark_plataforma: "Xbox", ark_discord: "surv#1" });
    const pagina = await (await peticion(`/tirada/${t.token}?ok=1`)).text();
    expect(pagina).toContain("Pendiente de entrega");
  });

  it("sin JavaScript: el formulario de girar redirige al resultado", async () => {
    simularBrevo();
    const t = await crearTiradaConToken({ ruletaId: 2 });
    const r = await peticion(`/tirada/${t.token}/girar`, { method: "POST" });
    expect(r.status).toBe(303);
    expect((await tirada(t.id))!.estado).toBe("usada");
  });
});

describe("límite diario de D1", () => {
  it("si D1 falla, se muestra 'vuelve mañana' y la tirada no se pierde", async () => {
    const t = await crearTiradaConToken({ ruletaId: 2 });
    // Base de datos que falla en las escrituras como cuando se agota el cupo diario gratuito.
    const caida = new Proxy(env.DB, {
      get(objetivo, prop) {
        if (prop === "batch") return async () => {
          throw new Error("D1_ERROR: Exceeded maximum daily rows written limit");
        };
        const v = Reflect.get(objetivo, prop);
        return typeof v === "function" ? v.bind(objetivo) : v;
      },
    });
    const entornoCaido = { ...env, DB: caida } as Env;
    const r = await girar(t.token, {}, entornoCaido);
    expect(r.status).toBe(503);
    const cuerpo = (await r.json()) as { error: string; mensaje: string };
    expect(cuerpo.error).toBe("no_disponible_hoy");
    expect(cuerpo.mensaje).toMatch(/vuelve mañana|come back tomorrow/);
    expect((await tirada(t.id))!.estado).toBe("pendiente");

    // Al día siguiente (D1 disponible) el mismo enlace funciona.
    simularBrevo();
    expect((await girar(t.token)).status).toBe(200);
  });

  it("la página también muestra el aviso si D1 no responde al cargar", async () => {
    const t = await crearTiradaConToken({ ruletaId: 1 });
    const caida = new Proxy(env.DB, {
      get(_o, prop) {
        if (prop === "prepare") return () => {
          throw new Error("D1_ERROR: Exceeded maximum daily rows read limit");
        };
        return undefined;
      },
    });
    const r = await peticion(`/tirada/${t.token}`, {}, { ...env, DB: caida } as Env);
    expect(r.status).toBe(503);
    expect(await r.text()).toContain("vuelve mañana");
  });
});
