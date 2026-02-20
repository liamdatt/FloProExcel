export const OPENROUTER_PROVIDER: "openrouter";
export const OPENROUTER_CURATED_MODELS: readonly string[];
export const MANAGED_OPENROUTER_API_KEY_SENTINEL: string;
export function isOpenRouterCuratedModelId(modelId: string): boolean;
export function isOpenRouterCuratedModel(
  model: { provider?: string; id?: string } | null | undefined,
): boolean;
