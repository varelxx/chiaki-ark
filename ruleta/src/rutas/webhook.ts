import { Hono } from "hono";
import { aHex, hmacSha256, igualdadConstante } from "../lib/cripto";
import { leerConfig } from "../servicios/config";
import { crearPedidos, validarPedido, type EntradaPedido, type PedidoValido } from "../servicios/pedidos";
import type { App } from "./util";

export const webhook = new Hono<App>();

export const MAX_PEDIDOS_WEBHOOK = 100;

/**
 * Webhook OPCIONAL para dar de alta pedidos desde otra herramienta. Desactivado por defecto: responde 404
 * salvo que actives «webhook» en Ajustes Y exista el secreto WEBHOOK_SECRET.
 *
 * POST /api/webhook/pedidos
 *   Cabecera X-Firma: sha256=<HMAC-SHA256 en hex del cuerpo crudo con WEBHOOK_SECRET>
 *   Cuerpo JSON: un pedido {pedido, correo, importe, moneda, pais, fecha} o una lista de ellos.
 * Los pedidos quedan PENDIENTES de autorizar, igual que los manuales. Nunca se autoriza nada solo.
 */
webhook.post("/api/webhook/pedidos", async (c) => {
  const config = await leerConfig(c.env.DB);
  if (config.webhook_activo !== "1" || !c.env.WEBHOOK_SECRET) return c.notFound();
  const crudo = await c.req.text();
  if (crudo.length > 256_000) return c.json({ error: "cuerpo_demasiado_grande" }, 413);
  const firma = (c.req.header("x-firma") ?? "").replace(/^sha256=/i, "").trim().toLowerCase();
  const esperada = aHex(await hmacSha256(c.env.WEBHOOK_SECRET, crudo));
  const enc = new TextEncoder();
  if (!/^[0-9a-f]{64}$/.test(firma) || !igualdadConstante(enc.encode(firma), enc.encode(esperada))) {
    return c.json({ error: "firma_no_valida" }, 401);
  }
  let datos: unknown;
  try {
    datos = JSON.parse(crudo);
  } catch {
    return c.json({ error: "json_no_valido" }, 400);
  }
  const lista = (Array.isArray(datos) ? datos : [datos]) as Array<EntradaPedido & { pedido?: unknown }>;
  if (lista.length > MAX_PEDIDOS_WEBHOOK) return c.json({ error: "demasiados_pedidos", maximo: MAX_PEDIDOS_WEBHOOK }, 413);
  const validos: PedidoValido[] = [];
  const errores: Array<{ indice: number; error: string }> = [];
  lista.forEach((p, i) => {
    const r = validarPedido({ ...p, numero: p.numero ?? p.pedido });
    if (r.ok) validos.push(r.pedido);
    else errores.push({ indice: i, error: r.error });
  });
  const { creados, duplicados } = await crearPedidos(c.env.DB, validos, "webhook");
  return c.json({ creados, duplicados, errores }, errores.length && !creados ? 422 : 200);
});
