'use client';

import { useCallback, useEffect, useState } from 'react';

/** Small persisted state helper (per-viewer UI prefs only). Safe when storage is unavailable. */
export function useLocalStorage<T>(key: string | undefined, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    if (!key) return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      /* ignore */
    }
  }, [key]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        if (key) {
          try {
            window.localStorage.setItem(key, JSON.stringify(resolved));
          } catch {
            /* ignore */
          }
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, update];
}
