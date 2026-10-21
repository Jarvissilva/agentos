import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeNative } from "../src/lib/providers/execution";

const roots: string[] = [],
  originalPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = originalPath;
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function executable(name: string, code: string) {
  const root = mkdtempSync("/tmp/agentos-exec-test-");
  roots.push(root);
  writeFileSync(join(root, name), `#!${process.execPath}\n${code}\n`, {
    mode: 0o700,
  });
  process.env.PATH = `${root}:${originalPath}`;
  return root;
}
test("background Codex preserves prompt as stdin and requires native completion", async () => {
  const cwd = executable(
    "codex",
    `const prompt=await new Response(Bun.stdin.stream()).text();if(process.argv.includes("--dangerously-bypass-approvals-and-sandbox"))process.exit(2);console.log(JSON.stringify({type:"thread.started",thread_id:"native-id"}));console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:prompt}}));console.log(JSON.stringify({type:"turn.completed"}));`,
  );
  const result = await executeNative("codex", {
    cwd,
    prompt: "--dangerously-bypass-approvals-and-sandbox",
    timeoutMs: 1000,
  });
  expect(result.text).toBe("--dangerously-bypass-approvals-and-sandbox");
  expect(result.nativeId).toBe("native-id");
});
test("zero exit without terminal completion is not reported as success", async () => {
  const cwd = executable(
    "codex",
    `console.log(JSON.stringify({type:"thread.started",thread_id:"native-id"}));`,
  );
  await expect(
    executeNative("codex", { cwd, prompt: "Work", timeoutMs: 1000 }),
  ).rejects.toThrow("verified completion");
});
test("native approval soft-denials require attention even if Agy exits zero", async () => {
  const cwd = executable(
    "agy",
    `console.error("permission required: command soft-denied");console.log(JSON.stringify({event:"result",result:{conversation_id:"native",status:"SUCCESS",response:"Incomplete"}}));`,
  );
  await expect(
    executeNative("agy", { cwd, prompt: "Work", timeoutMs: 1000 }),
  ).rejects.toThrow("requires attention");
});
test("timeout kills an unresponsive native process group", async () => {
  const cwd = executable(
    "codex",
    `process.on("SIGTERM",()=>{});setInterval(()=>{},100);`,
  );
  const start = Date.now();
  await expect(
    executeNative("codex", { cwd, prompt: "Work", timeoutMs: 100 }),
  ).rejects.toThrow("timed out");
  expect(Date.now() - start).toBeLessThan(4000);
});
