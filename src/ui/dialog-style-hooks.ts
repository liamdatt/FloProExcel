const DIALOG_HOST_TAGS = new Set([
  "agent-model-selector",
  "api-key-prompt-dialog",
  "agent-api-key-dialog",
  "agent-settings-dialog",
]);

let observer: MutationObserver | null = null;
let installRequested = false;
let applyScheduled = false;

function getElementChildren(element: HTMLElement): HTMLElement[] {
  return Array.from(element.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement);
}

function applyModelSelectorItemHooks(item: HTMLElement): void {
  item.classList.add("pi-model-selector-item");
  item.classList.toggle("pi-model-selector-item--selected", item.classList.contains("bg-accent"));

  const itemRows = getElementChildren(item);
  const topRow = itemRows[0];
  const metaRow = itemRows[1];

  if (topRow) {
    const modelId = topRow.querySelector<HTMLElement>("span");
    if (modelId) {
      modelId.classList.add("pi-model-selector-item-id");
    }

    const providerBadge = topRow.lastElementChild;
    if (providerBadge instanceof HTMLElement) {
      providerBadge.classList.add("pi-model-selector-item-provider");
    }
  }

  if (!metaRow) return;

  metaRow.classList.add("pi-model-selector-item-meta");

  const capabilities = metaRow.firstElementChild;
  if (capabilities instanceof HTMLElement) {
    capabilities.classList.add("pi-model-selector-item-capabilities");
  }

  const cost = metaRow.lastElementChild;
  if (cost instanceof HTMLElement) {
    cost.classList.add("pi-model-selector-item-cost");
  }
}

function applyModelSelectorHooks(host: HTMLElement, card: HTMLElement): void {
  card.classList.add("pi-model-selector-card");

  const contentRows = getElementChildren(card)
    .filter((child) => !(child instanceof HTMLButtonElement));

  const header = contentRows[0];
  const list = contentRows[1];

  if (header) {
    header.classList.add("pi-model-selector-header");

    const filterRow = header.lastElementChild;
    if (filterRow instanceof HTMLElement && filterRow.querySelector("button")) {
      filterRow.classList.add("pi-model-selector-filters");
    }
  }

  if (list) {
    list.classList.add("pi-model-selector-list");
  }

  for (const item of host.querySelectorAll<HTMLElement>("[data-model-item]")) {
    applyModelSelectorItemHooks(item);
  }
}

function applyApiKeyDialogHooks(host: HTMLElement): void {
  for (const button of host.querySelectorAll<HTMLButtonElement>("provider-key-input button")) {
    button.classList.add("pi-dialog-save-button");
  }
}

function applyDialogHostHooks(host: HTMLElement): void {
  host.classList.add("pi-dialog-host");

  const backdrop = host.firstElementChild;
  if (!(backdrop instanceof HTMLElement)) return;

  backdrop.classList.add("pi-dialog-backdrop");

  const card = backdrop.firstElementChild;
  if (!(card instanceof HTMLElement)) return;

  card.classList.add("pi-dialog-card");

  for (const child of getElementChildren(card)) {
    if (child instanceof HTMLButtonElement) {
      child.classList.add("pi-dialog-close");
    }
  }

  const tagName = host.tagName.toLowerCase();
  if (tagName === "agent-model-selector") {
    applyModelSelectorHooks(host, card);
    return;
  }

  if (tagName === "api-key-prompt-dialog" || tagName === "agent-api-key-dialog") {
    applyApiKeyDialogHooks(host);
  }
}

function applyDialogStyleHooks(): void {
  for (const host of document.querySelectorAll<HTMLElement>(Array.from(DIALOG_HOST_TAGS).join(","))) {
    applyDialogHostHooks(host);
  }
}

function scheduleApplyDialogStyleHooks(): void {
  if (applyScheduled) return;
  applyScheduled = true;

  requestAnimationFrame(() => {
    applyScheduled = false;
    applyDialogStyleHooks();
  });
}

export function installDialogStyleHooks(): void {
  if (installRequested) return;
  installRequested = true;

  applyDialogStyleHooks();

  observer = new MutationObserver(() => {
    scheduleApplyDialogStyleHooks();
  });

  const target = document.body ?? document.documentElement;
  observer.observe(target, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });
}
