import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { directoryApi } from '../services/api';
import type { PublicCategory } from '../types';

interface CategoriesSnapshot {
  categories: PublicCategory[];
  loading: boolean;
  error: unknown;
}

interface UseCategoriesOptions {
  includeEmpty?: boolean;
}

const listeners = new Set<() => void>();
let snapshot: CategoriesSnapshot = {
  categories: [],
  loading: true,
  error: null,
};
let request: Promise<void> | null = null;
let hasLoaded = false;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

function publish(nextSnapshot: CategoriesSnapshot) {
  snapshot = nextSnapshot;
  listeners.forEach((listener) => listener());
}

function loadCategories() {
  if (hasLoaded || request) return request ?? Promise.resolve();

  publish({
    ...snapshot,
    loading: true,
    error: null,
  });

  request = directoryApi.categories()
    .then((response) => {
      hasLoaded = true;
      publish({
        categories: response.data.data,
        loading: false,
        error: null,
      });
    })
    .catch((error: unknown) => {
      publish({
        ...snapshot,
        loading: false,
        error,
      });
    })
    .finally(() => {
      request = null;
    });

  return request;
}

export function useCategories({ includeEmpty = false }: UseCategoriesOptions = {}) {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!hasLoaded && !request) {
      void loadCategories();
    }
  }, []);

  const categories = useMemo(
    () => includeEmpty
      ? current.categories
      : current.categories.filter((category) => category.business_count > 0),
    [current.categories, includeEmpty],
  );

  return {
    categories,
    loading: current.loading,
    error: current.error,
    retry: loadCategories,
  };
}
