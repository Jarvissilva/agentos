import { expect, test } from "bun:test";
import { appPaths } from "../src/platform/paths";
import { unitContents } from "../src/scheduler/systemd";

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
    "EnvironmentFile=-/tmp/user/.config/agent-os/worker.env",
  );
});
