// Animación de la ruleta. El premio YA lo ha decidido el servidor: aquí solo se gira hasta él.
// Sin este script la página sigue funcionando (el botón es un formulario normal).
(() => {
  "use strict";

  // Botón "Copiar" del cupón (también en la página de resultado).
  document.addEventListener("click", (ev) => {
    const boton = ev.target.closest("[data-copiar]");
    if (!boton) return;
    const el = document.getElementById(boton.dataset.copiar);
    if (!el || !navigator.clipboard) return;
    navigator.clipboard.writeText(el.textContent.trim()).then(() => {
      const antes = boton.textContent;
      boton.textContent = boton.dataset.copiado || "✓";
      setTimeout(() => (boton.textContent = antes), 1600);
    });
  });

  const nodoDatos = document.getElementById("datos-ruleta");
  if (!nodoDatos) return;
  const datos = JSON.parse(nodoDatos.textContent);
  const form = document.getElementById("form-girar");
  const boton = document.getElementById("boton-girar");
  const rotor = document.getElementById("rotor");
  const puntero = document.querySelector(".puntero");
  const resultado = document.getElementById("resultado");
  const error = document.getElementById("mensaje-error");
  const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let angulo = 0;

  const segmentoBajoPuntero = (a) => {
    const punto = (((360 - (a % 360)) % 360) + 360) % 360;
    return datos.segmentos.findIndex((s) => punto >= s.inicio && punto < s.fin);
  };

  function animar(desde, hasta, ms) {
    return new Promise((fin) => {
      const t0 = performance.now();
      let ultimo = segmentoBajoPuntero(desde);
      const paso = (ahora) => {
        const p = Math.min(1, (ahora - t0) / ms);
        const suave = 1 - Math.pow(1 - p, 4); // frena al final
        const a = desde + (hasta - desde) * suave;
        rotor.setAttribute("transform", `rotate(${a.toFixed(3)})`);
        const actual = segmentoBajoPuntero(a);
        if (actual !== ultimo && puntero && !reducido) {
          ultimo = actual;
          puntero.classList.add("tic");
          setTimeout(() => puntero.classList.remove("tic"), 70);
        }
        if (p < 1) requestAnimationFrame(paso);
        else fin();
      };
      requestAnimationFrame(paso);
    });
  }

  function fallo(texto) {
    error.textContent = texto;
    error.hidden = false;
    boton.disabled = false;
    boton.textContent = datos.textos.girar;
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (boton.disabled) return;
    boton.disabled = true;
    boton.textContent = datos.textos.girando;
    error.hidden = true;

    let respuesta, cuerpo;
    try {
      respuesta = await fetch(datos.api, { method: "POST", headers: { accept: "application/json" }, credentials: "omit" });
      cuerpo = await respuesta.json();
    } catch {
      fallo(datos.textos.error);
      return;
    }
    if (respuesta.status === 409 || [403, 404, 410].includes(respuesta.status)) {
      // Ya usada en otra pestaña, anulada, caducada o país bloqueado: la página explica qué pasa.
      location.reload();
      return;
    }
    if (!respuesta.ok || !cuerpo.ok) {
      fallo((cuerpo && cuerpo.mensaje) || datos.textos.error);
      return;
    }

    const seg = datos.segmentos.find((s) => s.id === cuerpo.premioId);
    // Punto de parada aleatorio dentro del segmento ganador (lejos de los bordes). Es solo estético.
    const objetivo = seg ? seg.inicio + (seg.fin - seg.inicio) * (0.18 + Math.random() * 0.64) : Math.random() * 360;
    const vueltas = reducido ? 1 : 7;
    const resto = (((360 - objetivo - (angulo % 360)) % 360) + 360) % 360;
    const destino = angulo + vueltas * 360 + resto;
    await animar(angulo, destino, reducido ? 900 : 6500);
    angulo = destino;

    form.hidden = true;
    resultado.innerHTML = cuerpo.html; // HTML generado y escapado por el servidor
    const tarjeta = resultado.querySelector(".tarjeta-premio");
    if (tarjeta) tarjeta.scrollIntoView({ behavior: reducido ? "auto" : "smooth", block: "center" });
  });
})();
