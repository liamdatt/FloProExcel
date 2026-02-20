export const OPENROUTER_PROVIDER = "openrouter";

export const OPENROUTER_CURATED_MODELS = [
  "google/gemini-3.1-pro-preview",
  "anthropic/claude-sonnet-4.6",
  "openai/gpt-5.2-codex",
  "moonshotai/kimi-k2.5",
  "minimax/minimax-m2.5",
];

export const MANAGED_OPENROUTER_API_KEY_SENTINEL = "managed-openrouter-key";

const OPENROUTER_CURATED_MODEL_SET = new Set(OPENROUTER_CURATED_MODELS);

export function isOpenRouterCuratedModelId(modelId) {
  return OPENROUTER_CURATED_MODEL_SET.has(modelId);
}

export function isOpenRouterCuratedModel(model) {
  if (!model || typeof model !== "object") return false;
  if (model.provider !== OPENROUTER_PROVIDER) return false;
  if (typeof model.id !== "string") return false;
  return isOpenRouterCuratedModelId(model.id);
}
