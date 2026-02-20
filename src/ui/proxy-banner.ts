/**
 * Proxy banner retired in managed backend mode.
 */

export type ProxyBannerState = "detected" | "not-detected" | "unknown";

export interface ProxyBannerHandle {
  root: HTMLElement;
  update: (state: ProxyBannerState) => void;
}

export function createProxyBanner(): ProxyBannerHandle {
  const root = document.createElement("section");
  root.hidden = true;

  return {
    root,
    update: () => {
      root.hidden = true;
    },
  };
}
