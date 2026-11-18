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
})();
