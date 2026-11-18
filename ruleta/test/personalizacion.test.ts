import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { leerDiseno } from "../src/lib/diseno";
import { detectarTipoImagen, leerRef } from "../src/lib/medios";
import { ajustarA100 } from "../src/lib/probabilidades";
import { claseColor, normalizarColor, reglasColores } from "../src/lib/rarezas";
import { crearTiradaConToken, entrarAdmin, fijarPesos, flashDe, idPremio, peticion, postAdmin, simularBrevo } from "./ayudas";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4]);

function formularioImagenes(archivos: Array<{ nombre: string; bytes: Uint8Array; tipo?: string }>): FormData {
  const f = new FormData();
  for (const a of archivos) f.append("archivos", new File([a.bytes], a.nombre, { type: a.tipo ?? "image/png" }));
  f.append("uso", "premio");
  return f;
}

async function subirPng(cookie: string, nombre = "dino-rex.png", bytes = PNG): Promise<{ id: number; ref: string; url: string }> {
  const r = await postAdmin("/admin/imagenes", cookie, formularioImagenes([{ nombre, bytes }]));
  expect(r.status).toBe(303);
  const fila = await env.DB.prepare("SELECT id, hash FROM imagenes ORDER BY id DESC LIMIT 1").first<{ id: number; hash: string }>();
  return { id: fila!.id, ref: `img:${fila!.id}:${fila!.hash.slice(0, 16)}`, url: `/img/${fila!.id}-${fila!.hash.slice(0, 16)}` };
}

/** Campos actuales del formulario de premios de una ruleta, con cambios. */
async function camposPremios(ruletaId: number, cambios: Record<string, string> = {}): Promise<Record<string, string | string[]>> {
  const { results } = await env.DB.prepare("SELECT * FROM premios WHERE ruleta_id = ?1").bind(ruletaId).all<Record<string, unknown>>();
  const campos: Record<string, string | string[]> = { ids: results.map((p) => String(p.id)) };
  for (const p of results) {
    const id = p.id;
    Object.assign(campos, {
      [`nombre_${id}`]: String(p.nombre),
      [`nombre_en_${id}`]: String(p.nombre_en),
      [`rareza_${id}`]: String(p.rareza),
      [`peso_${id}`]: String(Number(p.peso) / 100).replace(".", ","),
      [`stock_${id}`]: p.stock === null ? "" : String(p.stock),
      [`coste_${id}`]: String(Number(p.coste_cents) / 100).replace(".", ","),
      [`orden_${id}`]: String(p.orden),
      [`imagen_${id}`]: p.imagen ? String(p.imagen) : "",
      [`descripcion_${id}`]: p.descripcion ? String(p.descripcion) : "",
      [`descripcion_en_${id}`]: p.descripcion_en ? String(p.descripcion_en) : "",
    });
    if (p.activo) campos[`activo_${id}`] = "1";
  }
  return { ...campos, ...cambios };
}

describe("colores libres", () => {
  it("admite claves de rareza y cualquier #rrggbb; rechaza lo demás", () => {
    expect(normalizarColor("verde")).toBe("verde");
    expect(normalizarColor("#FF00AA")).toBe("#ff00aa");
    expect(normalizarColor("f0a")).toBe("#ff00aa");
    expect(normalizarColor("red")).toBeNull();
    expect(normalizarColor("#12345g")).toBeNull();
    expect(normalizarColor("#fff;}body{")).toBeNull();
    expect(claseColor("#ff00aa")).toBe("k-ff00aa");
    expect(claseColor("azul")).toBe("rareza-azul");
    expect(reglasColores(["#ff00aa", "azul", "basura", "#ff00aa"])).toBe(".k-ff00aa{--r:#ff00aa;--ro:#4d0033}");
  });

  it("el color de un premio llega a la página con un <style> autorizado por el nonce de la CSP", async () => {
    const cookie = await entrarAdmin();
    const id = await idPremio(1, "Pack de recursos ARK");
    const r = await postAdmin("/admin/premios/guardar?ruleta=1", cookie, await camposPremios(1, { [`rareza_${id}`]: "#ff00aa" }));
    expect(flashDe(r).ok).toMatch(/Guardado/);
    const { token } = await crearTiradaConToken({ ruletaId: 1 });
    const pagina = await peticion(`/tirada/${token}`);
    const html = await pagina.text();
    const nonce = /'nonce-([^']+)'/.exec(pagina.headers.get("content-security-policy") ?? "")?.[1];
    expect(nonce).toBeTruthy();
    expect(html).toContain(`<style nonce="${nonce}">`);
    expect(html).toContain(".k-ff00aa{--r:#ff00aa");
    expect(html).toContain('stop-color="#ff00aa"'); // gajo de ese color
    // Cada respuesta lleva un nonce distinto.
    const otra = await peticion(`/tirada/${token}`);
    expect(otra.headers.get("content-security-policy")).not.toContain(`'nonce-${nonce}'`);
  });
});

describe("biblioteca de imágenes", () => {
  it("detecta el tipo por el contenido, no por el nombre", () => {
    expect(detectarTipoImagen(PNG)).toBe("image/png");
    expect(detectarTipoImagen(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectarTipoImagen(new TextEncoder().encode("GIF89a..."))).toBe("image/gif");
    expect(detectarTipoImagen(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(detectarTipoImagen(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(detectarTipoImagen(new TextEncoder().encode("<html><script>"))).toBeNull();
  });

  it("sube, sirve con caché larga y rechaza SVG, HTML y archivos de más de 1 MB", async () => {
    const cookie = await entrarAdmin();
    const r = await postAdmin(
      "/admin/imagenes",
      cookie,
      formularioImagenes([
        { nombre: "dino-rex.png", bytes: PNG },
        { nombre: "truco.png", bytes: new TextEncoder().encode("<svg onload=alert(1)>"), tipo: "image/png" },
        { nombre: "pagina.html", bytes: new TextEncoder().encode("<html><script>alert(1)</script>"), tipo: "text/html" },
        { nombre: "enorme.png", bytes: new Uint8Array(1_000_001) },
      ]),
    );
    const f = flashDe(r);
    expect(f.ok).toMatch(/1 imágenes subidas/);
    expect(f.error).toMatch(/truco.*no es una imagen/);
    expect(f.error).toMatch(/pagina.*no es una imagen/);
    expect(f.error).toMatch(/enorme.*1 MB/);
    const fila = await env.DB.prepare("SELECT id, nombre, tipo, hash FROM imagenes").first<{ id: number; nombre: string; tipo: string; hash: string }>();
    expect(fila).toMatchObject({ nombre: "dino rex", tipo: "image/png" });

    const img = await peticion(`/img/${fila!.id}-${fila!.hash.slice(0, 16)}`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("cache-control")).toContain("immutable");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG);
    // Con otro hash no se sirve (las URLs no se pueden adivinar ni reutilizar tras cambiar).
    expect((await peticion(`/img/${fila!.id}-0000000000000000`)).status).toBe(404);
    // La misma imagen otra vez no se duplica.
    expect(flashDe(await postAdmin("/admin/imagenes", cookie, formularioImagenes([{ nombre: "otra.png", bytes: PNG }]))).ok).toMatch(/ya estaban/);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM imagenes").first<{ n: number }>())!.n).toBe(1);
  });

  it("la biblioteca solo es para el panel: sin sesión no se puede subir", async () => {
    const r = await peticion("/admin/imagenes", { method: "POST", headers: { origin: "https://ruleta.test" }, body: formularioImagenes([{ nombre: "a.png", bytes: PNG }]) });
    expect(r.status).toBe(401);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM imagenes").first<{ n: number }>())!.n).toBe(0);
  });

  it("no se borra una imagen en uso; al borrarla se quita de las tiradas antiguas", async () => {
    const cookie = await entrarAdmin();
    const img = await subirPng(cookie);
    const id = await idPremio(1, "Pack de recursos ARK");
    await postAdmin("/admin/premios/guardar?ruleta=1", cookie, await camposPremios(1, { [`imagen_${id}`]: img.ref }));
    await env.DB.prepare("UPDATE tiradas SET premio_imagen = ?1").bind(img.ref).run();
    await crearTiradaConToken({ ruletaId: 1 });
    await env.DB.prepare("UPDATE tiradas SET premio_imagen = ?1").bind(img.ref).run();

    expect(flashDe(await postAdmin(`/admin/imagenes/${img.id}/eliminar`, cookie, {})).error).toMatch(/se usa en premio «Pack de recursos ARK»/);
    await postAdmin("/admin/premios/guardar?ruleta=1", cookie, await camposPremios(1, { [`imagen_${id}`]: "" }));
    expect(flashDe(await postAdmin(`/admin/imagenes/${img.id}/eliminar`, cookie, {})).ok).toMatch(/borrada/);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM tiradas WHERE premio_imagen IS NOT NULL").first<{ n: number }>())!.n).toBe(0);
    expect((await peticion(img.url)).status).toBe(404);
  });

  it("iconos incluidos: SVG con el color pedido; nombres desconocidos dan 404", async () => {
    const r = await peticion("/icono/caja.svg?c=ff5a4f");
    expect(r.headers.get("content-type")).toBe("image/svg+xml");
    expect(await r.text()).toContain('color="#ff5a4f"');
    expect(await (await peticion("/icono/caja.svg?c=%22%3E%3Cscript%3E")).text()).toContain('color="#ffffff"');
    expect((await peticion("/icono/noexiste.svg")).status).toBe(404);
  });
});

describe("premios personalizados", () => {
  it("imagen y descripción: se ven antes de girar, en el resultado y en el correo, y quedan copiadas en la tirada", async () => {
    const cookie = await entrarAdmin();
    const img = await subirPng(cookie);
    const id = await idPremio(1, "Pack de recursos ARK");
    const guardado = await postAdmin(
      "/admin/premios/guardar?ruleta=1",
      cookie,
      await camposPremios(1, { [`imagen_${id}`]: img.ref, [`descripcion_${id}`]: "Se entrega en 24 h en tu servidor", [`descripcion_en_${id}`]: "Delivered within 24 h" }),
    );
    expect(flashDe(guardado).ok).toMatch(/Guardado/);
    await fijarPesos(1, { "Pack de recursos ARK": 10000 });
    const { token, id: tiradaId } = await crearTiradaConToken({ ruletaId: 1, correo: "fan@ejemplo.test" });

    const antes = await (await peticion(`/tirada/${token}`)).text();
    expect(antes).toContain(img.url); // en el gajo y en la tabla de probabilidades
    expect(antes).toContain("Se entrega en 24 h en tu servidor");

    const brevo = simularBrevo();
    const giro = await peticion(`/api/tirada/${token}/girar`, { method: "POST" });
    const cuerpo = (await giro.json()) as { ok: boolean; html: string };
    expect(cuerpo.ok).toBe(true);
    expect(cuerpo.html).toContain(img.url);
    expect(cuerpo.html).toContain("Se entrega en 24 h en tu servidor");
    const t = await env.DB.prepare("SELECT premio_imagen, premio_descripcion, premio_descripcion_en FROM tiradas WHERE id = ?1").bind(tiradaId).first();
    expect(t).toEqual({ premio_imagen: img.ref, premio_descripcion: "Se entrega en 24 h en tu servidor", premio_descripcion_en: "Delivered within 24 h" });
    await new Promise((r) => setTimeout(r, 50));
    expect(brevo.llamadas.at(-1)?.html).toContain("Se entrega en 24 h en tu servidor");
    brevo.restaurar();
  });

  it("rechaza imágenes que no existen o referencias inventadas", async () => {
    const cookie = await entrarAdmin();
    const id = await idPremio(1, "Pack de recursos ARK");
    expect(flashDe(await postAdmin("/admin/premios/guardar?ruleta=1", cookie, await camposPremios(1, { [`imagen_${id}`]: "img:999:0123456789abcdef" }))).error).toMatch(
      /ya no existe/,
    );
    expect(flashDe(await postAdmin("/admin/premios/guardar?ruleta=1", cookie, await camposPremios(1, { [`imagen_${id}`]: "javascript:alert(1)" }))).error).toMatch(/no es válida/);
    expect(leerRef("icono:caja")).toEqual({ tipo: "icono", nombre: "caja" });
    expect(leerRef("icono:../../x")).toBeNull();
  });

  it("«Ajustar a 100 %» reparte en proporción y guarda", async () => {
    expect(ajustarA100([1000, 1000, 1000], [true, true, true])).toEqual([3334, 3333, 3333]);
    expect(ajustarA100([2000, 800, 200, 5000], [true, true, true, false])).toEqual([6667, 2667, 666, 5000]);
    expect(ajustarA100([0, 0], [true, true])).toEqual([5000, 5000]);
    const cookie = await entrarAdmin();
    const sinAjustar = await postAdmin("/admin/premios/guardar?ruleta=1", cookie, await camposPremios(1, { [`peso_${await idPremio(1, "Descuento 5 %")}`]: "90" }));
    expect(flashDe(sinAjustar).error).toMatch(/deben sumar 100 %/);
    const r = await postAdmin("/admin/premios/guardar?ruleta=1", cookie, { ...(await camposPremios(1, { [`peso_${await idPremio(1, "Descuento 5 %")}`]: "90" })), accion: "ajustar" });
    expect(flashDe(r).ok).toMatch(/ajustadas a 100 %/);
    const suma = await env.DB.prepare("SELECT sum(peso) AS s FROM premios WHERE ruleta_id = 1 AND activo = 1").first<{ s: number }>();
    expect(suma!.s).toBe(10000);
  });
});

describe("diseño de la ruleta", () => {
  it("guarda estilo, textos y efectos, y la página del cliente los usa", async () => {
    const cookie = await entrarAdmin();
    const r = await postAdmin("/admin/diseno/2", cookie, {
      color: "#112233",
      color2: "#ffcc00",
      usar_color2: "1",
      marco: "oro",
      luces: "1",
      etiquetas: "imagen",
      centro: "icono:huevo",
      fondo: "volcan",
      fondo_oscuro: "40",
      confeti: "1",
      duracion: "99",
      texto_titulo: "Cápsula Beta",
      texto_boton: "¡Abrir!",
      texto_intro: "<script>alert(1)</script>",
    });
    expect(flashDe(r).ok).toMatch(/Diseño guardado/);
    const fila = await env.DB.prepare("SELECT color, color2, diseno FROM ruletas WHERE id = 2").first<{ color: string; color2: string; diseno: string }>();
    expect(fila).toMatchObject({ color: "#112233", color2: "#ffcc00" });
    const d = leerDiseno(fila!.diseno);
    expect(d).toMatchObject({ marco: "oro", etiquetas: "imagen", centro: "icono:huevo", fondo: "volcan", sonido: false, confeti: true, duracion: 12 });

    const { token } = await crearTiradaConToken({ ruletaId: 2 });
    const html = await (await peticion(`/tirada/${token}`)).text();
    expect(html).toContain("<h1>Cápsula Beta</h1>");
    expect(html).toContain("¡Abrir!");
    expect(html).toContain("marco-oro");
    expect(html).toContain("fondo-volcan");
    expect(html).toContain("--c1:#112233;--c2:#ffcc00");
    expect(html).toContain('"duracion":12');
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain('id="boton-sonido"'); // sonido desactivado
  });

  it("el fondo con imagen propia se aplica en el <style> con nonce; el JSON roto vuelve a los valores por defecto", async () => {
    const cookie = await entrarAdmin();
    const img = await subirPng(cookie, "fondo-jungla.png");
    expect(flashDe(await postAdmin("/admin/diseno/1", cookie, { color: "verde", marco: "neon", etiquetas: "ambos", fondo: img.ref, fondo_oscuro: "70" })).ok).toMatch(/guardado/);
    const { token } = await crearTiradaConToken({ ruletaId: 1 });
    const html = await (await peticion(`/tirada/${token}`)).text();
    expect(html).toContain("fondo-imagen");
    expect(html).toContain(`url(${img.url})`);
    expect(html).toContain("rgba(8,10,8,0.70)");
    expect(flashDe(await postAdmin("/admin/diseno/1", cookie, { color: "verde", fondo: "img:5:0000000000000000" })).error).toMatch(/ya no existe/);
    expect(flashDe(await postAdmin("/admin/diseno/1", cookie, { color: "url(evil)", fondo: "reticula" })).error).toMatch(/color principal/);
    expect(leerDiseno("{roto")).toMatchObject({ marco: "metal", fondo: "reticula", duracion: 7 });
    expect(leerDiseno('{"marco":"<b>","duracion":-5,"fondo":"img:x"}')).toMatchObject({ marco: "metal", duracion: 3, fondo: "reticula" });
  });

  it("vista previa: solo con sesión, se puede mostrar dentro del panel y los giros de prueba no gastan nada", async () => {
    expect((await peticion("/admin/diseno/1/vista")).status).toBe(302);
    const cookie = await entrarAdmin();
    const vista = await peticion("/admin/diseno/1/vista", { headers: { cookie } });
    expect(vista.status).toBe(200);
    expect(vista.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(vista.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    expect(await vista.text()).toContain("Vista previa");
    // El resto de páginas siguen sin poder meterse en un iframe.
    const normal = await peticion("/admin/diseno?ruleta=1", { headers: { cookie } });
    expect(normal.headers.get("x-frame-options")).toBe("DENY");
    expect(normal.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");

    // Previsualizar sin guardar: usa lo enviado, no cambia la base de datos.
    const previa = await postAdmin("/admin/diseno/1/vista", cookie, { color: "#abcdef", marco: "obsidiana", fondo: "aurora", texto_titulo: "Sin guardar" });
    const htmlPrevia = await previa.text();
    expect(htmlPrevia).toContain("Sin guardar");
    expect(htmlPrevia).toContain("marco-obsidiana");
    expect((await env.DB.prepare("SELECT diseno FROM ruletas WHERE id = 1").first<{ diseno: string }>())!.diseno).toBe("{}");

    const antes = await env.DB.prepare("SELECT (SELECT count(*) FROM tiradas) AS t, (SELECT count(*) FROM correos) AS c, (SELECT sum(coalesce(stock, 0)) FROM premios) AS s").first();
    for (let i = 0; i < 5; i++) {
      const r = await postAdmin("/admin/diseno/1/simular", cookie, {});
      const j = (await r.json()) as { ok: boolean; premioId: number; html: string };
      expect(j.ok).toBe(true);
      expect(j.html).toContain("tarjeta-premio");
    }
    const despues = await env.DB.prepare("SELECT (SELECT count(*) FROM tiradas) AS t, (SELECT count(*) FROM correos) AS c, (SELECT sum(coalesce(stock, 0)) FROM premios) AS s").first();
    expect(despues).toEqual(antes);
    // Sin sesión no se puede simular.
    expect((await peticion("/admin/diseno/1/simular", { method: "POST", headers: { origin: "https://ruleta.test" } })).status).toBe(401);
  });
});

describe("ruletas ilimitadas", () => {
  it("duplicar copia premios y diseño (desactivada y sin códigos de cupón)", async () => {
    const cookie = await entrarAdmin();
    await postAdmin("/admin/diseno/3", cookie, { color: "#ff00aa", marco: "neon", fondo: "aurora", etiquetas: "ambos" });
    await env.DB.prepare("INSERT INTO cupones (premio_id, codigo, creado_en) VALUES (?1, 'COD-1', '2026-01-01')").bind(await idPremio(3, "Descuento 20 %")).run();
    const r = await postAdmin("/admin/tramos/3/duplicar", cookie, {});
    expect(flashDe(r).ok).toMatch(/duplicada/);
    const copia = await env.DB.prepare("SELECT * FROM ruletas ORDER BY id DESC LIMIT 1").first<{ id: number; nombre: string; activa: number; color: string; diseno: string }>();
    expect(copia).toMatchObject({ nombre: expect.stringContaining("(copia)"), activa: 0, color: "#ff00aa" });
    expect(leerDiseno(copia!.diseno).marco).toBe("neon");
    const premios = await env.DB.prepare("SELECT tipo, stock FROM premios WHERE ruleta_id = ?1").bind(copia!.id).all<{ tipo: string; stock: number | null }>();
    expect(premios.results.length).toBe(4);
    expect(premios.results.filter((p) => p.tipo === "cupon").every((p) => p.stock === 0)).toBe(true);
  });

  it("se puede borrar una ruleta sin uso, pero no una con tiradas", async () => {
    const cookie = await entrarAdmin();
    await postAdmin("/admin/tramos", cookie, { nombre_nuevo: "Ruleta 4 · Prueba", umbral_nuevo: "60", limite_nuevo: "10", activa_nuevo: "1" });
    const nueva = await env.DB.prepare("SELECT id FROM ruletas WHERE nombre = 'Ruleta 4 · Prueba'").first<{ id: number }>();
    expect(nueva).toBeTruthy();
    expect(flashDe(await postAdmin(`/admin/tramos/${nueva!.id}/eliminar`, cookie, {})).ok).toMatch(/eliminada/);
    await crearTiradaConToken({ ruletaId: 2 });
    expect(flashDe(await postAdmin("/admin/tramos/2/eliminar", cookie, {})).error).toMatch(/no se puede borrar/);
    expect(await env.DB.prepare("SELECT id FROM ruletas WHERE id = 2").first()).toBeTruthy();
  });

  it("el panel de premios, diseño, imágenes y tramos se carga", async () => {
    const cookie = await entrarAdmin();
    for (const ruta of ["/admin/premios?ruleta=1", "/admin/diseno?ruleta=1", "/admin/imagenes", "/admin/tramos"]) {
      const r = await peticion(ruta, { headers: { cookie } });
      expect(r.status, ruta).toBe(200);
    }
  });
});
