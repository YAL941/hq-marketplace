import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CategoryIcon } from './CategoryIcon';
import { useCategories } from '../../hooks/useCategories';
import { cn } from '../../lib/utils';

interface CategoryBarProps {
  selected: string | null;
  onSelect?: (categorySlug: string | null) => void;
  variant?: 'light' | 'onDark';
  showCounts?: boolean;
}

interface ScrollEdges {
  start: boolean;
  end: boolean;
}

export function CategoryBar({
  selected,
  onSelect,
  variant = 'light',
  showCounts = false,
}: CategoryBarProps) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { categories: allCategories, loading, error, retry } = useCategories({ includeEmpty: true });
  const categories = useMemo(
    () => allCategories.filter((category) =>
      category.business_count > 0 || category.category_slug === selected),
    [allCategories, selected],
  );
  const listRef = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false });
  const isOnDark = variant === 'onDark';

  const updateEdges = useCallback(() => {
    const list = listRef.current;
    if (!list) return;

    const items = list.querySelectorAll<HTMLElement>('[data-category-item]');
    const first = items.item(0);
    const last = items.item(items.length - 1);
    if (!first || !last) {
      setEdges({ start: false, end: false });
      return;
    }

    const bounds = list.getBoundingClientRect();
    const firstBounds = first.getBoundingClientRect();
    const lastBounds = last.getBoundingClientRect();
    const isRtl = getComputedStyle(list).direction === 'rtl';

    setEdges(isRtl
      ? {
          start: firstBounds.right > bounds.right + 1,
          end: lastBounds.left < bounds.left - 1,
        }
      : {
          start: firstBounds.left < bounds.left - 1,
          end: lastBounds.right > bounds.right + 1,
        });
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    updateEdges();
    list.addEventListener('scroll', updateEdges, { passive: true });
    window.addEventListener('resize', updateEdges);
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateEdges);
    observer?.observe(list);

    return () => {
      list.removeEventListener('scroll', updateEdges);
      window.removeEventListener('resize', updateEdges);
      observer?.disconnect();
    };
  }, [categories.length, loading, updateEdges]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const targetSlug = selected ?? '';
    const target = Array.from(list.querySelectorAll<HTMLElement>('[data-category-item]'))
      .find((item) => item.dataset.categorySlug === targetSlug);
    if (!target) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [selected, categories.length]);

  const scrollToAdjacentItem = (direction: 'previous' | 'next') => {
    const list = listRef.current;
    if (!list) return;

    const items = Array.from(list.querySelectorAll<HTMLElement>('[data-category-item]'));
    const bounds = list.getBoundingClientRect();
    const visibleIndexes = items.flatMap((item, index) => {
      const itemBounds = item.getBoundingClientRect();
      return itemBounds.right > bounds.left && itemBounds.left < bounds.right ? [index] : [];
    });
    if (visibleIndexes.length === 0) return;

    const targetIndex = direction === 'next'
      ? Math.min(visibleIndexes[visibleIndexes.length - 1] + 1, items.length - 1)
      : Math.max(visibleIndexes[0] - 1, 0);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    items[targetIndex].scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  };

  if (error) {
    return (
      <div className="py-2 text-start">
        <button
          type="button"
          onClick={() => void retry()}
          className={cn(
            'text-sm underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
            isOnDark ? 'text-white' : 'text-primary-700',
          )}
        >
          {t('categoryBar.retry')}
        </button>
      </div>
    );
  }

  if (!loading && categories.length === 0) return null;

  const allCategoriesHref = () => {
    const params = new URLSearchParams(location.search);
    params.delete('category');
    params.set('page', '1');
    const query = params.toString();
    return `/explore${query ? `?${query}` : ''}`;
  };

  const categoryHref = (slug: string) => {
    const params = new URLSearchParams(location.search);
    params.set('category', slug);
    params.set('page', '1');
    return `/explore?${params.toString()}`;
  };

  const sharedItemClass = cn(
    'category-bar-item group flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-full border px-3 py-2 text-sm transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 motion-reduce:transform-none motion-reduce:transition-none',
    '[@media(hover:hover)]:hover:shadow-md [@media(hover:hover)]:hover:border-primary-400',
    isOnDark
      ? 'border-white/20 bg-white/10 text-white [@media(hover:hover)]:hover:bg-white/15'
      : 'border-[#D9E6F4] bg-white text-navy-800 [@media(hover:hover)]:hover:bg-primary-50',
  );
  const selectedItemClass = isOnDark
    ? 'border-gold-400 bg-white/20 font-semibold'
    : 'border-primary-600 bg-primary-50 font-semibold text-primary-800';

  const startFade = isOnDark ? 'rgba(11,42,74,0.9)' : '#f6f9fc';
  const isRtl = i18n.dir() === 'rtl';
  const fadeStyles = {
    start: {
      background: `linear-gradient(to ${isRtl ? 'left' : 'right'}, ${startFade}, transparent)`,
    },
    end: {
      background: `linear-gradient(to ${isRtl ? 'right' : 'left'}, ${startFade}, transparent)`,
    },
  };

  return (
    <div className="relative flex min-w-0 items-center gap-2">
      {edges.start && (
        <button
          type="button"
          onClick={() => scrollToAdjacentItem('previous')}
          aria-label={t('categoryBar.previous')}
          className="category-bar-arrow h-10 w-10 shrink-0 items-center justify-center rounded-full border border-navy-200 bg-white text-navy-700 shadow-sm hover:border-primary-400 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 motion-reduce:transition-none"
        >
          <ChevronLeft aria-hidden="true" className="h-5 w-5 rtl:rotate-180" />
        </button>
      )}

      <div className="relative min-w-0 flex-1">
        {edges.start && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 start-0 z-[1] w-6"
            style={fadeStyles.start}
          />
        )}
        {loading ? (
          <div className="flex gap-2 overflow-hidden px-1 py-2" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => (
              <span
                key={index}
                className={cn(
                  'h-11 w-28 shrink-0 animate-pulse rounded-full',
                  isOnDark ? 'bg-white/15' : 'bg-navy-100',
                )}
              />
            ))}
          </div>
        ) : (
          <ul
            ref={listRef}
            role="list"
            className="flex w-full flex-nowrap gap-2 overflow-x-auto overscroll-x-contain scroll-smooth snap-x snap-proximity px-1 py-2 touch-pan-x scrollbar-hide motion-reduce:scroll-auto"
          >
            <li data-category-item data-category-slug="" className="snap-start">
              <Link
                to={allCategoriesHref()}
                onClick={() => onSelect?.(null)}
                aria-current={selected === null ? 'page' : undefined}
                className={cn(sharedItemClass, selected === null && selectedItemClass)}
              >
                <CategoryIcon
                  slug={null}
                  size={isOnDark ? 'chip' : 'inline'}
                  className="category-bar-icon transition-transform duration-150 motion-reduce:transition-none"
                />
                <span>{t('categoryBar.all')}</span>
              </Link>
            </li>
            {categories.map((category) => (
              <li
                key={category.category_id}
                data-category-item
                data-category-slug={category.category_slug}
                className="snap-start"
              >
                <Link
                  to={categoryHref(category.category_slug)}
                  onClick={() => onSelect?.(category.category_slug)}
                  aria-current={selected === category.category_slug ? 'page' : undefined}
                  className={cn(
                    sharedItemClass,
                    selected === category.category_slug && selectedItemClass,
                  )}
                >
                  <CategoryIcon
                    slug={category.category_slug}
                    size={isOnDark ? 'chip' : 'inline'}
                    className="category-bar-icon transition-transform duration-150 motion-reduce:transition-none"
                  />
                  <span>{category.category_name}</span>
                  {showCounts && <span className="text-xs opacity-75">{category.business_count}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {edges.end && !loading && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 end-0 z-[1] w-6"
            style={fadeStyles.end}
          />
        )}
      </div>

      {edges.end && (
        <button
          type="button"
          onClick={() => scrollToAdjacentItem('next')}
          aria-label={t('categoryBar.next')}
          className="category-bar-arrow h-10 w-10 shrink-0 items-center justify-center rounded-full border border-navy-200 bg-white text-navy-700 shadow-sm hover:border-primary-400 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 motion-reduce:transition-none"
        >
          <ChevronLeft aria-hidden="true" className="h-5 w-5 rotate-180 rtl:rotate-0" />
        </button>
      )}
    </div>
  );
}
