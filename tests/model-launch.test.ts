import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fixture } from "./helpers";

test("native contracts pass model settings to initialization and TUI while resumes use no new overrides", async () => {
  const f = fixture();
  const log = join(f.root, "calls.jsonl");
  const path = process.env.PATH;
  const inputTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const outputTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  const script = (name: string, body: string) =>
    writeFileSync(
      join(f.root, name),
      `#!${process.execPath}\nimport {appendFileSync,existsSync} from "node:fs";\nconst args=process.argv.slice(2);const record=(value)=>appendFileSync(${JSON.stringify(log)},JSON.stringify({provider:${JSON.stringify(name)},...value})+"\\n");record({args});\n${body}`,
      { mode: 0o700 },
    );
  try {
    script("stty", 'if(args[0]==="-g")console.log("saved-state");');
    script(
      "codex",
      `
      if(args.includes("--version"))console.log("codex 0.163.0");
      else if(args.includes("--help"))console.log("resume unix://");
      else if(args[0]==="app-server") {
        const {createServer}=await import("node:http");
        const {WebSocketServer}=await import(${JSON.stringify(resolve("node_modules/ws/index.js"))});
        const server=createServer();const wss=new WebSocketServer({server});
        wss.on("connection",socket=>socket.on("message",raw=>{
          const msg=JSON.parse(raw.toString());record({request:msg});if(!msg.id)return;
          let result={};
          if(msg.method==="model/list") result={data:[{model:"native-model",displayName:"Native",supportedReasoningEfforts:[{reasoningEffort:"high",description:"High"}]}],nextCursor:null};
          if(msg.method==="thread/start")result={thread:{id:"thread",sessionId:"session"},model:existsSync(${JSON.stringify(join(f.root, "reject-model"))})?"fallback":msg.params.model,reasoningEffort:msg.params.config?.model_reasoning_effort};
          if(msg.method==="thread/read")result={thread:{id:"thread",sessionId:"session"}};
          socket.send(JSON.stringify({id:msg.id,result}));
        }));server.listen(args[args.indexOf("--listen")+1].replace("unix://",""));
      }
    `,
    );
    script(
      "opencode",
      `
      if(args.includes("--version"))console.log("2.0.0");
      else if(args[0]==="api") {
        if(args.includes("/api/model"))console.log(JSON.stringify({data:[{modelID:"org/model",providerID:"router",name:"Native",enabled:true,variants:[{id:"thinking"}]}]}));
        else if(args.includes("POST")) {
          const body=JSON.parse(args[args.indexOf("--data")+1]);record({body});
          if(!args.includes("/rename"))console.log(JSON.stringify({data:{id:"ses-test",model:existsSync(${JSON.stringify(join(f.root, "reject-model"))})?{id:"fallback",providerID:"other"}:body.model}}));
        } else console.log(JSON.stringify({data:{id:"ses-test"}}));
      }
    `,
    );
    script(
      "agy",
      `
      if(args.includes("--version"))console.log("agy test");
      else if(args.includes("--help"))console.error("--effort Reasoning effort (low|high)");
      else if(args[0]==="models")console.log("native-model\\tNative Model");
      else if(args.includes("--output-format"))console.log(JSON.stringify({event:"result",result:{conversation_id:"conversation",status:"SUCCESS",response:"Initialized"}}));
    `,
    );
    process.env.PATH = `${f.root}:${path}`;
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    await f.app.setProviderDefaults("codex", {
      model: "native-model",
      reasoning: "high",
    });
    await f.app.setProviderDefaults("opencode", {
      model: "router/org/model",
      reasoning: "thinking",
    });
    await f.app.setProviderDefaults("agy", {
      model: "native-model",
      reasoning: "low",
    });
    const sessionIds: Record<string, string> = {};
    for (const provider of ["codex", "opencode", "agy"]) {
      const session = await f.app.newSession({
        provider,
        cwd: f.root,
        prompt: "Task",
      });
      expect(session.status).toBe("idle");
      sessionIds[provider] = session.id;
      await f.app.resumeSession(session.id);
    }
    const calls: {
      provider: string;
      args?: string[];
      request?: { method: string; params: unknown };
      body?: unknown;
    }[] = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const codex = calls.filter((c) => c.provider === "codex");
    expect(
      codex.find((c) => c.request?.method === "thread/start")?.request?.params,
    ).toEqual({
      cwd: f.root,
      ephemeral: false,
      model: "native-model",
      config: { model_reasoning_effort: "high" },
    });
    expect(
      codex.find((c) => c.request?.method === "thread/name/set")?.request
        ?.params,
    ).toEqual({ threadId: "thread", name: "Task" });
    expect(
      codex.some(
        (c) =>
          c.request?.method === "thread/name/set" &&
          JSON.stringify(c.request.params).includes("agentos"),
      ),
    ).toBe(false);
    const codexLaunches = codex.filter((c) => c.args?.[0] === "resume");
    const initialPrompt = codexLaunches[0]?.args?.at(-1);
    if (!initialPrompt)
      throw new Error("Expected the initial memory and task prompt");
    expect(initialPrompt).toBe("Task");
    expect(codexLaunches.map((c) => c.args)).toEqual([
      [
        "resume",
        "--model",
        "native-model",
        "--config",
        'model_reasoning_effort="high"',
        "--cd",
        f.root,
        "--",
        "thread",
        initialPrompt,
      ],
      ["resume", "--cd", f.root, "--", "thread"],
    ]);
    expect(
      calls.find((c) => c.provider === "opencode" && c.body)?.body,
    ).toEqual({
      location: { directory: f.root },
      title: "Task",
      model: { id: "org/model", providerID: "router", variant: "thinking" },
    });
    expect(
      calls
        .filter((c) => c.provider === "opencode" && c.args?.[0] === "--session")
        .map((c) => c.args),
    ).toEqual([
      ["--session", "ses-test", `--prompt=${initialPrompt}`, "--", f.root],
      ["--session", "ses-test", "--", f.root],
    ]);
    const agy = calls.filter((c) => c.provider === "agy");
    expect(
      agy.find((c) => c.args?.includes("--output-format"))?.args?.slice(0, 4),
    ).toEqual(["--model", "native-model", "--effort", "low"]);
    expect(
      agy.find((c) => c.args?.includes(`--prompt-interactive=${initialPrompt}`))
        ?.args,
    ).toEqual([
      "--model",
      "native-model",
      "--effort",
      "low",
      "--conversation",
      "conversation",
      `--prompt-interactive=${initialPrompt}`,
    ]);
    expect(agy.at(-1)?.args).toEqual(["--conversation", "conversation"]);
    const codexId = sessionIds.codex;
    const opencodeId = sessionIds.opencode;
    if (!codexId || !opencodeId) throw new Error("Expected native sessions");
    await f.app.renameSession(codexId, "Codex renamed");
    await f.app.renameSession(opencodeId, "OpenCode renamed");
    expect(f.app.session(codexId).title).toBe("Codex renamed");
    expect(f.app.session(opencodeId).title).toBe("OpenCode renamed");
    const renamedCalls = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      renamedCalls.find(
        (c) =>
          c.request?.method === "thread/name/set" &&
          c.request.params.name === "Codex renamed",
      )?.request?.params,
    ).toEqual({ threadId: "thread", name: "Codex renamed" });
    expect(
      renamedCalls.filter(
        (c) =>
          c.provider === "opencode" &&
          c.body &&
          typeof c.body === "object" &&
          "title" in c.body &&
          c.body.title === "OpenCode renamed",
      ),
    ).toHaveLength(1);
    const blank = await f.app.newSession({ provider: "codex", cwd: f.root });
    expect(blank.title).toBeNull();
    const blankOpenCode = await f.app.newSession({
      provider: "opencode",
      cwd: f.root,
    });
    expect(blankOpenCode.title).toBeNull();
    const withBlank = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      withBlank.find((c) => c.request?.method === "thread/section/move")
        ?.request?.params,
    ).toEqual({ threadId: "thread", sectionId: null });
    const openCodeBodies = withBlank.filter(
      (c) => c.provider === "opencode" && c.body,
    );
    expect(openCodeBodies.at(-1)?.body).toEqual({
      location: { directory: f.root },
      model: { id: "org/model", providerID: "router", variant: "thinking" },
    });
    writeFileSync(join(f.root, "reject-model"), "true");
    await expect(
      f.app.newSession({ provider: "codex", cwd: f.root }),
    ).rejects.toThrow("rejected configured model");
    await expect(
      f.app.newSession({ provider: "opencode", cwd: f.root }),
    ).rejects.toThrow("rejected the configured model");
  } finally {
    process.env.PATH = path;
    if (inputTTY) Object.defineProperty(process.stdin, "isTTY", inputTTY);
    else Reflect.deleteProperty(process.stdin, "isTTY");
    if (outputTTY) Object.defineProperty(process.stdout, "isTTY", outputTTY);
    else Reflect.deleteProperty(process.stdout, "isTTY");
    f.close();
  }
}, 20_000);
