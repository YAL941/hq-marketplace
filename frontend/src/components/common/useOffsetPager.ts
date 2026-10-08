import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Offset pagination for the owner screens.
 *
 * These endpoints return `meta.count`, which is the number of rows in the page
 * that arrived, and nothing else. There is no total and no page count, so this
 * pager deliberately does not try to render "page 2 of 7" or "124 results": a
 * pager that guesses a total is a pager that lies to the person using it.
 *
 * Instead `hasNext` is inferred from a full page coming back. When the server
 * returns exactly `pageSize` rows there may be more; when it returns fewer there
 * provably are not.
 */
export interface OffsetPager {
  offset: number;
  setOffset: (next: number) => void;
  /** Whether another page could exist, decided by the caller from the page size. */
  hasNext: boolean;
  hasPrevious: boolean;
  next: () => void;
  previous: () => void;
  /** "Showing 21–40", or a translated equivalent, for the page on screen. */
  rangeLabel: (returned: number) => string;
  /** Back to the first page. Called whenever a filter changes. */
  reset: () => void;
}

/**
 * The pager holds no filter state of its own. A filter change
 * has to start again at the first page, and that is the
 * caller's job: it calls `reset()` in the same handler that
 * sets the filter, which is why the hook takes nothing but
 * the page size.
 */
export function useOffsetPager(pageSize: number): OffsetPager {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);

  return useMemo(
    () => ({
      offset,
      setOffset,
      // These endpoints report no total, so "is there a next page" is a
      // question only the loaded page can answer. The view fills it in.
      hasNext: false,
      hasPrevious: offset > 0,
      next: () => setOffset((current) => current + pageSize),
      previous: () => setOffset((current) => Math.max(0, current - pageSize)),
      reset: () => setOffset(0),
      rangeLabel: (returned: number) => {
        if (returned === 0) return t('common.noResultsRange');
        return t('common.showingRange', { from: offset + 1, to: offset + returned });
      },
    }),
    [offset, pageSize, t],
  );
}
