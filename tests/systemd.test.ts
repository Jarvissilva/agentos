import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appPaths } from "../src/lib/platform/paths";
import { unitContents } from "../src/lib/scheduler/systemd";

test("systemd unit uses absolute runtime paths, private umask, and explicit persistent XDG storage", () => {
  const unit = unitContents(
    appPaths({ HOME: "/tmp/user", XDG_DATA_HOME: "/tmp/agentos data" }),
  );
  expect(unit).toContain(`ExecStart="${process.execPath}"`);
  expect(unit).toContain("automations worker");
  expect(unit).toContain('Environment="XDG_DATA_HOME=/tmp/agentos data"');
  expect(unit).toContain("UMask=0077");
  expect(unit).not.toContain("dangerously");
  expect(unit).toContain(
    "EnvironmentFile=-/tmp/user/.config/agentos/worker.env",
  );
});

test("installer-managed workers start through the recovery runtime", () => {
  const temporary = mkdtempSync("/tmp/agentos-systemd-update-");
  try {
    const root = join(temporary, "agentos");
    const state = `${root}.installation`;
    mkdirSync(state);
    writeFileSync(join(state, "metadata.json"), "{}");
    const unit = unitContents(
      appPaths({ HOME: temporary }),
      join(root, "src/index.ts"),
    );
    expect(unit).toContain(
      `"${state}/runtime.ts" launch "${root}" automations worker`,
    );
    expect(unit).not.toContain(`"${root}/src/index.ts"`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
