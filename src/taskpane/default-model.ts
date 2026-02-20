/**
 * Default model selection for the taskpane.
 *
 * FloPro uses managed OpenRouter only.
 */

import { getModels, type Api, type Model } from "@mariozechner/pi-ai";

import {
  OPENROUTER_CURATED_MODELS,
  OPENROUTER_PROVIDER,
} from "../../shared/openrouter-curated-models.mjs";

function pickFirstCuratedOpenRouterModel(): Model<Api> {
  const models: Model<Api>[] = getModels(OPENROUTER_PROVIDER);

  for (const curatedModelId of OPENROUTER_CURATED_MODELS) {
    const match = models.find((model) => model.id === curatedModelId);
    if (match) {
      return match;
    }
  }

  if (models.length > 0) {
    return models[0];
  }

  throw new Error("No OpenRouter models are available in this runtime.");
}

export function pickDefaultModel(_availableProviders: string[]): Model<Api> {
  return pickFirstCuratedOpenRouterModel();
}
