import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Application } from "../src/app";
import { appPaths } from "../src/lib/platform/paths";
import type { ProviderManager } from "../src/lib/providers/manager";
import { openDatabase } from "../src/lib/storage/database";

export function fixture(providers?: ProviderManager) {
  const root = mkdtempSync("/tmp/agentos-test-");
  const paths = appPaths({
    HOME: root,
    XDG_DATA_HOME: join(root, "data"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_CACHE_HOME: join(root, "cache"),
  });
  const storage = openDatabase(paths);
  return {
    root,
    paths,
    storage,
    app: new Application(storage.db, paths, providers),
    close() {
      storage.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
