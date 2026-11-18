// Pequeñas ayudas del panel (sin dependencias). El panel funciona también sin JavaScript.
(() => {
  "use strict";
  // Casilla "marcar todos": marca las casillas con ese name dentro del mismo formulario.
  document.addEventListener("change", (ev) => {
    const maestra = ev.target.closest("[data-marcar-todos]");
    if (!maestra) return;
    const form = maestra.form || document;
    form.querySelectorAll(`input[type=checkbox][name="${maestra.dataset.marcarTodos}"]`).forEach((c) => (c.checked = maestra.checked));
  });
  // Confirmación antes de acciones delicadas.
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-confirmar]");
    if (b && !window.confirm(b.dataset.confirmar)) ev.preventDefault();
  });
  // Botones "Copiar" (enlaces directos): copia el valor del campo indicado.
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-copiar]");
    if (!b) return;
    const campo = document.getElementById(b.dataset.copiar);
    if (!campo) return;
    const texto = campo.value ?? campo.textContent;
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      campo.select(); // sin permiso de portapapeles: deja el texto seleccionado para Ctrl+C
      return;
    }
    const antes = b.textContent;
    b.textContent = "Copiado ✓";
    setTimeout(() => (b.textContent = antes), 1600);
  });
  // Al hacer clic en un enlace generado se selecciona entero.
  document.addEventListener("focusin", (ev) => {
    if (ev.target.matches(".enlace-generado input, .enlace-generado textarea")) ev.target.select();
  });

  // Miniatura del desplegable de imagen (premios y diseño).
  document.addEventListener("change", (ev) => {
    const sel = ev.target.closest("[data-vista-imagen]");
    if (!sel) return;
    const img = sel.parentElement.querySelector("[data-miniatura]");
    const src = sel.selectedOptions[0] && sel.selectedOptions[0].dataset.src;
    if (!img) return;
    if (src) {
      img.src = src;
      img.hidden = false;
    } else img.hidden = true;
  });

  // Deslizadores con su valor al lado.
  document.addEventListener("input", (ev) => {
    const r = ev.target.closest("input[type=range][data-salida]");
    const salida = r && r.parentElement.querySelector("output");
    if (salida) salida.textContent = r.value;
  });

  // Diseño: la vista previa se actualiza sola (envía el formulario al iframe, sin guardar).
  const formDiseno = document.querySelector("form[data-vista-previa-auto]");
  const botonPrevia = document.getElementById("boton-previsualizar");
  if (formDiseno && botonPrevia && formDiseno.requestSubmit) {
    let espera = null;
    const actualizar = () => {
      clearTimeout(espera);
      espera = setTimeout(() => formDiseno.requestSubmit(botonPrevia), 500);
    };
    formDiseno.addEventListener("change", actualizar);
    formDiseno.addEventListener("input", (ev) => {
      if (ev.target.matches("input[type=color], input[type=range]")) actualizar();
    });
  }

  // Imágenes: se reducen en el navegador antes de subirlas (más rápido y no gasta espacio de más).
  const entrada = document.querySelector("input[type=file][data-reducir]");
  if (entrada && window.DataTransfer && HTMLCanvasElement.prototype.toBlob) {
    const form = entrada.form;
    const uso = form.querySelector("[data-uso]");
    const estado = form.querySelector("[data-estado-subida]");
    const previas = form.querySelector("[data-previas]");
    let originales = [];

    const cargar = (archivo) =>
      new Promise((ok, mal) => {
        const url = URL.createObjectURL(archivo);
        const img = new Image();
        img.onload = () => ok({ img, url });
        img.onerror = () => {
          URL.revokeObjectURL(url);
          mal(new Error("no es una imagen"));
        };
        img.src = url;
      });
    const aBlob = (lienzo, tipo, calidad) => new Promise((ok) => lienzo.toBlob(ok, tipo, calidad));

    async function reducir(archivo, maximo) {
      if (archivo.type === "image/gif") return archivo; // los GIF animados se suben tal cual
      const { img, url } = await cargar(archivo);
      const escala = Math.min(1, maximo / Math.max(img.naturalWidth, img.naturalHeight));
      if (escala === 1 && archivo.size <= 400000 && archivo.type !== "image/png") {
        URL.revokeObjectURL(url);
        return archivo;
      }
      const lienzo = document.createElement("canvas");
      lienzo.width = Math.max(1, Math.round(img.naturalWidth * escala));
      lienzo.height = Math.max(1, Math.round(img.naturalHeight * escala));
      const ctx = lienzo.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
      URL.revokeObjectURL(url);
      let blob = await aBlob(lienzo, "image/webp", 0.86);
      // Navegadores sin WebP: PNG (mantiene la transparencia) o JPEG para fondos.
      if (!blob || blob.type !== "image/webp") blob = await aBlob(lienzo, maximo > 600 ? "image/jpeg" : "image/png", 0.86);
      if (!blob || blob.size >= archivo.size) return archivo;
      const nombre = archivo.name.replace(/\.[a-z0-9]+$/i, "") + (blob.type === "image/webp" ? ".webp" : blob.type === "image/png" ? ".png" : ".jpg");
      return new File([blob], nombre, { type: blob.type });
    }

    async function procesar() {
      if (!originales.length) return;
      const maximo = uso && uso.value === "fondo" ? 1920 : 512;
      estado.textContent = "Preparando imágenes…";
      previas.textContent = "";
      const dt = new DataTransfer();
      let total = 0;
      for (const archivo of originales) {
        let final = archivo;
        try {
          final = await reducir(archivo, maximo);
        } catch {
          /* el servidor dirá si no es válida */
        }
        dt.items.add(final);
        total += final.size;
        const p = document.createElement("img");
        p.alt = "";
        p.src = URL.createObjectURL(final);
        previas.appendChild(p);
      }
      entrada.files = dt.files;
      estado.textContent = `${dt.files.length} imagen(es) lista(s) · ${Math.round(total / 1000)} kB en total. Pulsa «Subir».`;
    }

    entrada.addEventListener("change", () => {
      originales = Array.from(entrada.files || []);
      procesar();
    });
    if (uso) uso.addEventListener("change", procesar);
  }
})();
