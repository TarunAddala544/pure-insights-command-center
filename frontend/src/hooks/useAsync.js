import { useCallback, useEffect, useState } from 'react';

/** Loads data and exposes {data, error, loading, reload} so every page handles all three states. */
export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    loader()
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => setState({ data: null, error, loading: false }));
  }, deps);
  useEffect(run, [run]);
  return { ...state, reload: run };
}
