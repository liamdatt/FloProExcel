function hasAssistantBodyContent(element: HTMLElement): boolean {
  return element.querySelector("markdown-block, thinking-block, tool-message, message-list") !== null;
}

function applyAssistantHooks(root: ParentNode): void {
  for (const host of root.querySelectorAll<HTMLElement>("assistant-message")) {
    const container = host.firstElementChild;
    if (!(container instanceof HTMLElement)) continue;

    const rows = Array.from(container.children)
      .filter((child): child is HTMLElement => child instanceof HTMLElement);

    let bodyRow: HTMLElement | null = null;

    for (const row of rows) {
      row.classList.remove("pi-assistant-body", "pi-assistant-usage", "pi-assistant-aborted");

      if (!bodyRow && row.tagName === "DIV" && hasAssistantBodyContent(row)) {
        bodyRow = row;
      }
    }

    if (bodyRow) {
      bodyRow.classList.add("pi-assistant-body");
    }

    for (const row of rows) {
      if (row === bodyRow) continue;

      if (row.tagName === "SPAN") {
        row.classList.add("pi-assistant-aborted");
        continue;
      }

      if (row.tagName !== "DIV") continue;
      if (hasAssistantBodyContent(row)) continue;
      if (row.querySelector("strong")) continue;

      row.classList.add("pi-assistant-usage");
    }
  }
}

function applyThinkingHooks(root: ParentNode): void {
  for (const label of root.querySelectorAll<HTMLElement>("thinking-block .thinking-header > span:last-child")) {
    const isStreaming = label.classList.contains("animate-shimmer");
    label.classList.toggle("pi-thinking-label--streaming", isStreaming);
  }
}

function applyToolFallbackHooks(root: ParentNode): void {
  for (const wrapper of root.querySelectorAll<HTMLElement>("tool-message > div")) {
    const hasCustomCard = wrapper.querySelector(".pi-tool-card") !== null;
    wrapper.classList.toggle("pi-tool-card-fallback", !hasCustomCard);
  }
}

function applyStreamingCursorHooks(root: ParentNode): void {
  for (const cursor of root.querySelectorAll<HTMLElement>("streaming-message-container span")) {
    const isCursor = cursor.classList.contains("animate-pulse");
    cursor.classList.toggle("pi-streaming-cursor", isCursor);
  }
}

export function applyMessageStyleHooks(root: ParentNode): void {
  applyAssistantHooks(root);
  applyThinkingHooks(root);
  applyToolFallbackHooks(root);
  applyStreamingCursorHooks(root);
}
