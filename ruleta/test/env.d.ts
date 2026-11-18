import type { D1Migration } from "cloudflare:test";
import type { Env as EnvApp } from "../src/tipos";

declare global {
  namespace Cloudflare {
    interface Env extends EnvApp {
      TEST_MIGRATIONS: D1Migration[];
      TEST_CONTRASENA: string;
    }
  }
}
