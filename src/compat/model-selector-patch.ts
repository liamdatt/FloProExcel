/**
 * Model selector patch.
 *
 * FloPro exposes managed OpenRouter curated models only.
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import { ModelSelector } from "@mariozechner/pi-web-ui/dist/dialogs/ModelSelector.js";

import {
  OPENROUTER_CURATED_MODELS,
  OPENROUTER_PROVIDER,
} from "../../shared/openrouter-curated-models.mjs";

let _activeProviders: Set<string> | null = null;

export function setActiveProviders(providers: Set<string>) {
  _activeProviders = providers;
}

type ModelSelectorItem = {
  provider: string;
  id: string;
  model: Model<Api>;
};

type ModelSelectorPrivate = {
  getFilteredModels: (this: ModelSelector) => ModelSelectorItem[];
};

let _installed = false;

const CURATED_ID_SET = new Set<string>(OPENROUTER_CURATED_MODELS);
const CURATED_ID_ORDER = new Map<string, number>(
  OPENROUTER_CURATED_MODELS.map((id, index) => [id, index]),
);

function curatedModelCompare(a: ModelSelectorItem, b: ModelSelectorItem): number {
  const aRank = CURATED_ID_ORDER.get(a.id) ?? Number.MAX_SAFE_INTEGER;
  const bRank = CURATED_ID_ORDER.get(b.id) ?? Number.MAX_SAFE_INTEGER;

  if (aRank !== bRank) {
    return aRank - bRank;
  }

  return a.id.localeCompare(b.id);
}

export function installModelSelectorPatch(): void {
  if (_installed) return;
  _installed = true;

  const modelSelectorProto = ModelSelector.prototype as unknown as Partial<ModelSelectorPrivate>;
  const orig = modelSelectorProto.getFilteredModels;

  if (typeof orig !== "function") {
    console.warn(
      "[pi] ModelSelector.getFilteredModels() is missing; managed model filtering is disabled.",
    );
    return;
  }

  modelSelectorProto.getFilteredModels = function (this: ModelSelector): ModelSelectorItem[] {
    // Preserve upstream filtering behavior while forcing lowercase token match.
    const savedQuery = this.searchQuery;
    this.searchQuery = savedQuery.toLowerCase();
    const all = orig.call(this);
    this.searchQuery = savedQuery;

    const active = _activeProviders;
    const canUseOpenRouter = !active || active.size === 0 || active.has(OPENROUTER_PROVIDER);
    if (!canUseOpenRouter) {
      return [];
    }

    const curatedOnly = all
      .filter((item) => item.provider === OPENROUTER_PROVIDER && CURATED_ID_SET.has(item.id))
      .sort(curatedModelCompare);

    const currentModel = this.currentModel;
    const currentIndex = curatedOnly.findIndex((item) =>
      Boolean(currentModel && item.model.provider === currentModel.provider && item.model.id === currentModel.id));

    if (currentIndex <= 0) {
      return curatedOnly;
    }

    const [current] = curatedOnly.splice(currentIndex, 1);
    curatedOnly.unshift(current);
    return curatedOnly;
  };
}
