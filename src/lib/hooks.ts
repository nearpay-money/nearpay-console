/** Data-loading hooks for pages (no caching beyond component memory: nothing reaches web storage). */
import { type DependencyList, useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly loading: boolean;
  reload(): void;
  /** Replace the data after a write (the write's response is the new state). */
  set(data: T): void;
}

export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({
    data: undefined,
    error: undefined,
    loading: true,
  });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  // biome-ignore lint/correctness/useExhaustiveDependencies: callers pass their own dependency list
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fnRef.current().then(
      (data) => live && setState({ data, error: undefined, loading: false }),
      (error: unknown) => live && setState({ data: undefined, error, loading: false }),
    );
    return () => {
      live = false;
    };
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const set = useCallback((data: T) => setState({ data, error: undefined, loading: false }), []);
  return { ...state, reload, set };
}

export interface Page<T> {
  readonly data: readonly T[];
  readonly has_more: boolean;
}

export interface PagedState<T> extends AsyncState<Page<T>> {
  readonly pageIndex: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  next(): void;
  previous(): void;
}

/**
 * Cursor paging (`starting_after`): a stack of cursors so "Previous" returns exactly to the page seen
 * before. Changing `deps` (filters) restarts at the first page.
 */
export function usePaged<T>(
  fetchPage: (startingAfter: string | undefined) => Promise<Page<T>>,
  cursorOf: (item: T) => string,
  deps: DependencyList,
): PagedState<T> {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const depsKey = JSON.stringify(deps);
  const lastKey = useRef(depsKey);
  if (lastKey.current !== depsKey) {
    lastKey.current = depsKey;
    if (cursors.length !== 1) setCursors([undefined]);
  }
  const cursor = cursors[cursors.length - 1];
  const state = useAsync(() => fetchPage(cursor), [depsKey, cursor]);
  const page = state.data;
  return {
    ...state,
    pageIndex: cursors.length - 1,
    hasPrevious: cursors.length > 1,
    hasNext: Boolean(page?.has_more && page.data.length > 0),
    next: () => {
      const last = page?.data[page.data.length - 1];
      if (page?.has_more && last) setCursors((c) => [...c, cursorOf(last)]);
    },
    previous: () => setCursors((c) => (c.length > 1 ? c.slice(0, -1) : c)),
  };
}

/** Re-renders every `ms` (relative times, countdowns). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
