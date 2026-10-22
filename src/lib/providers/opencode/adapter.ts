import { z } from "zod";
import { probe, runInteractive } from "../../platform/process";
import { captureJson, captureOutput, executeNative } from "../execution";
import { openCodeModels } from "../models";
import type {
  ExecutionInput,
  ProviderAdapter,
  ProviderConnection,
  ProviderInfo,
} from "../types";

const response = z.object({
  data: z.object({
    id: z.string().startsWith("ses"),
    title: z.string().nullish(),
    model: z
      .object({
        id: z.string(),
        providerID: z.string(),
        variant: z.string().optional(),
      })
      .optional(),
  }),
});
export class OpenCodeAdapter implements ProviderAdapter {
  readonly id = "opencode";
  async detect(): Promise<ProviderInfo> {
    if (!Bun.which(this.id, { PATH: process.env.PATH }))
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
  async models(cwd?: string) {
    return openCodeModels(
      await captureJson(
        "opencode",
        ["api", "--standalone", "GET", "/api/model"],
        cwd,
      ),
    );
  }
  async connect(cwd?: string): Promise<ProviderConnection> {
    const args = (method: string, path: string, data?: unknown) => [
      "api",
      "--standalone",
      method,
      path,
      ...(data ? ["--data", JSON.stringify(data)] : []),
    ];
    const api = (method: string, path: string, data?: unknown) =>
      captureJson("opencode", args(method, path, data), cwd);
    const request = (method: string, path: string, data?: unknown) =>
      captureOutput("opencode", args(method, path, data), cwd);
    return {
      async create(directory, options, title) {
        const r = response.parse(
          await api("POST", "/api/session", {
            location: { directory },
            ...(title ? { title } : {}),
            ...(options?.nativeModel ? { model: options.nativeModel } : {}),
          }),
        );
        const expected = options?.nativeModel;
        if (
          expected &&
          (r.data.model?.id !== expected.id ||
            r.data.model.providerID !== expected.providerID ||
            (expected.variant && r.data.model.variant !== expected.variant))
        )
          throw new Error("OpenCode rejected the configured model or variant");
        return { threadId: r.data.id, sessionId: r.data.id };
      },
      async readTitle(id) {
        const r = response.parse(
          await api("GET", `/api/session/${encodeURIComponent(id)}`),
        );
        return r.data.title?.trim() || null;
      },
      async rename(id, title) {
        await request("POST", `/api/session/${encodeURIComponent(id)}/rename`, {
          title,
        });
      },
      async resume(id) {
        response.parse(
          await api("GET", `/api/session/${encodeURIComponent(id)}`),
        );
      },
      launch: (id, directory, prompt, _options, runner = runInteractive) =>
        runner(
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
