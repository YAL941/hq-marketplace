import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, RotateCcw, Search, SlidersHorizontal, Star, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

export interface SortOption {
  value: string;
  label: string;
}

/** The shape every consumer of the panel works with. */
export interface SearchFilters {
  query: string;
  /** Category slugs, multi-select. */
  categories: string[];
  /** Minimum rating, single-select. Null means "any". */
  minRating: number | null;
  /** Service types, multi-select. */
  serviceTypes: string[];
}

export interface SortControl {
  value: string;
  options: SortOption[];
  onChange: (value: string) => void;
}

interface ActiveChip {
  key: string;
  label: string;
  onRemove: () => void;
}

export interface AdvancedSearchProps {
  categories?: FilterOption[];
  serviceTypes?: FilterOption[];
  /** Controlled value. Omit to let the panel own its state. */
  value?: SearchFilters;
  defaultValue?: SearchFilters;
  onChange?: (filters: SearchFilters) => void;
  /** Fired after the reset button empties every filter. */
  onReset?: () => void;
  resultCount?: number;
  loading?: boolean;
  sort?: SortControl;
  children?: ReactNode;
  className?: string;
  /** Categories shown before the list collapses behind a "show more" toggle. */
  categoryPreviewCount?: number;
}

const EMPTY_FILTERS: SearchFilters = {
  query: '',
  categories: [],
  minRating: null,
  serviceTypes: [],
};

/** Highest first: a "4 and up" row is the one people actually reach for. */
const RATING_OPTIONS = [4, 3, 2, 1];

const QUERY_DEBOUNCE_MS = 350;

/**
 * Search box and filter panel for the directory.
 *
 * The panel keeps its own draft state so a half-built selection never leaks
 * into the results list: the query is debounced and the count chips read from
 * the same state the checkboxes write to, so what the panel shows and what the
 * parent receives cannot drift apart. Pass `value` to make it controlled and
 * drive it from the URL instead.
 */
export function AdvancedSearch({
  categories = [],
  serviceTypes = [],
  value,
  defaultValue,
  onChange,
  onReset,
  resultCount,
  loading = false,
  sort,
  children,
  className,
  categoryPreviewCount = 6,
}: AdvancedSearchProps) {
  const { t } = useTranslation();

  const initialFilters = value ?? defaultValue ?? EMPTY_FILTERS;
  const [filters, setFilters] = useState<SearchFilters>(initialFilters);
  const [draftQuery, setDraftQuery] = useState(initialFilters.query);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const filterToggleRef = useRef<HTMLButtonElement>(null);

  const searchId = useId();
  const panelId = useId();
  const sortId = useId();

  useEffect(() => {
    if (!panelOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPanelOpen(false);
        filterToggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [panelOpen]);

  // The latest `onChange` and whether the incoming change came from the parent,
  // so a controlled sync never echoes straight back as a user edit.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const externalUpdate = useRef(false);

  useEffect(() => {
    if (!value) return;
    externalUpdate.current = true;
    setFilters(value);
    setDraftQuery(value.query);
  }, [value]);

  // Debounced: typing five letters fires one query, not five network calls.
  useEffect(() => {
    if (draftQuery.trim() === filters.query) return;
    const timer = window.setTimeout(() => {
      setFilters((prev) => ({ ...prev, query: draftQuery.trim() }));
    }, QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draftQuery, filters.query]);

  useEffect(() => {
    if (externalUpdate.current) {
      externalUpdate.current = false;
      return;
    }
    onChangeRef.current?.(filters);
  }, [filters]);

  const commit = (next: SearchFilters) => setFilters(next);

  const toggleInList = (list: string[], entry: string) =>
    list.includes(entry) ? list.filter((item) => item !== entry) : [...list, entry];

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setFilters((prev) => ({ ...prev, query: draftQuery.trim() }));
  };

  const handleClearQuery = () => {
    setDraftQuery('');
    setFilters((prev) => (prev.query === '' ? prev : { ...prev, query: '' }));
  };

  const handleReset = () => {
    setDraftQuery('');
    commit(EMPTY_FILTERS);
    onReset?.();
  };

  const visibleCategories = showAllCategories
    ? categories
    : categories.slice(0, categoryPreviewCount);
  const hasHiddenCategories = categories.length > categoryPreviewCount;

  const activeCount =
    (filters.query.trim() ? 1 : 0) +
    filters.categories.length +
    (filters.minRating ? 1 : 0) +
    filters.serviceTypes.length;
  const hasActiveFilters = activeCount > 0;

  const activeChips: ActiveChip[] = [];
  if (filters.query.trim()) {
    activeChips.push({
      key: 'query',
      label: filters.query.trim(),
      onRemove: () => {
        setDraftQuery('');
        setFilters((prev) => ({ ...prev, query: '' }));
      },
    });
  }
  filters.categories.forEach((slug) => {
    const category = categories.find((item) => item.value === slug);
    activeChips.push({
      key: `category-${slug}`,
      label: category?.label ?? slug,
      onRemove: () =>
        setFilters((prev) => ({
          ...prev,
          categories: prev.categories.filter((item) => item !== slug),
        })),
    });
  });
  if (filters.minRating) {
    activeChips.push({
      key: 'rating',
      label: t('advancedSearch.ratingValue', { count: filters.minRating }),
      onRemove: () => setFilters((prev) => ({ ...prev, minRating: null })),
    });
  }
  filters.serviceTypes.forEach((type) => {
    const option = serviceTypes.find((item) => item.value === type);
    activeChips.push({
      key: `service-${type}`,
      label: option?.label ?? type,
      onRemove: () =>
        setFilters((prev) => ({
          ...prev,
          serviceTypes: prev.serviceTypes.filter((item) => item !== type),
        })),
    });
  });

  return (
    <section className={cn('w-full', className)} aria-labelledby={`${searchId}-title`}>
      <h2 id={`${searchId}-title`} className="sr-only">
        {t('advancedSearch.title')}
      </h2>

      <form role="search" onSubmit={handleSubmit}>
        <div className="relative">
          <Search
            className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-navy-400"
            aria-hidden="true"
          />
          <input
            id={searchId}
            type="search"
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder={t('advancedSearch.searchPlaceholder')}
            aria-label={t('search.label')}
            autoComplete="off"
            className="w-full rounded-full border border-navy-300 bg-white py-3 ps-12 pe-28 text-navy-900 shadow-sm transition-all duration-200 placeholder:text-navy-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <div className="absolute end-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {draftQuery && (
              <button
                type="button"
                onClick={handleClearQuery}
                aria-label={t('search.clear')}
                className="rounded-full p-2 text-navy-400 transition-colors hover:bg-navy-100 hover:text-navy-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            <button
              type="submit"
              className="rounded-full bg-primary-600 px-5 py-2 text-sm font-medium text-white shadow-soft transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
            >
              {t('home.heroSearchCta')}
            </button>
          </div>
        </div>
      </form>

      <div className="mt-3 flex items-center justify-between gap-3 lg:hidden">
        <button
          ref={filterToggleRef}
          type="button"
          onClick={() => setPanelOpen((open) => !open)}
          aria-expanded={panelOpen}
          aria-controls={panelId}
          className={cn(
            'inline-flex items-center gap-2 rounded-button border px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500',
            hasActiveFilters
              ? 'border-primary-200 bg-primary-50 text-primary-700'
              : 'border-navy-300 bg-white text-navy-700 hover:bg-navy-50'
          )}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          <span>{t('advancedSearch.filters')}</span>
          {activeCount > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-600 px-1.5 text-xs font-semibold text-white">
              {activeCount}
            </span>
          )}
        </button>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleReset}
            className="text-sm text-navy-500 underline underline-offset-2 transition-colors hover:text-navy-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {t('advancedSearch.clearFilters')}
          </button>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-6 lg:mt-6 lg:flex-row lg:gap-8">
        {panelOpen && (
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={() => {
              setPanelOpen(false);
              filterToggleRef.current?.focus();
            }}
            className="fixed inset-0 z-[69] bg-navy-950/50 lg:hidden"
          />
        )}
        <aside
          id={panelId}
          className={cn(
            'w-full lg:block lg:w-72 lg:shrink-0',
            panelOpen
              ? 'fixed inset-x-0 bottom-0 z-[70] max-h-[85dvh] overflow-y-auto rounded-t-3xl border border-navy-200 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl animate-slide-up lg:static lg:max-h-none lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none'
              : 'hidden lg:block',
          )}
          aria-label={t('advancedSearch.filters')}
        >
          <div className="rounded-card border border-navy-200 bg-white p-4 shadow-card lg:sticky lg:top-24">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-semibold text-navy-900">
                <SlidersHorizontal className="h-4 w-4 text-primary-600" aria-hidden="true" />
                {t('advancedSearch.filters')}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setPanelOpen(false);
                  filterToggleRef.current?.focus();
                }}
                aria-label={t('common.close')}
                className="rounded-full p-1 text-navy-500 transition-colors hover:bg-navy-100 hover:text-navy-700 focus:outline-none focus:ring-2 focus:ring-primary-500 lg:hidden"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-5">
              {/* Categories ---------------------------------------------------- */}
              {categories.length > 0 && (
                <FilterGroup label={t('advancedSearch.category')}>
                  <fieldset className="space-y-0.5">
                    <legend className="sr-only">{t('advancedSearch.category')}</legend>
                    {visibleCategories.map((category) => (
                      <label
                        key={category.value}
                        className="flex cursor-pointer items-center gap-2.5 rounded-button px-2 py-1.5 text-sm text-navy-700 transition-colors hover:bg-navy-50"
                      >
                        <input
                          type="checkbox"
                          checked={filters.categories.includes(category.value)}
                          onChange={() =>
                            setFilters((prev) => ({
                              ...prev,
                              categories: toggleInList(prev.categories, category.value),
                            }))
                          }
                          className="h-4 w-4 shrink-0 rounded border-navy-300 text-primary-600 focus:ring-primary-500"
                        />
                        <span className="min-w-0 flex-1 truncate">{category.label}</span>
                        {category.count !== undefined && (
                          <span className="shrink-0 text-xs text-navy-400">{category.count}</span>
                        )}
                      </label>
                    ))}
                  </fieldset>
                  {hasHiddenCategories && (
                    <button
                      type="button"
                      onClick={() => setShowAllCategories((open) => !open)}
                      aria-expanded={showAllCategories}
                      className="mt-2 text-xs font-medium text-primary-700 underline underline-offset-2 transition-colors hover:text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      {t(showAllCategories ? 'advancedSearch.lessFilters' : 'advancedSearch.moreFilters')}
                    </button>
                  )}
                </FilterGroup>
              )}

              {/* Ratings ------------------------------------------------------- */}
              <FilterGroup label={t('advancedSearch.rating')}>
                <fieldset className="space-y-0.5">
                  <legend className="sr-only">{t('advancedSearch.rating')}</legend>
                  {RATING_OPTIONS.map((rating) => (
                    <label
                      key={rating}
                      className="flex cursor-pointer items-center gap-2.5 rounded-button px-2 py-1.5 text-sm text-navy-700 transition-colors hover:bg-navy-50"
                    >
                      <input
                        type="radio"
                        name={`${searchId}-rating`}
                        checked={filters.minRating === rating}
                        onChange={() => setFilters((prev) => ({ ...prev, minRating: rating }))}
                        className="h-4 w-4 shrink-0 border-navy-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="flex items-center gap-1.5">
                        <Stars value={rating} />
                        <span>{t('advancedSearch.ratingAndUp', { count: rating })}</span>
                      </span>
                    </label>
                  ))}
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-button px-2 py-1.5 text-sm text-navy-700 transition-colors hover:bg-navy-50">
                    <input
                      type="radio"
                      name={`${searchId}-rating`}
                      checked={filters.minRating === null}
                      onChange={() => setFilters((prev) => ({ ...prev, minRating: null }))}
                      className="h-4 w-4 shrink-0 border-navy-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span>{t('advancedSearch.anyRating')}</span>
                  </label>
                </fieldset>
              </FilterGroup>

              {/* Service types --------------------------------------------------- */}
              {serviceTypes.length > 0 && (
                <FilterGroup label={t('advancedSearch.serviceType')}>
                  <fieldset className="flex flex-wrap gap-2">
                    <legend className="sr-only">{t('advancedSearch.serviceType')}</legend>
                    {serviceTypes.map((type) => {
                      const checked = filters.serviceTypes.includes(type.value);
                      return (
                        <label
                          key={type.value}
                          className={cn(
                            'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                            checked
                              ? 'border-primary-600 bg-primary-50 text-primary-800'
                              : 'border-navy-300 bg-white text-navy-700 hover:border-primary-400 hover:bg-primary-50'
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setFilters((prev) => ({
                                ...prev,
                                serviceTypes: toggleInList(prev.serviceTypes, type.value),
                              }))
                            }
                            className="sr-only"
                          />
                          {checked && <Check className="h-3 w-3" aria-hidden="true" />}
                          <span>{type.label}</span>
                          {type.count !== undefined && (
                            <span className="text-navy-400">{type.count}</span>
                          )}
                        </label>
                      );
                    })}
                  </fieldset>
                </FilterGroup>
              )}
            </div>

            <div className="mt-5 border-t border-navy-200 pt-4">
              <button
                type="button"
                onClick={handleReset}
                disabled={!hasActiveFilters}
                className="inline-flex w-full items-center justify-center gap-2 rounded-button border border-navy-300 px-4 py-2 text-sm font-medium text-navy-700 transition-colors hover:bg-navy-50 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                {t('advancedSearch.resetFilters')}
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setPanelOpen(false);
                filterToggleRef.current?.focus();
              }}
              className="mt-3 flex min-h-11 w-full items-center justify-center rounded-button bg-primary-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 lg:hidden"
            >
              {t('advancedSearch.showResults')}
              {resultCount !== undefined && (
                <span className="ms-1">({resultCount})</span>
              )}
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-navy-500" aria-live="polite">
              {loading
                ? t('common.loading')
                : resultCount !== undefined && t('advancedSearch.resultsCount', { count: resultCount })}
            </p>
            {sort && (
              <div className="flex items-center gap-2">
                <label htmlFor={sortId} className="text-sm text-navy-500">
                  {t('advancedSearch.sortBy')}
                </label>
                <select
                  id={sortId}
                  value={sort.value}
                  onChange={(event) => sort.onChange(event.target.value)}
                  className="rounded-button border border-navy-300 bg-white px-3 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  {sort.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {activeChips.length > 0 && (
            <ul className="mb-4 flex flex-wrap gap-2">
              {activeChips.map((chip) => (
                <li key={chip.key}>
                  <button
                    type="button"
                    onClick={chip.onRemove}
                    className="inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700 transition-colors hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <span className="max-w-40 truncate">{chip.label}</span>
                    <X className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="sr-only">
                      {t('advancedSearch.removeFilter', { name: chip.label })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {children}
        </div>
      </div>
    </section>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-500">{label}</h4>
      {children}
    </div>
  );
}

/** Decorative: the row's text label already states the rating. */
function Stars({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-hidden="true">
      {Array.from({ length: max }, (_, index) => (
        <Star
          key={index}
          className={cn(
            'h-3.5 w-3.5',
            index < value ? 'fill-gold-400 text-gold-500' : 'fill-none text-navy-300'
          )}
          strokeWidth={1.75}
        />
      ))}
    </span>
  );
}

export default AdvancedSearch;
