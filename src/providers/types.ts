export type ProviderId = "codex" | "opencode" | "agy";
export interface ProviderInfo {
  id: ProviderId;
  installed: boolean;
  version: string | null;
  interactive: boolean;
  history: boolean;
  reason: string | null;
}
export interface NativeThread {
  threadId: string;
  sessionId: string;
}
export interface ProviderConnection {
  create(cwd: string): Promise<NativeThread>;
  resume(threadId: string): Promise<void>;
  launch(threadId: string, cwd: string, prompt?: string): Promise<number>;
  history(threadId: string, cursor?: string): Promise<unknown>;
  close(): Promise<void>;
}
export interface ProviderAdapter {
  id: ProviderId;
  detect(): Promise<ProviderInfo>;
  connect(cwd?: string): Promise<ProviderConnection>;
  execute?(input: ExecutionInput): Promise<ExecutionResult>;
}
export interface ExecutionInput {
  cwd: string;
  prompt: string;
  nativeId?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  onEvent?: (event: string) => void;
  onIdentity?: (id: string) => void;
}
export interface ExecutionResult {
  nativeId: string;
  text: string;
}
