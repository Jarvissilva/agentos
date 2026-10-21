import WebSocket from "ws";
import { z } from "zod";

const envelope = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

export class CodexRpc {
  private nextId = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private constructor(private socket: WebSocket) {
    socket.on("message", (data) => {
      try {
        const message = envelope.parse(JSON.parse(data.toString()));
        if (message.method && message.id !== undefined) {
          // Control/approval requests belong to the native TUI client. This
          // metadata connection never grants permission on the user's behalf.
          socket.send(
            JSON.stringify({
              id: message.id,
              error: {
                code: -32601,
                message:
                  "agentos metadata client does not handle control requests",
              },
            }),
          );
          return;
        }
        if (typeof message.id !== "number") return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error)
          pending.reject(new Error(`Codex: ${message.error.message}`));
        else pending.resolve(message.result);
      } catch {
        this.fail(new Error("Invalid message from Codex App Server"));
      }
    });
    socket.on("close", () =>
      this.fail(new Error("Codex App Server connection closed")),
    );
    socket.on("error", () =>
      this.fail(new Error("Codex App Server connection failed")),
    );
  }

  static async connect(path: string): Promise<CodexRpc> {
    const socket = new WebSocket(`ws+unix://${path}:/`, {
      handshakeTimeout: 2000,
      maxPayload: 16 * 1024 * 1024,
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const rpc = new CodexRpc(socket);
    try {
      await rpc.request("initialize", {
        clientInfo: { name: "agentos", title: "agentos", version: "0.1.0" },
      });
      socket.send(JSON.stringify({ method: "initialized" }));
      return rpc;
    } catch (error) {
      rpc.close();
      throw error;
    }
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error("Codex connection is not open"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }), (error) => {
        if (error) this.fail(error);
      });
    });
  }

  private fail(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
  close(): void {
    this.fail(new Error("Codex connection closed"));
    this.socket.terminate();
  }
}
