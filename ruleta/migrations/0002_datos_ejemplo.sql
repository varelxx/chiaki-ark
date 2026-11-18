-- Valores de ejemplo (editables desde el panel). Cada ruleta suma 10000 = 100 %.
-- Coste esperado con estos valores: Ruleta 1 ≈ 0,66 €, Ruleta 2 ≈ 1,38 €, Ruleta 3 = 3,10 €.
-- Los premios de tipo cupón empiezan con stock 0: no salen en la ruleta hasta que importes
-- en el panel los códigos de un solo uso que hayas creado en tu tienda.

INSERT INTO ruletas (id, nombre, nombre_en, color, color2, umbral_cents, limite_coste_cents, activa) VALUES
  (1, 'Ruleta 1 · Cápsula verde', 'Wheel 1 · Green drop', 'verde', NULL, 1000, 200, 1),
  (2, 'Ruleta 2 · Cápsula azul', 'Wheel 2 · Blue drop', 'azul', NULL, 2000, 400, 1),
  (3, 'Ruleta 3 · Cápsula amarilla/roja', 'Wheel 3 · Yellow/red drop', 'amarilla', 'roja', 3500, 700, 1);

INSERT INTO premios (ruleta_id, nombre, nombre_en, tipo, rareza, peso, stock, coste_cents, activo, orden) VALUES
  (1, 'Descuento 5 %', '5% discount', 'cupon', 'gris', 4500, 0, 50, 1, 1),
  (1, 'Descuento 10 %', '10% discount', 'cupon', 'verde', 2500, 0, 100, 1, 2),
  (1, 'Pack de recursos ARK', 'ARK resource pack', 'ark', 'cian', 2000, NULL, 30, 1, 3),
  (1, 'Cápsula azul ARK', 'ARK blue drop', 'ark', 'azul', 800, NULL, 100, 1, 4),
  (1, 'Cápsula amarilla ARK', 'ARK yellow drop', 'ark', 'amarilla', 200, NULL, 200, 1, 5),

  (2, 'Descuento 10 %', '10% discount', 'cupon', 'verde', 3500, 0, 100, 1, 1),
  (2, 'Descuento 15 %', '15% discount', 'cupon', 'morada', 2500, 0, 150, 1, 2),
  (2, 'Cápsula azul ARK', 'ARK blue drop', 'ark', 'azul', 2500, NULL, 100, 1, 3),
  (2, 'Cápsula amarilla ARK', 'ARK yellow drop', 'ark', 'amarilla', 1000, NULL, 200, 1, 4),
  (2, 'Cápsula roja ARK', 'ARK red drop', 'ark', 'roja', 500, NULL, 400, 1, 5),

  (3, 'Descuento 20 %', '20% discount', 'cupon', 'morada', 4000, 0, 300, 1, 1),
  (3, 'Cápsula amarilla ARK', 'ARK yellow drop', 'ark', 'amarilla', 4000, NULL, 200, 1, 2),
  (3, 'Cápsula roja ARK', 'ARK red drop', 'ark', 'roja', 1500, NULL, 400, 1, 3),
  (3, 'Dino domesticado legendario', 'Legendary tamed dino', 'ark', 'legendaria', 500, NULL, 1000, 1, 4);
