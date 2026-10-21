import { expect, test } from "bun:test";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { CodexRpc } from "../src/providers/codex/rpc";

test("Codex RPC handles Unix WebSocket handshake, errors, and closed connections", async () => {
  const dir = mkdtempSync("/tmp/agentos-rpc-test-");
  const server = createServer();
  const websocket = new WebSocketServer({ server });
  const received: string[] = [];
  websocket.on("connection", (socket) => {
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      received.push(message.method);
      if (!message.id) return;
      if (message.method === "close") {
        socket.close();
        return;
      }
      socket.send(
        JSON.stringify(
          message.method === "fail"
            ? {
                id: message.id,
                error: { code: -32600, message: "unsupported operation" },
              }
            : { id: message.id, result: { ok: true } },
        ),
      );
    });
  });
  server.listen(`${dir}/rpc.sock`);
  await once(server, "listening");
  let client: CodexRpc | undefined;
  try {
    client = await CodexRpc.connect(`${dir}/rpc.sock`);
    expect(await client.request("read", {})).toEqual({ ok: true });
    expect(received.slice(0, 2)).toEqual(["initialize", "initialized"]);
    await expect(client.request("fail", {})).rejects.toThrow(
      "unsupported operation",
    );
    await expect(client.request("close", {})).rejects.toThrow(
      "connection closed",
    );
    await expect(client.request("read", {})).rejects.toThrow("not open");
  } finally {
    client?.close();
    for (const socket of websocket.clients) socket.terminate();
    websocket.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
