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
  const ruleta = document.getElementById("ruleta");
  const rotor = document.getElementById("rotor");
  const puntero = ruleta.querySelector(".puntero");
  const resultado = document.getElementById("resultado");
  const error = document.getElementById("mensaje-error");
  const botonSonido = document.getElementById("boton-sonido");
  const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const efectos = datos.efectos || {};
  let angulo = 0;

  // ---------- Sonido (sintetizado con Web Audio: sin archivos que descargar) ----------
  const leerPreferencia = () => {
    try {
      return localStorage.getItem("ruleta_sonido") !== "0";
    } catch {
      return true;
    }
  };
  let sonido = !!efectos.sonido && leerPreferencia();
  let audio = null;

  function pintarBotonSonido() {
    if (!botonSonido) return;
    botonSonido.hidden = false;
    botonSonido.setAttribute("aria-pressed", String(sonido));
    const texto = sonido ? datos.textos.sonidoOff : datos.textos.sonidoOn;
    botonSonido.setAttribute("aria-label", texto);
    botonSonido.title = texto;
  }
  if (botonSonido) {
    pintarBotonSonido();
    botonSonido.addEventListener("click", () => {
      sonido = !sonido;
      try {
        localStorage.setItem("ruleta_sonido", sonido ? "1" : "0");
      } catch {
        /* sin almacenamiento: solo dura esta visita */
      }
      pintarBotonSonido();
    });
  }

  function contextoAudio() {
    if (!sonido) return null;
    try {
      if (!audio) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audio = new AC();
      }
      if (audio.state === "suspended") audio.resume();
      return audio;
    } catch {
      return null;
    }
  }

  function nota(a, frecuencia, inicio, duracion, volumen, tipo) {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = tipo || "triangle";
    o.frequency.setValueAtTime(frecuencia, inicio);
    g.gain.setValueAtTime(0.0001, inicio);
    g.gain.exponentialRampToValueAtTime(volumen, inicio + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);
    o.connect(g).connect(a.destination);
    o.start(inicio);
    o.stop(inicio + duracion + 0.05);
  }

  let ultimoTic = 0;
  function tic() {
    const a = contextoAudio();
    if (!a) return;
    const t = a.currentTime;
    if (t - ultimoTic < 0.035) return;
    ultimoTic = t;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(2100, t);
    o.frequency.exponentialRampToValueAtTime(500, t + 0.025);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + 0.05);
  }

  function fanfarria() {
    const a = contextoAudio();
    if (!a) return;
    const t = a.currentTime + 0.02;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => nota(a, f, t + i * 0.09, 0.35, 0.16));
    [1046.5, 1318.5, 1568].forEach((f) => nota(a, f, t + 0.4, 1.1, 0.07, "sine"));
    nota(a, 261.63, t + 0.4, 1.0, 0.1);
  }

  // ---------- Confeti ----------
  function confeti(colores) {
    if (reducido || !efectos.confeti) return;
    const lienzo = document.createElement("canvas");
    lienzo.className = "confeti";
    lienzo.setAttribute("aria-hidden", "true");
    document.body.appendChild(lienzo);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ancho = window.innerWidth;
    const alto = window.innerHeight;
    lienzo.width = ancho * dpr;
    lienzo.height = alto * dpr;
    const c = lienzo.getContext("2d");
    c.scale(dpr, dpr);
    const caja = ruleta.getBoundingClientRect();
    const ox = caja.left + caja.width / 2;
    const oy = caja.top + caja.height / 2;
    const piezas = Array.from({ length: 170 }, () => {
      const ang = Math.random() * Math.PI * 2;
      const vel = 5 + Math.random() * 11;
      return {
        x: ox,
        y: oy,
        vx: Math.cos(ang) * vel,
        vy: Math.sin(ang) * vel - 6,
        lado: 5 + Math.random() * 7,
        giro: Math.random() * Math.PI,
        vgiro: (Math.random() - 0.5) * 0.4,
        color: colores[Math.floor(Math.random() * colores.length)],
        redonda: Math.random() < 0.3,
      };
    });
    const t0 = performance.now();
    const paso = (ahora) => {
      const t = ahora - t0;
      c.clearRect(0, 0, ancho, alto);
      c.globalAlpha = Math.max(0, Math.min(1, (3400 - t) / 800));
      for (const p of piezas) {
        p.vx *= 0.985;
        p.vy = p.vy * 0.985 + 0.28;
        p.x += p.vx;
        p.y += p.vy;
        p.giro += p.vgiro;
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.giro);
        c.fillStyle = p.color;
        if (p.redonda) {
          c.beginPath();
          c.arc(0, 0, p.lado / 2.4, 0, Math.PI * 2);
          c.fill();
        } else c.fillRect(-p.lado / 2, -p.lado / 4, p.lado, p.lado / 2);
        c.restore();
      }
      if (t < 3400) requestAnimationFrame(paso);
      else lienzo.remove();
    };
    requestAnimationFrame(paso);
  }

  // ---------- Giro ----------
  const segmentoBajoPuntero = (a) => {
    const punto = (((360 - (a % 360)) % 360) + 360) % 360;
    return datos.segmentos.findIndex((s) => punto >= s.inicio && punto < s.fin);
  };

  const ponerAngulo = (a) => {
    rotor.style.transform = `rotate(${a.toFixed(3)}deg)`;
  };

  function animar(desde, hasta, rebote, ms) {
    return new Promise((fin) => {
      const t0 = performance.now();
      let ultimo = segmentoBajoPuntero(desde);
      const corte = rebote ? 0.9 : 1; // al final se pasa un poco y vuelve, como una ruleta de verdad
      const paso = (ahora) => {
        const p = Math.min(1, (ahora - t0) / ms);
        let a;
        if (p < corte) {
          const q = p / corte;
          a = desde + (hasta + rebote - desde) * (1 - Math.pow(1 - q, 4));
        } else {
          const q = (p - corte) / (1 - corte);
          a = hasta + rebote * (1 - (1 - Math.cos(q * Math.PI)) / 2);
        }
        ponerAngulo(a);
        const actual = segmentoBajoPuntero(a);
        if (actual !== ultimo) {
          ultimo = actual;
          tic();
          if (puntero && !reducido) {
            puntero.classList.add("tic");
            setTimeout(() => puntero.classList.remove("tic"), 70);
          }
        }
        if (p < 1) requestAnimationFrame(paso);
        else fin();
      };
      requestAnimationFrame(paso);
    });
  }

  function fallo(texto) {
    ruleta.classList.remove("girando");
    error.textContent = texto;
    error.hidden = false;
    boton.disabled = false;
    boton.textContent = datos.textos.girar;
  }

  function limpiarRevelado() {
    ruleta.classList.remove("revelado", "premiada");
    ruleta.querySelectorAll(".gajo.ganador").forEach((g) => g.classList.remove("ganador"));
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (boton.disabled) return;
    contextoAudio(); // el navegador solo deja activar el audio tras un clic
    boton.disabled = true;
    boton.textContent = datos.textos.girando;
    error.hidden = true;
    limpiarRevelado();

    let respuesta, cuerpo;
    try {
      respuesta = await fetch(datos.api, {
        method: "POST",
        headers: { accept: "application/json" },
        credentials: datos.demo ? "same-origin" : "omit",
      });
      cuerpo = await respuesta.json();
    } catch {
      fallo(datos.textos.error);
      return;
    }
    if (!datos.demo && (respuesta.status === 409 || [403, 404, 410].includes(respuesta.status))) {
      // Ya usada en otra pestaña, anulada, caducada o país bloqueado: la página explica qué pasa.
      location.reload();
      return;
    }
    if (!respuesta.ok || !cuerpo.ok) {
      fallo((cuerpo && cuerpo.mensaje) || datos.textos.error);
      return;
    }

    ruleta.classList.add("girando");
    resultado.innerHTML = "";
    const seg = datos.segmentos.find((s) => s.id === cuerpo.premioId);
    // Punto de parada aleatorio dentro del segmento ganador (lejos de los bordes). Es solo estético.
    const ancho = seg ? seg.fin - seg.inicio : 360;
    const objetivo = seg ? seg.inicio + ancho * (0.2 + Math.random() * 0.6) : Math.random() * 360;
    const duracion = Math.max(3, Math.min(12, Number(efectos.duracion) || 7));
    const vueltas = reducido ? 1 : Math.round(3 + duracion * 0.6);
    const resto = (((360 - objetivo - (angulo % 360)) % 360) + 360) % 360;
    const destino = angulo + vueltas * 360 + resto;
    const rebote = reducido ? 0 : Math.min(1.8, ancho * 0.15);
    await animar(angulo, destino, rebote, reducido ? 900 : duracion * 1000);
    angulo = destino;

    // Revelación: el gajo ganador se ilumina, las luces parpadean con su color, confeti y fanfarria.
    ruleta.classList.remove("girando");
    const color = (seg && seg.color) || "#ffffff";
    ruleta.style.setProperty("--ganador", color);
    ruleta.classList.add("revelado", "premiada");
    const gajo = rotor.querySelector(`.gajo[data-id="${cuerpo.premioId}"]`);
    if (gajo) gajo.classList.add("ganador");
    fanfarria();
    confeti([color, color, datos.colores[0], datos.colores[1], "#ffffff", "#ffd76a"]);

    resultado.innerHTML = cuerpo.html; // HTML generado y escapado por el servidor
    if (datos.demo) {
      boton.disabled = false; // en la vista previa se puede girar las veces que quieras
      boton.textContent = datos.textos.girar;
    } else form.hidden = true;
    const tarjeta = resultado.querySelector(".tarjeta-premio");
    // Primero se ve el gajo ganador iluminado; luego se baja hasta la tarjeta del premio.
    if (tarjeta) setTimeout(() => tarjeta.scrollIntoView({ behavior: reducido ? "auto" : "smooth", block: "center" }), reducido ? 0 : 1500);
  });
})();
