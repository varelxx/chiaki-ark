import { applyD1Migrations, env, reset } from "cloudflare:test";
import { afterEach, beforeEach, vi } from "vitest";

// Cada test empieza con una D1 limpia: esquema + datos de ejemplo de las migraciones.
beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

afterEach(() => {
  vi.restoreAllMocks();
});
