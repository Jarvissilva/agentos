import { z } from "zod";
import type {
  ModelCatalog,
  ProviderDefaults,
  ProviderModel,
  SessionOptions,
} from "./types";

const text = z.string().min(1);
export const providerDefaultsSchema = z
  .object({ model: text.optional(), reasoning: text.optional() })
  .refine(
    (v) => !v.reasoning || !!v.model,
    "Reasoning requires an explicit model",
  );

export function resolveModel(
  catalog: ModelCatalog,
  defaults: ProviderDefaults,
): SessionOptions {
  if (!defaults.model) {
    if (defaults.reasoning)
      throw new Error("Reasoning requires an explicit model");
    return {};
  }
  const model = catalog.models.find((m) => m.id === defaults.model);
  if (!model)
    throw new Error(
      `Configured model is unavailable: ${defaults.model}. Update or clear its default in Settings.`,
    );
  if (
    defaults.reasoning &&
    !model.reasoning.some((r) => r.id === defaults.reasoning)
  )
    throw new Error(
      `Configured ${catalog.reasoningLabel} is unavailable for ${model.id}: ${defaults.reasoning}`,
    );
  return {
    ...defaults,
    ...(model.nativeModel
      ? {
          nativeModel: {
            ...model.nativeModel,
            ...(defaults.reasoning ? { variant: defaults.reasoning } : {}),
          },
        }
      : {}),
  };
}

export async function codexModels(
  request: (method: string, params: unknown) => Promise<unknown>,
): Promise<ModelCatalog> {
  const schema = z.object({
    data: z.array(
      z.object({
        model: text,
        displayName: text,
        supportedReasoningEfforts: z.array(
          z.object({ reasoningEffort: text, description: z.string() }),
        ),
      }),
    ),
    nextCursor: text.nullish(),
  });
  const models: ProviderModel[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = schema.parse(
      await request("model/list", {
        limit: 100,
        ...(cursor ? { cursor } : {}),
      }),
    );
    models.push(
      ...page.data.map((m) => ({
        id: m.model,
        name: m.displayName,
        reasoning: m.supportedReasoningEfforts.map((r) => ({
          id: r.reasoningEffort,
          description: r.description,
        })),
      })),
    );
    cursor = page.nextCursor ?? undefined;
    if (cursor && cursors.has(cursor))
      throw new Error("Codex model catalog repeated a pagination cursor");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return { models, reasoningLabel: "reasoning effort" };
}

export function openCodeModels(value: unknown): ModelCatalog {
  const result = z
    .object({
      data: z.array(
        z.object({
          modelID: text,
          providerID: text,
          name: text,
          enabled: z.boolean(),
          variants: z.array(z.object({ id: text })),
        }),
      ),
    })
    .parse(value);
  return {
    reasoningLabel: "variant",
    models: result.data
      .filter((m) => m.enabled)
      .map((m) => ({
        id: `${m.providerID}/${m.modelID}`,
        name: m.name,
        nativeModel: { id: m.modelID, providerID: m.providerID },
        reasoning: m.variants.map((v) => ({ id: v.id })),
      })),
  };
}

export function agyModels(output: string, help: string): ModelCatalog {
  // Models is a tab-separated native catalog, not a model-name capability heuristic.
  const efforts =
    /--effort[^\n]*\(([^)]+)\)/
      .exec(help)?.[1]
      ?.split("|")
      .map((v) => v.trim())
      .filter(Boolean) ?? [];
  const models = output.split(/\r?\n/).flatMap((line) => {
    const match = /^([^\s]+)\t(.+)$/.exec(line);
    return match?.[1] && match[2]
      ? [
          {
            id: match[1],
            name: match[2],
            reasoning: efforts.map((id) => ({ id })),
          },
        ]
      : [];
  });
  if (
    !models.length &&
    output.trim() &&
    !/^(Fetching available models\.\.\.|No (?:available )?models[^\n]*)\s*$/i.test(
      output.trim(),
    )
  )
    throw new Error("Agy returned an unrecognized model catalog");
  return { models, reasoningLabel: "effort" };
}

export function modelArguments(
  provider: "codex" | "agy",
  options?: SessionOptions,
): string[] {
  return [
    ...(options?.model ? ["--model", options.model] : []),
    ...(options?.reasoning
      ? provider === "codex"
        ? [
            "--config",
            `model_reasoning_effort=${JSON.stringify(options.reasoning)}`,
          ]
        : ["--effort", options.reasoning]
      : []),
  ];
}
