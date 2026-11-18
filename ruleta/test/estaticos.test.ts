import { describe, expect, it } from "vitest";
import { ESTATICOS } from "../src/estaticos.generado";
import { peticion } from "./ayudas";

describe("archivos estáticos incrustados", () => {
  it("sirve CSS con versión y caché de un año, y responde 304 si no cambió", async () => {
    const hash = ESTATICOS["/css/app.css"].hash;
    const r = await peticion(`/css/app.css?v=${hash}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/css");
    expect(r.headers.get("cache-control")).toContain("immutable");
    expect(await r.text()).toContain(".boton-girar");
    const r304 = await peticion(`/css/app.css?v=${hash}`, { headers: { "if-none-match": `"${hash}"` } });
    expect(r304.status).toBe(304);
  });

  it("sirve las fuentes woff2 como binario íntegro", async () => {
    const r = await peticion("/fonts/rajdhani-latin-700-normal.woff2");
    expect(r.headers.get("content-type")).toBe("font/woff2");
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("wOF2");
    expect(bytes.length).toBe(atob(ESTATICOS["/fonts/rajdhani-latin-700-normal.woff2"].contenido).length);
  });

  it("las páginas enlazan los estáticos con versión", async () => {
    const html = await (await peticion("/")).text();
    expect(html).toContain(`/css/app.css?v=${ESTATICOS["/css/app.css"].hash}`);
  });
});
