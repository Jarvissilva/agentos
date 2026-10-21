import { AgyAdapter } from "./agy/adapter";
import { CodexAdapter } from "./codex/adapter";
import { OpenCodeAdapter } from "./opencode/adapter";
import type { ProviderAdapter, ProviderInfo } from "./types";
export class ProviderManager {
  private adapters: ProviderAdapter[] = [
    new CodexAdapter(),
    new OpenCodeAdapter(),
    new AgyAdapter(),
  ];
  adapter(id: string): ProviderAdapter {
    const a = this.adapters.find((v) => v.id === id);
    if (!a) throw new Error(`Unknown provider: ${id}`);
    return a;
  }
  async list(): Promise<ProviderInfo[]> {
    return Promise.all(
      this.adapters.map(async (a) => {
        try {
          return await a.detect();
        } catch {
          return {
            id: a.id,
            installed: Boolean(Bun.which(a.id)),
            version: null,
            interactive: false,
            history: false,
            reason:
              "Native capability detection failed; inspect the provider directly",
          };
        }
      }),
    );
  }
}
