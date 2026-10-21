"use client";

import { useCallback, useEffect, useState, type DependencyList } from "react";

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
  /** Replaces the data without a request, e.g. with what a mutation returned. */
  set: (data: T) => void;
}

interface Loaded<T> {
  /** Which request this answers: the deps, plus how many reloads. */
  key: string | null;
  deps: string | null;
  data?: T;
  error: unknown;
}

/**
 * Loads data for a screen and tracks its loading and error states. While a
 * reload runs the previous data stays on screen; when the deps change (another
 * pool, say) it doesn't.
 */
export function useResource<T>(load: () => Promise<T>, deps: DependencyList): Resource<T> {
  const [version, setVersion] = useState(0);
  const depsKey = JSON.stringify(deps);
  const key = `${depsKey}#${version}`;
  const [state, setState] = useState<Loaded<T>>({ key: null, deps: null, error: null });

  useEffect(() => {
    let alive = true;
    load().then(
      (data) => alive && setState({ key, deps: depsKey, data, error: null }),
      (error: unknown) => alive && setState((s) => ({ key, deps: depsKey, data: s.deps === depsKey ? s.data : undefined, error })),
    );
    return () => {
      alive = false;
    };
    // `load` is a new function every render; the request only depends on `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const set = useCallback((data: T) => setState({ key, deps: depsKey, data, error: null }), [key, depsKey]);
  const loading = state.key !== key;
  return {
    data: state.deps === depsKey ? state.data : undefined,
    error: loading ? null : state.error,
    loading,
    reload,
    set,
  };
}

/** Runs a mutation and tracks whether it's in flight and how it failed. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(
    async (...args: A): Promise<{ ok: true; value: R } | { ok: false; error: unknown }> => {
      setBusy(true);
      setError(null);
      try {
        return { ok: true, value: await fn(...args) };
      } catch (e) {
        setError(e);
        return { ok: false, error: e };
      } finally {
        setBusy(false);
      }
    },
    [fn],
  );
  return { run, busy, error, clearError: () => setError(null) };
}

/** Re-renders every `ms` so countdowns stay live. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
