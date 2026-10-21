import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { probe, runInteractive } from "../../platform/process";
import { executeNative } from "../execution";
import { codexModels, modelArguments } from "../models";
import type {
  ExecutionInput,
  ProviderAdapter,
  ProviderConnection,
  ProviderInfo,
} from "../types";
import { CodexRpc } from "./rpc";

// Verified against the generated 0.163.0 protocol; validate response subsets at
// runtime because provider upgrades are independent of agentos upgrades.
const threadResponse = z.object({
  model: z.string().optional(),
  reasoningEffort: z.string().nullish(),
  thread: z.object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    name: z.string().nullish(),
  }),
});

export class CodexAdapter implements ProviderAdapter {
  execute(input: ExecutionInput) {
    return executeNative("codex", input);
  }
  readonly id = "codex";
  async detect(): Promise<ProviderInfo> {
    if (!Bun.which("codex"))
      return {
        id: this.id,
        installed: false,
        version: null,
        interactive: false,
        history: false,
        reason: "Not installed",
      };
    try {
      const version = await probe("codex", ["--version"]);
      const help = await probe("codex", ["--help"]);
      const serverHelp = await probe("codex", ["app-server", "--help"]);
      const supported =
        help.includes("resume") && serverHelp.includes("unix://");
      return {
        id: this.id,
        installed: true,
        version,
        interactive: supported,
        history: supported,
        reason: supported
          ? null
          : "Requires Codex with native resume and Unix App Server support (tested with 0.163.0)",
      };
    } catch (error) {
      return {
        id: this.id,
        installed: true,
        version: null,
        interactive: false,
        history: false,
        reason: error instanceof Error ? error.message : "Detection failed",
      };
    }
  }

  async models(cwd?: string) {
    const connection = await this.connect(cwd);
    try {
      if (!connection.models)
        throw new Error("Codex model discovery is unavailable");
      return await connection.models();
    } finally {
      await connection.close();
    }
  }
  async connect(cwd?: string): Promise<ProviderConnection> {
    const info = await this.detect();
    if (!info.interactive) throw new Error(info.reason ?? "Codex unavailable");
    const dir = mkdtempSync(join(tmpdir(), "agentos-codex-"));
    chmodSync(dir, 0o700);
    const socket = join(dir, "rpc.sock");
    const endpoint = `unix://${socket}`;
    const child = spawn("codex", ["app-server", "--listen", endpoint], {
      cwd: cwd ?? dir,
      stdio: "ignore",
      detached: true,
    });
    let spawnError: Error | undefined;
    child.once("error", (error) => {
      spawnError = error;
    });
    let rpc: CodexRpc | undefined;
    const close = async () => {
      rpc?.close();
      const pid = child.pid;
      if (pid && child.exitCode === null && child.signalCode === null) {
        const kill = (signal: NodeJS.Signals) => {
          try {
            process.kill(-pid, signal);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          }
        };
        const exited = new Promise<void>((resolve) =>
          child.once("exit", () => resolve()),
        );
        kill("SIGTERM");
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          exited,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 3000);
          }),
        ]);
        clearTimeout(timer);
        // Kill only this application's process group, including leftover tools.
        kill("SIGKILL");
        await exited;
      }
      rmSync(dir, { recursive: true, force: true });
    };
    try {
      for (let i = 0; i < 100 && !existsSync(socket); i++) {
        if (spawnError || child.exitCode !== null || child.signalCode !== null)
          throw (
            spawnError ??
            new Error(
              "Codex App Server exited during startup; run codex doctor for diagnostics",
            )
          );
        await Bun.sleep(100);
      }
      if (!existsSync(socket))
        throw new Error(
          "Codex App Server did not create its socket within 10 seconds",
        );
      rpc = await CodexRpc.connect(socket);
      const client = rpc;
      return {
        models: () =>
          codexModels((method, params) => client.request(method, params)),
        async create(cwd, options, title) {
          const result = threadResponse.parse(
            await client.request("thread/start", {
              cwd,
              ephemeral: false,
              ...(options?.model ? { model: options.model } : {}),
              ...(options?.reasoning
                ? { config: { model_reasoning_effort: options.reasoning } }
                : {}),
            }),
          );
          if (options?.model && result.model !== options.model)
            throw new Error(
              `Codex rejected configured model: ${options.model}`,
            );
          if (
            options?.reasoning &&
            result.reasoningEffort !== options.reasoning
          )
            throw new Error(
              `Codex rejected configured reasoning effort: ${options.reasoning}`,
            );
          if (title) {
            // Naming materializes the native rollout before another client (the
            // official TUI) resumes it. An unnamed empty thread is memory-only.
            await client.request("thread/name/set", {
              threadId: result.thread.id,
              name: title,
            });
          } else {
            // Materialize a session created without a prompt without inventing
            // a synthetic name. Codex can assign its own title after the first turn.
            await client.request("thread/section/move", {
              threadId: result.thread.id,
              sectionId: null,
            });
          }
          return {
            threadId: result.thread.id,
            sessionId: result.thread.sessionId,
          };
        },
        async readTitle(threadId) {
          const result = threadResponse.parse(
            await client.request("thread/read", { threadId }),
          );
          return result.thread.name ?? null;
        },
        async rename(threadId, name) {
          await client.request("thread/name/set", { threadId, name });
        },
        async resume(threadId) {
          threadResponse.parse(
            await client.request("thread/read", { threadId }),
          );
        },
        launch: async (
          threadId,
          cwd,
          prompt,
          options,
          runner = runInteractive,
        ) => {
          // Stop the bootstrap server before handing control to ordinary Codex.
          // Its native TUI then uses its normal backend and permission handling.
          await close();
          return runner(
            "codex",
            [
              "resume",
              ...modelArguments("codex", options),
              "--cd",
              cwd,
              "--",
              threadId,
              ...(prompt ? [prompt] : []),
            ],
            cwd,
          );
        },
        history: (threadId, cursor) =>
          client.request("thread/turns/list", {
            threadId,
            limit: 20,
            itemsView: "full",
            ...(cursor ? { cursor } : {}),
          }),
        close,
      };
    } catch (error) {
      await close();
      throw error;
    }
  }
}
