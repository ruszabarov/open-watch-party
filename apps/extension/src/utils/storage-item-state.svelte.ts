import { onMount } from 'svelte';

// Minimal structural view of a WXT storage item: the popup only ever reads.
type ReadableStorageItem<T> = {
  getValue(): Promise<T>;
  watch(callback: (value: T) => void): () => void;
};

export function useStorageItem<T>(item: ReadableStorageItem<T>, fallback: T) {
  let current = $state(fallback);

  onMount(() => {
    let mounted = true;
    let watched = false;

    // Subscribe before the initial read. If a change lands while the read is
    // in flight, the watched value wins instead of being overwritten by it.
    const unwatch = item.watch((value) => {
      watched = true;
      current = value;
    });

    void item
      .getValue()
      .then((value) => {
        if (mounted && !watched) current = value;
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
      unwatch();
    };
  });

  return {
    get current(): T {
      return current;
    },
  };
}
