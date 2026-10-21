export type ProviderId = "codex" | "opencode" | "agy";
export interface ProviderDefaults {
  model?: string;
  reasoning?: string;
}
export interface NativeModelReference {
  id: string;
  providerID: string;
  variant?: string;
}
export interface SessionOptions extends ProviderDefaults {
  nativeModel?: NativeModelReference;
}
export interface ProviderModel {
  id: string;
  name: string;
  reasoning: { id: string; description?: string }[];
  nativeModel?: NativeModelReference;
}
export interface ModelCatalog {
  models: ProviderModel[];
  reasoningLabel: string;
}
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
export type InteractiveRunner = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<number>;

export interface ProviderConnection {
  create(
    cwd: string,
    options?: SessionOptions,
    title?: string,
  ): Promise<NativeThread>;
  models?(): Promise<ModelCatalog>;
  readTitle?(threadId: string): Promise<string | null>;
  rename?(threadId: string, title: string): Promise<void>;
  resume(threadId: string): Promise<void>;
  launch(
    threadId: string,
    cwd: string,
    prompt?: string,
    options?: SessionOptions,
    runner?: InteractiveRunner,
  ): Promise<number>;
  history(threadId: string, cursor?: string): Promise<unknown>;
  close(): Promise<void>;
}
export interface ProviderAdapter {
  id: ProviderId;
  models?(cwd?: string): Promise<ModelCatalog>;
  detect(): Promise<ProviderInfo>;
  connect(cwd?: string): Promise<ProviderConnection>;
  execute?(input: ExecutionInput): Promise<ExecutionResult>;
}
export interface ExecutionInput {
  cwd: string;
  prompt: string;
  nativeId?: string;
  sessionOptions?: SessionOptions;
  signal?: AbortSignal;
  timeoutMs: number;
  onEvent?: (event: string) => void;
  onIdentity?: (id: string) => void;
}
export interface ExecutionResult {
  nativeId: string;
  text: string;
}
