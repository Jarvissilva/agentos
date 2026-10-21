import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sourceCheckoutDirectory } from "../src/lib/platform/paths";

test("source checkout resolution is independent of the launch directory", () => {
  const original = process.cwd();
  const root = realpathSync(join(import.meta.dir, ".."));
  try {
    process.chdir("/tmp");
    expect(sourceCheckoutDirectory()).toBe(root);
  } finally {
    process.chdir(original);
  }
});

test("source checkout resolution rejects missing or unrelated source trees clearly", () => {
  const root = mkdtempSync("/tmp/agentos-checkout-");
  const source = pathToFileURL(join(root, "src/lib/platform/paths.ts")).href;
  try {
    expect(() => sourceCheckoutDirectory(source)).toThrow(
      "source checkout is unavailable",
    );
    mkdirSync(join(root, "src/tui"), { recursive: true });
    writeFileSync(join(root, "package.json"), '{"name":"another-app"}');
    writeFileSync(join(root, "src/index.ts"), "");
    writeFileSync(join(root, "src/tui/app.tsx"), "");
    expect(() => sourceCheckoutDirectory(source)).toThrow(
      "source checkout is unavailable",
    );
    writeFileSync(join(root, "package.json"), '{"name":"agentos"}');
    expect(sourceCheckoutDirectory(source)).toBe(realpathSync(root));
    rmSync(join(root, "src/tui/app.tsx"));
    expect(() => sourceCheckoutDirectory(source)).toThrow(
      "source checkout is unavailable",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
