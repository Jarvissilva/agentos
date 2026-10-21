import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { atomicWrite } from "../../lib/platform/files";
import { type AppPaths, directory } from "../../lib/platform/paths";
import type { ProviderManager } from "../../lib/providers/manager";
import {
  providerDefaultsSchema,
  resolveModel,
} from "../../lib/providers/models";
import type {
  ModelCatalog,
  ProviderDefaults,
  ProviderId,
  SessionOptions,
} from "../../lib/providers/types";

export class SettingsService {
  constructor(
    private paths: AppPaths,
    private providers: ProviderManager,
    private discoverModels: (
      provider: string,
      cwd?: string,
    ) => Promise<ModelCatalog>,
  ) {}
  private readPreferences() {
    const file = join(this.paths.config, "preferences.json");
    try {
      if (!lstatSync(file).isFile())
        throw new Error("Preferences must be a regular file");
      const text = readFileSync(file, "utf8");
      const value = z
        .object({
          provider: z.enum(["codex", "opencode", "agy"]).optional(),
          defaultDirectory: z.string().min(1).optional(),
          providerDefaults: z
            .object({
              codex: providerDefaultsSchema.optional(),
              opencode: providerDefaultsSchema.optional(),
              agy: providerDefaultsSchema.optional(),
            })
            .passthrough()
            .optional(),
        })
        .passthrough()
        .parse(JSON.parse(text));
      return { file, text, value };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { file, text: "", value: {} };
      throw error;
    }
  }
  providerDefaults(provider: ProviderId): ProviderDefaults {
    return this.readPreferences().value.providerDefaults?.[provider] ?? {};
  }
  async modelCatalog(provider: string, cwd?: string) {
    const adapter = this.providers.adapter(provider);
    if (!adapter.models)
      throw new Error(`${provider} model discovery is unavailable`);
    return adapter.models(cwd);
  }
  async validateProviderDefaults(
    provider: ProviderId,
    defaults: ProviderDefaults,
    cwd?: string,
  ): Promise<SessionOptions> {
    providerDefaultsSchema.parse(defaults);
    return defaults.model
      ? resolveModel(await this.discoverModels(provider, cwd), defaults)
      : {};
  }
  async setProviderDefaults(provider: ProviderId, defaults: ProviderDefaults) {
    this.providers.adapter(provider);
    const parsed = providerDefaultsSchema.parse(defaults);
    await this.validateProviderDefaults(provider, parsed);
    const { file, text, value } = this.readPreferences();
    atomicWrite(
      file,
      `${JSON.stringify({ ...value, providerDefaults: { ...value.providerDefaults, [provider]: parsed } }, null, 2)}\n`,
      text,
    );
  }
  preferredProvider() {
    return this.readPreferences().value.provider;
  }
  setPreferredProvider(provider: ProviderId) {
    this.providers.adapter(provider);
    const { file, text, value } = this.readPreferences();
    atomicWrite(
      file,
      `${JSON.stringify({ ...value, provider }, null, 2)}\n`,
      text,
    );
  }
  defaultDirectory() {
    return this.readPreferences().value.defaultDirectory;
  }
  setDefaultDirectory(input?: string) {
    const { file, text, value } = this.readPreferences();
    const defaultDirectory = input?.trim() ? directory(input) : undefined;
    atomicWrite(
      file,
      `${JSON.stringify({ ...value, defaultDirectory }, null, 2)}\n`,
      text,
    );
    return defaultDirectory;
  }
}
