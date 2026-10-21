import { expect, test } from "bun:test";
import { chmodSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commands } from "../src/cli/commands";
import {
  agyModels,
  codexModels,
  modelArguments,
  openCodeModels,
  resolveModel,
} from "../src/lib/providers/models";
import type { ModelCatalog } from "../src/lib/providers/types";
import { fixture } from "./helpers";

export const catalog: ModelCatalog = {
  reasoningLabel: "effort",
  models: [
    {
      id: "test-model",
      name: "Test Model",
      reasoning: [{ id: "high" }, { id: "low" }],
    },
    { id: "simple", name: "Simple", reasoning: [] },
  ],
};

test("Codex catalog follows cursors and preserves advertised efforts", async () => {
  const calls: unknown[] = [];
  const result = await codexModels(async (method, params) => {
    calls.push({ method, params });
    return {
      data: [
        {
          model: calls.length === 1 ? "first" : "second",
          displayName: "Model",
          supportedReasoningEfforts: [
            { reasoningEffort: "unusual", description: "Native effort" },
          ],
        },
      ],
      nextCursor: calls.length === 1 ? "page2" : null,
    };
  });
  expect(calls).toEqual([
    { method: "model/list", params: { limit: 100 } },
    { method: "model/list", params: { limit: 100, cursor: "page2" } },
  ]);
  expect(result.models.map((m) => m.id)).toEqual(["first", "second"]);
  expect(result.models[0]?.reasoning).toEqual([
    { id: "unusual", description: "Native effort" },
  ]);
  await expect(
    codexModels(async () => ({ data: [], nextCursor: "same" })),
  ).rejects.toThrow("repeated");
  await expect(codexModels(async () => ({ data: [{}] }))).rejects.toThrow();
});

test("OpenCode keeps provider qualification, model slashes, enabled state, and native variants", () => {
  const model = {
    modelID: "company/model",
    providerID: "router",
    name: "A model",
    enabled: true,
    variants: [{ id: "thinking" }],
  };
  const result = openCodeModels({
    data: [
      model,
      { ...model, providerID: "disabled", enabled: false },
      { ...model, providerID: "other" },
    ],
  });
  expect(result.models.map((m) => m.id)).toEqual([
    "router/company/model",
    "other/company/model",
  ]);
  expect(
    resolveModel(result, {
      model: "router/company/model",
      reasoning: "thinking",
    }),
  ).toEqual({
    model: "router/company/model",
    reasoning: "thinking",
    nativeModel: {
      id: "company/model",
      providerID: "router",
      variant: "thinking",
    },
  });
  expect(
    resolveModel(result, { model: "other/company/model" }).nativeModel,
  ).toEqual({ id: "company/model", providerID: "other" });
});

test("Agy efforts come only from CLI help, never model names", () => {
  const output =
    "Fetching available models...\nmodel-high\tModel High\nplain\tPlain\n";
  expect(
    agyModels(output, "--effort Reasoning effort (low|high|special)").models[1]
      ?.reasoning,
  ).toEqual([{ id: "low" }, { id: "high" }, { id: "special" }]);
  expect(agyModels(output, "").models[0]?.reasoning).toEqual([]);
  expect(agyModels("", "").models).toEqual([]);
  expect(() => agyModels("unexpected output", "")).toThrow("unrecognized");
  expect(modelArguments("agy", { model: "plain", reasoning: "high" })).toEqual([
    "--model",
    "plain",
    "--effort",
    "high",
  ]);
  expect(
    modelArguments("codex", { model: "plain", reasoning: "high" }),
  ).toEqual(["--model", "plain", "--config", 'model_reasoning_effort="high"']);
  expect(modelArguments("codex")).toEqual([]);
});

test("provider defaults persist independently, reject invalid pairs, clear offline, and preserve preferences and permissions", async () => {
  const f = fixture();
  f.app.modelCatalog = async () => catalog;
  try {
    f.app.setPreferredProvider("agy");
    const file = join(f.paths.config, "preferences.json");
    writeFileSync(
      file,
      JSON.stringify({ provider: "agy", extra: { untouched: true } }),
    );
    await f.app.setProviderDefaults("codex", {
      model: "test-model",
      reasoning: "high",
    });
    await f.app.setProviderDefaults("agy", { model: "simple" });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    chmodSync(file, 0o640);
    await f.app.setProviderDefaults("opencode", {
      model: "test-model",
      reasoning: "low",
    });
    expect(statSync(file).mode & 0o777).toBe(0o640);
    const saved = readFileSync(file, "utf8");
    for (const invalid of [
      { reasoning: "high" },
      { model: "missing" },
      { model: "simple", reasoning: "high" },
    ]) {
      await expect(
        f.app.setProviderDefaults("codex", invalid),
      ).rejects.toThrow();
      expect(readFileSync(file, "utf8")).toBe(saved);
    }
    f.app.modelCatalog = async () => {
      throw new Error("Offline");
    };
    await expect(
      f.app.setProviderDefaults("agy", { model: "test-model" }),
    ).rejects.toThrow("Offline");
    expect(f.app.providerDefaults("agy")).toEqual({ model: "simple" });
    await f.app.setProviderDefaults("codex", {});
    expect(f.app.providerDefaults("codex")).toEqual({});
    expect(f.app.providerDefaults("opencode")).toEqual({
      model: "test-model",
      reasoning: "low",
    });
    expect(JSON.parse(readFileSync(file, "utf8")).extra).toEqual({
      untouched: true,
    });
    expect(f.app.preferredProvider()).toBe("agy");
  } finally {
    f.close();
  }
});

test("CLI lists models, configures defaults, resets reasoning on model changes and clears offline", async () => {
  const f = fixture();
  f.app.modelCatalog = async () => catalog;
  const previous = console.log;
  const output: unknown[] = [];
  console.log = (value) => output.push(JSON.parse(value));
  const run = (...args: string[]) =>
    commands(f.app).exitOverride().parseAsync(args, { from: "user" });
  try {
    await run("providers", "models", "codex");
    expect(output.at(-1)).toEqual(catalog);
    await expect(run("settings", "reasoning", "codex", "high")).rejects.toThrow(
      "explicit model",
    );
    await run("settings", "model", "codex", "test-model");
    await run("settings", "reasoning", "codex", "high");
    expect(f.app.providerDefaults("codex")).toEqual({
      model: "test-model",
      reasoning: "high",
    });
    await run("settings", "reasoning", "codex", "--clear");
    expect(f.app.providerDefaults("codex")).toEqual({ model: "test-model" });
    await run("settings", "reasoning", "codex", "high");
    await run("settings", "model", "codex", "simple");
    expect(f.app.providerDefaults("codex")).toEqual({ model: "simple" });
    await expect(
      run("settings", "model", "codex", "simple", "--clear"),
    ).rejects.toThrow("exclusively");
    f.app.modelCatalog = async () => {
      throw new Error("Offline");
    };
    await run("settings", "model", "codex", "--clear");
    expect(f.app.providerDefaults("codex")).toEqual({});
  } finally {
    console.log = previous;
    f.close();
  }
});
