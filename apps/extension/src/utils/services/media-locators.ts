export interface MediaLocator {
  getVideo(): HTMLVideoElement | null;
  getMediaId(location: Location): string | undefined;
  getMediaTitle(doc: Document): string;
  getStructureRoot(): Node | null;
}

export interface SelectorMediaLocatorConfig {
  /** Selector for the main `<video>` element. Defaults to `video`. */
  readonly videoSelector?: string;
  /**
   * Preferred subtree root for structural observation. Use this to avoid
   * watching an entire SPA document when the player lives under a stable
   * service-specific container. Falls back to `document.body` until the root
   * exists, and rebinds automatically if the container is replaced.
   */
  readonly structureRootSelector?: string;
  /**
   * Parse the media id out of `window.location`. Returning `undefined`
   * means the current page is not a watch page.
   */
  getMediaId(location: Location): string | undefined;
  /** Human-readable title shown in the popup. Defaults to `document.title`. */
  getMediaTitle?(doc: Document): string;
}

export function createSelectorMediaLocator(
  config: SelectorMediaLocatorConfig,
): MediaLocator {
  const videoSelector = config.videoSelector ?? 'video';
  const structureRootSelector = config.structureRootSelector;

  return {
    getVideo: () => document.querySelector<HTMLVideoElement>(videoSelector),
    getMediaId: config.getMediaId,
    getMediaTitle: (doc) => config.getMediaTitle?.(doc) ?? doc.title,
    getStructureRoot: () =>
      structureRootSelector
        ? document.querySelector(structureRootSelector)
        : document.body,
  };
}
