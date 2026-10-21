import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Application } from "../src/core/application";
import { appPaths } from "../src/platform/paths";
import type { ProviderManager } from "../src/providers/manager";
import { openDatabase } from "../src/storage/database";

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
