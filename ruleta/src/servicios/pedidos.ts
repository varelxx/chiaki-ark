import { leerCsv, normalizarCabecera } from "../lib/csv";
import { parsearImporte } from "../lib/dinero";
import { ErrorUsuario } from "../lib/errores";
import { idiomaPorPais, normalizarPais } from "../lib/paises";
import { ahora, normalizarFecha } from "../lib/tiempo";
import { evaluarPedido, type ContextoElegibilidad, type Elegibilidad } from "../lib/tramos";
import { idAleatorio } from "../lib/cripto";
import type { Idioma, Pedido, Ruleta } from "../tipos";
import type { Config } from "./config";

export interface EntradaPedido {
  numero?: unknown;
  correo?: unknown;
  importe?: unknown;
  moneda?: unknown;
  pais?: unknown;
  fecha?: unknown;
}

export interface PedidoValido {
  numero: string;
  correo: string;
  importe_x100: number;
  moneda: string;
  pais: string;
  fecha: string;
  idioma: Idioma;
}

const CORREO = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function normalizarCorreo(texto: unknown): string | null {
  const c = String(texto ?? "").trim().toLowerCase();
  return c.length <= 254 && CORREO.test(c) ? c : null;
}

export function validarPedido(e: EntradaPedido): { ok: true; pedido: PedidoValido } | { ok: false; error: string } {
  const numero = String(e.numero ?? "").trim();
  if (!numero || numero.length > 64 || /[\u0000-\u001f]/.test(numero)) return { ok: false, error: "Número de pedido vacío o no válido" };
  const correo = normalizarCorreo(e.correo);
  if (!correo) return { ok: false, error: `Correo no válido: «${String(e.correo ?? "")}»` };
  const importe = parsearImporte(String(e.importe ?? ""));
  if (importe === null) return { ok: false, error: `Importe no válido: «${String(e.importe ?? "")}»` };
  const moneda = String(e.moneda ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(moneda)) return { ok: false, error: `Moneda no válida (usa el código ISO de 3 letras, p. ej. EUR): «${String(e.moneda ?? "")}»` };
  const pais = normalizarPais(String(e.pais ?? ""));
  if (!pais) return { ok: false, error: `País no válido (usa el código ISO de 2 letras, p. ej. ES): «${String(e.pais ?? "")}»` };
  const fecha = normalizarFecha(String(e.fecha ?? ""));
  if (!fecha) return { ok: false, error: `Fecha no válida (AAAA-MM-DD o DD/MM/AAAA): «${String(e.fecha ?? "")}»` };
  return { ok: true, pedido: { numero, correo, importe_x100: importe, moneda, pais, fecha, idioma: idiomaPorPais(pais) } };
}

const ALIAS: Record<keyof Required<EntradaPedido>, string[]> = {
  numero: ["pedido", "numero", "numero_pedido", "n_pedido", "order", "order_id", "order_number", "id_pedido"],
  correo: ["correo", "email", "e_mail", "correo_electronico", "mail"],
  importe: ["importe", "total", "amount", "importe_total", "precio"],
  moneda: ["moneda", "currency", "divisa"],
  pais: ["pais", "country", "pais_codigo", "country_code", "codigo_pais"],
  fecha: ["fecha", "date", "fecha_pedido", "order_date", "created_at"],
};

export const MAX_FILAS_CSV = 2000;

export interface ResultadoCsv {
  filas: PedidoValido[];
  errores: Array<{ linea: number; error: string }>;
}

export function interpretarCsv(texto: string): ResultadoCsv {
  const tabla = leerCsv(texto);
  if (tabla.length === 0) throw new ErrorUsuario("El CSV está vacío.");
  const cabecera = tabla[0].map(normalizarCabecera);
  const indices = {} as Record<keyof EntradaPedido, number>;
  for (const [campo, alias] of Object.entries(ALIAS) as Array<[keyof EntradaPedido, string[]]>) {
    const i = cabecera.findIndex((c) => alias.includes(c));
    if (i < 0) throw new ErrorUsuario(`Falta la columna «${campo}» en la cabecera del CSV (columnas esperadas: pedido, correo, importe, moneda, pais, fecha).`);
    indices[campo] = i;
  }
  if (tabla.length - 1 > MAX_FILAS_CSV) throw new ErrorUsuario(`El CSV tiene ${tabla.length - 1} filas; el máximo por importación es ${MAX_FILAS_CSV}. Divídelo en varios archivos.`);
  const filas: PedidoValido[] = [];
  const errores: ResultadoCsv["errores"] = [];
  for (let n = 1; n < tabla.length; n++) {
    const f = tabla[n];
    const entrada: EntradaPedido = {};
    for (const campo of Object.keys(indices) as Array<keyof EntradaPedido>) entrada[campo] = f[indices[campo]] ?? "";
    const r = validarPedido(entrada);
    if (r.ok) filas.push(r.pedido);
    else errores.push({ linea: n + 1, error: r.error });
  }
  return { filas, errores };
}

const TROZO = 200;

/** Inserta pedidos pendientes. Los números de pedido repetidos (en la BD o en la propia lista) se ignoran. */
export async function crearPedidos(db: D1Database, pedidos: PedidoValido[], origen: "manual" | "csv" | "webhook"): Promise<{ creados: number; duplicados: string[] }> {
  const vistos = new Set<string>();
  const unicos: PedidoValido[] = [];
  const duplicados: string[] = [];
  for (const p of pedidos) {
    if (vistos.has(p.numero)) duplicados.push(p.numero);
    else {
      vistos.add(p.numero);
      unicos.push(p);
    }
  }
  if (unicos.length === 0) return { creados: 0, duplicados };
  const trozos: PedidoValido[][] = [];
  for (let i = 0; i < unicos.length; i += TROZO) trozos.push(unicos.slice(i, i + TROZO));

  const existentes = await db.batch(
    trozos.map((t) => db.prepare("SELECT numero FROM pedidos WHERE numero IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(t.map((p) => p.numero)))),
  );
  const yaEstan = new Set(existentes.flatMap((r) => (r.results as Array<{ numero: string }>).map((x) => x.numero)));
  duplicados.push(...unicos.filter((p) => yaEstan.has(p.numero)).map((p) => p.numero));

  const momento = ahora();
  const resultados = await db.batch(
    trozos.map((t) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO pedidos (numero, correo, importe_x100, moneda, pais, fecha, idioma, estado, origen, creado_en)
           SELECT j.value->>'numero', j.value->>'correo', j.value->>'importe_x100', j.value->>'moneda', j.value->>'pais',
                  j.value->>'fecha', j.value->>'idioma', 'pendiente', ?2, ?3
           FROM json_each(?1) j`,
        )
        .bind(JSON.stringify(t.filter((p) => !yaEstan.has(p.numero))), origen, momento),
    ),
  );
  const creados = resultados.reduce((s, r) => s + (r.meta.changes ?? 0), 0);
  return { creados, duplicados };
}

export async function contextoElegibilidad(db: D1Database, config: Config): Promise<ContextoElegibilidad> {
  const [ruletas, tipos, bloqueados] = await db.batch([
    db.prepare("SELECT * FROM ruletas ORDER BY umbral_cents"),
    db.prepare("SELECT moneda, por_eur FROM tipos_cambio"),
    db.prepare("SELECT codigo FROM paises_bloqueados"),
  ]);
  return {
    ruletas: ruletas.results as unknown as Ruleta[],
    tipos: new Map((tipos.results as Array<{ moneda: string; por_eur: number }>).map((t) => [t.moneda, t.por_eur])),
    bloqueados: new Set((bloqueados.results as Array<{ codigo: string }>).map((b) => b.codigo)),
    campanaInicio: config.campana_inicio,
    campanaFin: config.campana_fin,
  };
}

export const MAX_AUTORIZAR = 200;

export interface ResultadoAutorizacion {
  autorizados: number;
  correos: number;
  rechazados: Array<{ numero: string; motivo: string }>;
  lote: string;
}

/**
 * Autoriza pedidos: congela el importe en € y la ruleta, crea UNA tirada por pedido y encola un
 * correo por destinatario (si un correo tiene varias tiradas, van todas en el mismo mensaje).
 * Todo va en un único lote de D1, así que o se hace entero o no se hace nada.
 */
export async function autorizarPedidos(db: D1Database, ids: number[], config: Config): Promise<ResultadoAutorizacion> {
  const lote = idAleatorio();
  const limpios = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_AUTORIZAR);
  if (limpios.length === 0) return { autorizados: 0, correos: 0, rechazados: [], lote };
  const ctx = await contextoElegibilidad(db, config);
  const { results: pedidos } = await db
    .prepare("SELECT * FROM pedidos WHERE id IN (SELECT value FROM json_each(?1)) AND estado = 'pendiente'")
    .bind(JSON.stringify(limpios))
    .all<Pedido>();

  const rechazados: ResultadoAutorizacion["rechazados"] = [];
  const aprobados: Array<{ id: number; eur: number; tasa: number; ruleta: number }> = [];
  for (const p of pedidos) {
    const e = evaluarPedido(p, ctx);
    if (e.ok) aprobados.push({ id: p.id, eur: e.eurCents, tasa: e.tasa, ruleta: e.ruleta.id });
    else rechazados.push({ numero: p.numero, motivo: e.texto });
  }
  if (aprobados.length === 0) return { autorizados: 0, correos: 0, rechazados, lote };

  const momento = ahora();
  const datos = JSON.stringify(aprobados);
  const [actualizados, , encolados] = await db.batch([
    db
      .prepare(
        `UPDATE pedidos SET estado = 'autorizado', autorizado_en = ?2, lote = ?3,
           importe_eur_cents = (SELECT j.value->>'eur' FROM json_each(?1) j WHERE j.value->>'id' = pedidos.id),
           tipo_cambio = (SELECT j.value->>'tasa' FROM json_each(?1) j WHERE j.value->>'id' = pedidos.id),
           ruleta_id = (SELECT j.value->>'ruleta' FROM json_each(?1) j WHERE j.value->>'id' = pedidos.id)
         WHERE estado = 'pendiente' AND id IN (SELECT j.value->>'id' FROM json_each(?1) j)`,
      )
      .bind(datos, momento, lote),
    db
      .prepare(
        `INSERT INTO tiradas (pedido_id, correo, pais, idioma, ruleta_id, origen, estado, lote, creada_en)
         SELECT p.id, p.correo, p.pais, p.idioma, p.ruleta_id, 'pedido', 'pendiente', ?1, ?2 FROM pedidos p WHERE p.lote = ?1`,
      )
      .bind(lote, momento),
    db
      .prepare(
        `INSERT INTO correos (tipo, destinatario, idioma, tirada_ids, estado, creado_en, lote)
         SELECT 'enlace', t.correo, t.idioma, json_group_array(t.id), 'pendiente', ?2, ?1
         FROM tiradas t WHERE t.lote = ?1 GROUP BY t.correo, t.idioma`,
      )
      .bind(lote, momento),
  ]);
  return { autorizados: actualizados.meta.changes ?? 0, correos: encolados.meta.changes ?? 0, rechazados, lote };
}

export async function cambiarEstadoPedidos(db: D1Database, ids: number[], accion: "descartar" | "restaurar"): Promise<number> {
  const [desde, hacia] = accion === "descartar" ? ["pendiente", "descartado"] : ["descartado", "pendiente"];
  const r = await db
    .prepare(`UPDATE pedidos SET estado = ?2, descartado_en = CASE WHEN ?2 = 'descartado' THEN ?3 ELSE NULL END
              WHERE id IN (SELECT value FROM json_each(?1)) AND estado = ?4`)
    .bind(JSON.stringify(ids), hacia, ahora(), desde)
    .run();
  return r.meta.changes ?? 0;
}

export interface FiltroPedidos {
  estado?: string;
  q?: string;
  pagina?: number;
}

export const POR_PAGINA = 50;

export async function listarPedidos(db: D1Database, f: FiltroPedidos): Promise<{ pedidos: Pedido[]; hayMas: boolean }> {
  const condiciones: string[] = [];
  const params: unknown[] = [];
  if (f.estado && ["pendiente", "autorizado", "descartado"].includes(f.estado)) {
    params.push(f.estado);
    condiciones.push(`estado = ?${params.length}`);
  }
  if (f.q) {
    params.push(f.q.trim().toLowerCase(), f.q.trim());
    condiciones.push(`(correo = ?${params.length - 1} OR numero = ?${params.length})`);
  }
  const pagina = Math.max(1, f.pagina ?? 1);
  params.push(POR_PAGINA + 1, (pagina - 1) * POR_PAGINA);
  const sql = `SELECT * FROM pedidos ${condiciones.length ? "WHERE " + condiciones.join(" AND ") : ""} ORDER BY id DESC LIMIT ?${params.length - 1} OFFSET ?${params.length}`;
  const { results } = await db.prepare(sql).bind(...params).all<Pedido>();
  return { pedidos: results.slice(0, POR_PAGINA), hayMas: results.length > POR_PAGINA };
}

export { evaluarPedido, type Elegibilidad };
