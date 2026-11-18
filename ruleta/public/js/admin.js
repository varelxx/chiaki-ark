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
})();
