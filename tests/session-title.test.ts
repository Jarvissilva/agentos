import { expect, test } from "bun:test";
import {
  cleanSessionTitle,
  SESSION_TITLE_MAX,
  sessionLabel,
  sessionTitle,
  shortenSessionTitle,
} from "../src/modules/sessions/title";

test("session titles normalize whitespace, controls, and terminal escapes", () => {
  expect(sessionTitle("  Fix\n\tcheckout   flow  ")).toBe("Fix checkout flow");
  expect(sessionTitle("\u001b[31mRed\u001b[0m\u0000 task")).toBe("Red task");
  expect(sessionTitle(" \n\t ")).toBeUndefined();
  expect(sessionTitle(undefined)).toBeUndefined();
  expect(cleanSessionTitle("  provider\nname  ")).toBe("provider name");
});

test("session titles are shortened at a word boundary within sixty characters", () => {
  const long = sessionTitle(
    "Investigate the intermittent checkout failure that only appears in the production workspace after sign-in",
  );
  expect(long?.length).toBeLessThanOrEqual(SESSION_TITLE_MAX);
  expect(long).toBe("Investigate the intermittent checkout failure that only…");
  const unbroken = sessionTitle("x".repeat(SESSION_TITLE_MAX + 10));
  expect([...(unbroken ?? [])]).toHaveLength(SESSION_TITLE_MAX);
  expect(unbroken?.endsWith("…")).toBe(true);
  expect(shortenSessionTitle("short title")).toBe("short title");
});

test("labels prefer the stored title, then project, then directory basename", () => {
  expect(
    sessionLabel({ title: "Checkout bug", cwd: "/work/agentos" }, "Project"),
  ).toBe("Checkout bug");
  expect(sessionLabel({ title: null, cwd: "/work/agentos" }, "Project")).toBe(
    "Project",
  );
  expect(sessionLabel({ title: null, cwd: "/work/agentos" })).toBe("agentos");
});
