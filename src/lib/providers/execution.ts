import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";
import { modelArguments } from "./models";
import type { ExecutionInput, ExecutionResult, ProviderId } from "./types";

export const object = (value: unknown): Record<string, unknown> =>
  z.record(z.string(), z.unknown()).parse(value);
export async function captureOutput(
  command: string,
  args: string[],
  cwd?: string,
): Promise<string> {
  const p = Bun.spawn([command, ...args], {
    env: process.env,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    timeout: 30_000,
    killSignal: "SIGKILL",
    maxBuffer: 8 * 1024 * 1024,
  });
  const [out, , code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code !== 0)
    throw new Error(
      `${command} native API failed (exit ${code}); inspect its native diagnostics`,
    );
  return out;
}
export async function captureJson(
  command: string,
  args: string[],
  cwd?: string,
): Promise<unknown> {
  const out = await captureOutput(command, args, cwd);
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`${command} returned invalid structured output`);
  }
}
export async function executeNative(
  provider: ProviderId,
  input: ExecutionInput,
): Promise<ExecutionResult> {
  let preparedId = input.nativeId;
  if (provider === "opencode") {
    const info = object(
      await captureJson(
        "opencode",
        [
          "api",
          "--standalone",
          ...(preparedId
            ? ["GET", `/api/session/${encodeURIComponent(preparedId)}`]
            : [
                "POST",
                "/api/session",
                "--data",
                JSON.stringify({
                  location: { directory: input.cwd },
                  title: "agentos automation",
                }),
              ]),
        ],
        input.cwd,
      ),
    );
    const data = object(info.data);
    preparedId = z.string().startsWith("ses").parse(data.id);
    const location = object(data.location);
    if (location.directory !== input.cwd)
      throw new Error(
        "OpenCode session belongs to a different working directory",
      );
    input.onIdentity?.(preparedId);
  }
  const args =
    provider === "codex"
      ? [
          "exec",
          ...(input.nativeId
            ? ["resume", "--json", input.nativeId, "-"]
            : ["--json", "--skip-git-repo-check", "-"]),
        ]
      : provider === "opencode"
        ? [
            "run",
            "--standalone",
            "--format",
            "json",
            ...(preparedId ? ["--session", preparedId] : []),
            "--",
            input.prompt,
          ]
        : [
            ...modelArguments("agy", input.sessionOptions),
            "--output-format",
            "stream-json",
            ...(input.nativeId ? ["--conversation", input.nativeId] : []),
            `--print=${input.prompt}`,
          ];
  const p = spawn(provider, args, {
    cwd: input.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  let id = preparedId ?? "",
    text = "",
    completed = false,
    failure = false,
    stderr = "",
    abortReason: string | undefined;
  let force: ReturnType<typeof setTimeout> | undefined;
  const stop = (reason: string) => {
    abortReason = reason;
    if (p.pid) {
      try {
        process.kill(-p.pid, "SIGTERM");
      } catch {}
      force ??= setTimeout(() => {
        if (p.pid) {
          try {
            process.kill(-p.pid, "SIGKILL");
          } catch {}
        }
      }, 2000);
    }
  };
  const abort = () => stop("Execution canceled");
  const timeout = setTimeout(
    () => stop("Execution timed out"),
    input.timeoutMs,
  );
  input.signal?.addEventListener("abort", abort, { once: true });
  p.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-32_768);
  });
  const result = new Promise<number>((resolve, reject) => {
    p.once("error", reject);
    p.once("exit", (code) => resolve(code ?? 130));
  });
  // Consume failures immediately even while stdout is being read.
  void result.catch(() => {});
  p.stdin.on("error", () => {});
  p.stdin.end(provider === "codex" ? input.prompt : undefined);
  if (input.signal?.aborted) abort();
  try {
    for await (const line of createInterface({ input: p.stdout })) {
      if (line.length > 1024 * 1024) {
        stop("Provider emitted an oversized event");
        continue;
      }
      let event: Record<string, unknown>;
      try {
        event = object(JSON.parse(line));
      } catch {
        continue;
      }
      const kind = String(event.type ?? event.event ?? "event");
      input.onEvent?.(kind);
      const body =
        event.result && typeof event.result === "object"
          ? object(event.result)
          : event;
      const native =
        event.thread_id ??
        event.conversation_id ??
        event.sessionID ??
        body.conversation_id;
      if (typeof native === "string" && native !== id) {
        id = native;
        input.onIdentity?.(id);
      }
      if (provider === "codex") {
        if (kind === "item.completed" && event.item) {
          const item = object(event.item);
          if (item.type === "agent_message" && typeof item.text === "string")
            text = item.text;
        }
        if (kind === "turn.completed") completed = true;
        if (kind === "turn.failed" || kind === "error") failure = true;
      } else if (provider === "agy") {
        if (kind === "result") {
          completed = body.status === "SUCCESS";
          failure = !completed;
          if (typeof body.response === "string") text = body.response;
        }
      } else {
        if (kind === "text" && event.part) {
          const part = object(event.part);
          if (typeof part.text === "string")
            text = (text + part.text).slice(-100_000);
        }
        if (kind === "step_finish") completed = true;
        if (kind === "error") failure = true;
      }
    }
    const code = await result;
    if (abortReason) throw new Error(abortReason);
    if (provider === "opencode" && code === 0 && id) {
      const info = object(
        await captureJson(
          "opencode",
          [
            "api",
            "--standalone",
            "GET",
            `/api/session/${encodeURIComponent(id)}`,
          ],
          input.cwd,
        ),
      );
      const data = object(info.data);
      completed = data.outcome === "succeeded";
      failure ||= data.outcome === "failed" || data.outcome === "interrupted";
    }
    if (
      /permission[^\n]*(denied|required)|soft.denied|requires approval|approval[^\n]*required/i.test(
        stderr,
      )
    )
      throw new Error(
        "Provider requires attention: native approval was unavailable",
      );
    if (code !== 0 || failure || !completed || !id)
      throw new Error(
        `${provider} execution failed or did not report a verified completion (exit ${code})`,
      );
    return { nativeId: id, text: text.slice(-100_000) };
  } finally {
    clearTimeout(timeout);
    clearTimeout(force);
    input.signal?.removeEventListener("abort", abort);
    if (p.exitCode === null && p.signalCode === null) {
      p.kill("SIGKILL");
      await result.catch(() => {});
    }
  }
}
