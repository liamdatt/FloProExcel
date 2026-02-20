/**
 * Tool card grouping — wraps consecutive same-tool calls in a single
 * continuous container element. Groups are always expanded.
 */

/**
 * Initialise tool-card grouping on the given root element.
 * Returns a cleanup function that disconnects the observer and removes
 * all grouping artefacts.
 */
export function initToolGrouping(root: HTMLElement): () => void {
  let rafId = 0;

  /* ── Unwrap existing groups ────────────────────────────── */

  function unwrapAll() {
    for (const wrapper of root.querySelectorAll(".pi-tool-group")) {
      const parent = wrapper.parentNode;
      if (!parent) continue;
      while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
      parent.removeChild(wrapper);
    }
  }

  /* ── Grouping pass ────────────────────────────────────── */

  function applyGrouping() {
    // Disconnect observer during DOM manipulation to avoid re-entrancy.
    observer.disconnect();

    // Flatten — move all tool-messages back to root.
    unwrapAll();

    // Clean up classes on all tool-messages.
    const toolMessages: Element[] = [];
    for (const el of root.querySelectorAll("tool-message")) {
      el.classList.remove("pi-group-member");
      toolMessages.push(el);
    }

    // Identify runs of 2+ consecutive same-name completed tools.
    const runs: Element[][] = [];
    let currentRun: Element[] = [];

    for (const el of toolMessages) {
      const card = el.querySelector(".pi-tool-card");
      if (!card) {
        if (currentRun.length >= 2) runs.push(currentRun);
        currentRun = [];
        continue;
      }

      const toolName = card.getAttribute("data-tool-name");
      const cardState = card.getAttribute("data-state");

      if (cardState !== "complete" || !toolName) {
        if (currentRun.length >= 2) runs.push(currentRun);
        currentRun = [];
        continue;
      }

      if (currentRun.length > 0) {
        const prev = currentRun[currentRun.length - 1];
        const prevCard = prev.querySelector(".pi-tool-card");
        const prevName = prevCard?.getAttribute("data-tool-name");

        if (prevName === toolName && areConsecutiveSiblings(prev, el)) {
          currentRun.push(el);
        } else {
          if (currentRun.length >= 2) runs.push(currentRun);
          currentRun = [el];
        }
      } else {
        currentRun.push(el);
      }
    }
    if (currentRun.length >= 2) runs.push(currentRun);

    // Wrap each run in a container element.
    for (const run of runs) {
      const leader = run[0];
      const members = run.slice(1);

      const wrapper = document.createElement("div");
      wrapper.className = "pi-tool-group";

      if (leader.parentNode) leader.parentNode.insertBefore(wrapper, leader);
      for (const el of run) wrapper.appendChild(el);

      for (const m of members) m.classList.add("pi-group-member");
    }

    // Reconnect observer after all DOM work is done.
    observer.observe(root, { childList: true, subtree: true });
  }

  /**
   * Check whether two elements are consecutive siblings (no intervening
   * element siblings — only whitespace text nodes allowed).
   */
  function areConsecutiveSiblings(a: Element, b: Element): boolean {
    let node: Node | null = a.nextSibling;
    while (node) {
      if (node === b) return true;
      if (node.nodeType === Node.TEXT_NODE) {
        node = node.nextSibling;
        continue;
      }
      if (node.nodeType === Node.ELEMENT_NODE) return false;
      node = node.nextSibling;
    }
    return false;
  }

  /* ── Observer ──────────────────────────────────────────── */

  function scheduleGrouping() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      applyGrouping();
    });
  }

  const observer = new MutationObserver(scheduleGrouping);
  observer.observe(root, { childList: true, subtree: true });

  // Initial pass.
  applyGrouping();

  /* ── Cleanup ──────────────────────────────────────────── */

  return () => {
    observer.disconnect();
    if (rafId) cancelAnimationFrame(rafId);

    unwrapAll();
    for (const el of root.querySelectorAll("tool-message")) {
      el.classList.remove("pi-group-member");
    }
  };
}
