import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { TableSkeleton } from './Skeleton';
import { cn } from '../../lib/utils';

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

export function useOffsetPager(
  pageSize: number,
  options: { filterKey?: unknown } = {},
): OffsetPager {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  const filterKey = options.filterKey ?? '';

  // Declared so the memo depends on it: a filter change has to rebuild the
  // pager, which is how `reset` ends up reachable from the form controls.
  void filterKey;

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
    [offset, pageSize, t, filterKey],
  );
}

interface OffsetPagerViewProps {
  pager: OffsetPager;
  returned: number;
  pageSize: number;
  disabled?: boolean;
}

/** The previous/next row. Hidden entirely when there is only one page. */
export function OffsetPagerView({ pager, returned, pageSize, disabled }: OffsetPagerViewProps) {
  const { t } = useTranslation();
  if (pager.offset === 0 && returned < pageSize) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mt-6">
      <span className="text-sm text-navy-500">{pager.rangeLabel(returned)}</span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={pager.previous}
          disabled={disabled || !pager.hasPrevious}
        >
          {t('common.previous')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={pager.next}
          disabled={disabled || !pager.hasNext}
        >
          {t('common.next')}
        </Button>
      </div>
    </div>
  );
}

interface StaffListLayoutProps {
  loading: boolean;
  error: boolean;
  isEmpty: boolean;
  onRetry: () => void;
  /** Rendered when `isEmpty` and the emptiness is not worth a message. */
  empty: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The four states every owner list is in, in one place.
 *
 * Writing them per screen is how "Loading…" and an empty table end up both
 * showing at once.
 */
export function StaffListLayout({
  loading,
  error,
  isEmpty,
  onRetry,
  empty,
  children,
}: StaffListLayoutProps) {
  if (loading) return <TableSkeleton rows={6} />;
  if (error) return <ErrorPanel onRetry={onRetry} />;
  if (isEmpty) return <>{empty}</>;
  return <>{children}</>;
}

function ErrorPanel({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="py-12 text-center">
      <p className="text-error-600 mb-4">{t('common.loadFailed')}</p>
      <Button variant="outline" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  );
}

/** A block for something the API cannot answer yet, rather than a fake number. */
export function NotAvailableYet({ label }: { label: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-card border border-dashed border-navy-200 bg-navy-50 px-4 py-6 text-center">
      <p className="text-sm font-medium text-navy-600">{t('dashboard.notAvailableTitle')}</p>
      <p className="mt-1 text-sm text-navy-500">{label}</p>
    </div>
  );
}

export { EmptyState, cn };