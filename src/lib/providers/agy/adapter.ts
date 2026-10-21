import { probe, runInteractive } from "../../platform/process";
import { executeNative } from "../execution";
import { agyModels, modelArguments } from "../models";
import type {
  ExecutionInput,
  ProviderAdapter,
  ProviderConnection,
  ProviderInfo,
} from "../types";
export class AgyAdapter implements ProviderAdapter {
  readonly id = "agy";
  async detect(): Promise<ProviderInfo> {
    if (!Bun.which(this.id))
      return {
        id: this.id,
        installed: false,
        version: null,
        interactive: false,
        history: false,
        reason: "Not installed",
      };
    return {
      id: this.id,
      installed: true,
      version: await probe(this.id, ["--version"]),
      interactive: true,
      history: false,
      reason:
        "New sessions use one native headless initialization turn to capture their identity. Native history retrieval is not documented.",
    };
  }
  async models() {
    const [models, help] = await Promise.all([
      probe("agy", ["models"], { timeoutMs: 30_000 }),
      probe("agy", ["--help"], { includeStderr: true }),
    ]);
    return agyModels(models, help);
  }
  async connect(cwd = process.cwd()): Promise<ProviderConnection> {
    return {
      async create(directory, options) {
        const r = await executeNative("agy", {
          cwd: directory,
          prompt:
            "Initialize this conversation and wait for my next task. Do not use tools.",
          timeoutMs: 300_000,
          sessionOptions: options,
        });
        return { threadId: r.nativeId, sessionId: r.nativeId };
      },
      async resume() {},
      launch: (id, directory, prompt, options, runner = runInteractive) =>
        runner(
          "agy",
          [
            ...modelArguments("agy", options),
            "--conversation",
            id,
            ...(prompt ? [`--prompt-interactive=${prompt}`] : []),
          ],
          directory || cwd,
        ),
      async history() {
        throw new Error(
          "Agy has no documented history API; resume its native UI to view the conversation",
        );
      },
      async close() {},
    };
  }
  execute(input: ExecutionInput) {
    return executeNative(this.id, input);
  }
}
