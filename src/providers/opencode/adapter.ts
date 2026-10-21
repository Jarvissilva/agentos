import { z } from "zod";
import { probe, runInteractive } from "../../platform/process";
import { captureJson, executeNative } from "../execution";
import type {
  ExecutionInput,
  ProviderAdapter,
  ProviderConnection,
  ProviderInfo,
} from "../types";

const response = z.object({
  data: z.object({ id: z.string().startsWith("ses") }),
});
export class OpenCodeAdapter implements ProviderAdapter {
  readonly id = "opencode";
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
    const version = await probe(this.id, ["--version"]);
    const supported = /\bv?2\./.test(version);
    return {
      id: this.id,
      installed: true,
      version,
      interactive: supported,
      history: supported,
      reason: supported ? null : "This adapter requires OpenCode v2",
    };
  }
  async connect(cwd?: string): Promise<ProviderConnection> {
    const api = (method: string, path: string, data?: unknown) =>
      captureJson(
        "opencode",
        [
          "api",
          "--standalone",
          method,
          path,
          ...(data ? ["--data", JSON.stringify(data)] : []),
        ],
        cwd,
      );
    return {
      async create(directory) {
        const r = response.parse(
          await api("POST", "/api/session", {
            location: { directory },
            title: "Agent OS",
          }),
        );
        return { threadId: r.data.id, sessionId: r.data.id };
      },
      async resume(id) {
        response.parse(
          await api("GET", `/api/session/${encodeURIComponent(id)}`),
        );
      },
      launch: (id, directory, prompt) =>
        runInteractive(
          "opencode",
          [
            "--session",
            id,
            ...(prompt ? [`--prompt=${prompt}`] : []),
            "--",
            directory,
          ],
          directory,
        ),
      history: (id, cursor) =>
        api(
          "GET",
          `/api/session/${encodeURIComponent(id)}/message?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : "&order=desc"}`,
        ),
      async close() {},
    };
  }
  execute(input: ExecutionInput) {
    return executeNative(this.id, input);
  }
}
