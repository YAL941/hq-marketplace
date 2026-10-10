import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Filter, X, MapPin, Building2 } from 'lucide-react';
import { BusinessCard } from '../components/business/BusinessCard';
import { BusinessCardSkeleton } from '../components/common/Skeleton';
import { Button } from '../components/common/Button';
import { SearchBar } from '../components/common/SearchBar';
import { Badge } from '../components/common/Badge';
import { ErrorState } from '../components/common/ErrorState';
import { CategoryIcon } from '../components/common/CategoryIcon';
import { CategoryBar } from '../components/common/CategoryBar';
import { businessApi, directoryApi } from '../services/api';
import { useCategories } from '../hooks/useCategories';
import type {
  DirectorySort,
  PublicBusinessCard,
  PublicCity,
} from '../types';
import { cn } from '../lib/utils';

const PAGE_SIZE = 12;

/** Options the server actually supports. Anything else is not a sort it can do. */
const SORT_OPTIONS: Array<{ value: DirectorySort; labelKey: string }> = [
  { value: 'newest', labelKey: 'explore.sortNewest' },
  { value: 'rating', labelKey: 'explore.sortRating' },
  { value: 'featured', labelKey: 'explore.sortFeatured' },
];

export function ExplorePage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { categories } = useCategories();

  const [businesses, setBusinesses] = useState<PublicBusinessCard[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [cities, setCities] = useState<PublicCity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftQuery, setDraftQuery] = useState(searchParams.get('q') ?? '');

  // URL is the single source of truth, so a filtered view can be shared as a
  // link and the back button behaves the way people expect.
  const q = searchParams.get('q') ?? '';
  const category = searchParams.get('category') ?? '';
  const city = searchParams.get('city') ?? '';
  const featuredOnly = searchParams.get('featured') === 'true';
  const sort = (searchParams.get('sort') as DirectorySort | null) ?? 'newest';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  useEffect(() => {
    setDraftQuery(q);
  }, [q]);

  useEffect(() => {
    if (draftQuery.trim() === q) return;
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      const value = draftQuery.trim();
      if (value) params.set('q', value);
      else params.delete('q');
      params.set('page', '1');
      setSearchParams(params, { replace: true });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [draftQuery, q, searchParams, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    directoryApi.cities()
      .then((cityRes) => {
        if (cancelled) return;
        setCities(cityRes.data.data);
      })
      .catch(() => {
        // The filter lists are a convenience; if they fail the results grid is
        // still worth showing, so this is swallowed rather than surfaced.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await businessApi.listPublic({
        q: q || undefined,
        category: category || undefined,
        city: city || undefined,
        featured: featuredOnly || undefined,
        sort,
        page,
        limit: PAGE_SIZE,
      });
      setBusinesses(res.data.data);
      setTotalCount(Number(res.data.meta?.total ?? res.data.data.length));
      setTotalPages(Number(res.data.meta?.totalPages ?? 1));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [q, category, city, featuredOnly, sort, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateFilter = (key: string, value: string | boolean | null) => {
    const params = new URLSearchParams(searchParams);
    if (value === '' || value === false || value === null) params.delete(key);
    else params.set(key, String(value));
    // Any filter change invalidates the current page number.
    params.set('page', '1');
    setSearchParams(params);
  };

  const goToPage = (next: number) => {
    const params = new URLSearchParams(searchParams);
    params.set('page', String(Math.max(1, Math.min(next, totalPages))));
    setSearchParams(params);
  };

  const activeCategory = categories.find((c) => c.category_slug === category);
  const activeFilterCount = [q, category, city, featuredOnly].filter(Boolean).length;
  const hasActiveFilters = activeFilterCount > 0;

  return (
    <div className="min-h-screen bg-navy-50">
      <div className="bg-white border-b border-navy-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-navy-900">{t('explore.title')}</h1>
              <p className="text-navy-500 mt-1">
                {loading
                  ? t('common.loading')
                  : `${t('explore.results', { count: totalCount })}${q ? ` · "${q}"` : ''}`}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <SearchBar
                value={draftQuery}
                onChange={setDraftQuery}
                onSearch={(v) => updateFilter('q', v)}
                placeholder={t('explore.searchPlaceholder')}
                className="flex-1"
              />
              <button
                onClick={() => setFiltersOpen((v) => !v)}
                aria-expanded={filtersOpen}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-button border transition-colors',
                  hasActiveFilters
                    ? 'bg-primary-50 border-primary-200 text-primary-700'
                    : 'bg-white border-navy-300 text-navy-700 hover:bg-navy-50'
                )}
              >
                <Filter className="w-4 h-4" />
                <span>{t('explore.filters')}</span>
                {activeFilterCount > 0 && (
                  <Badge variant="info" size="sm">{activeFilterCount}</Badge>
                )}
              </button>
              <Button onClick={() => setSearchParams({})} variant="ghost" disabled={!hasActiveFilters}>
                {t('explore.clearFilters')}
              </Button>
            </div>
          </div>

          {hasActiveFilters && (
            <div className="mt-4 flex flex-wrap gap-2">
              {q && (
                <Badge variant="info" onRemove={() => updateFilter('q', null)}>
                  {t('search.label')}: {q}
                </Badge>
              )}
              {activeCategory && (
                <Badge variant="info" onRemove={() => updateFilter('category', null)}>
                  {activeCategory.category_name}
                </Badge>
              )}
              {city && (
                <Badge variant="info" onRemove={() => updateFilter('city', null)}>
                  <MapPin className="w-3 h-3 me-1" /> {city}
                </Badge>
              )}
              {featuredOnly && (
                <Badge variant="success" onRemove={() => updateFilter('featured', false)}>
                  {t('business.featured')}
                </Badge>
              )}
            </div>
          )}
          <div className="mt-5">
            <CategoryBar selected={category || null} variant="light" />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex gap-8">
          <aside className={cn('w-full lg:w-64 flex-shrink-0', filtersOpen ? 'block' : 'hidden lg:block')}>
            <div className="bg-white rounded-card border border-navy-200 p-4 sticky top-24">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-navy-900">{t('explore.filters')}</h3>
                <button
                  onClick={() => setFiltersOpen(false)}
                  className="lg:hidden text-navy-500 hover:text-navy-700"
                  aria-label={t('common.close')}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  {/* A native <select> cannot hold an icon, so the mark sits
                      beside the label and shows the selected category. */}
                  <div className="flex items-center gap-2 mb-2">
                    {category && (
                      <CategoryIcon slug={category} size="card" className="!w-8 !h-8" />
                    )}
                    <label htmlFor="filter-category" className="block text-sm font-medium text-navy-700">
                      {t('explore.category')}
                    </label>
                  </div>
                  <select
                    id="filter-category"
                    value={category}
                    onChange={(e) => updateFilter('category', e.target.value || null)}
                    className="w-full px-3 py-2 border border-navy-300 rounded-button text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">{t('explore.allCategories')}</option>
                    {categories.map((c) => (
                      <option key={c.category_id} value={c.category_slug}>
                        {c.category_name} ({c.business_count})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="filter-city" className="block text-sm font-medium text-navy-700 mb-2">
                    {t('explore.city')}
                  </label>
                  <select
                    id="filter-city"
                    value={city}
                    onChange={(e) => updateFilter('city', e.target.value || null)}
                    className="w-full px-3 py-2 border border-navy-300 rounded-button text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">{t('explore.allCities')}</option>
                    {cities.map((c) => (
                      <option key={c.city} value={c.city}>
                        {c.city} ({c.business_count})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="filter-featured" className="flex items-center gap-2 cursor-pointer">
                    <input
                      id="filter-featured"
                      type="checkbox"
                      checked={featuredOnly}
                      onChange={(e) => updateFilter('featured', e.target.checked)}
                      className="w-4 h-4 text-primary-600 border-navy-300 rounded focus:ring-primary-500"
                    />
                    <span className="text-sm text-navy-700">{t('business.sections.featured')}</span>
                  </label>
                </div>
              </div>
            </div>
          </aside>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-4">
              <label htmlFor="sort" className="text-sm text-navy-500">{t('explore.sort')}:</label>
              <select
                id="sort"
                value={sort}
                onChange={(e) => updateFilter('sort', e.target.value)}
                className="px-3 py-1.5 border border-navy-300 rounded-button text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
            </div>

            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {[...Array(6)].map((_, i) => <BusinessCardSkeleton key={i} />)}
              </div>
            ) : error ? (
              <ErrorState onRetry={() => void load()} />
            ) : businesses.length > 0 ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {businesses.map((business) => (
                    <BusinessCard key={business.business_id} business={business} />
                  ))}
                </div>

                {totalPages > 1 && (
                  <nav
                    className="mt-8 flex items-center justify-center gap-2"
                    aria-label={t('common.pagination')}
                  >
                    <Button
                      onClick={() => goToPage(page - 1)}
                      variant="outline"
                      disabled={page === 1}
                    >
                      {t('common.previous')}
                    </Button>
                    <span className="px-4 text-sm text-navy-600">
                      {t('common.pageOf', { page, totalPages })}
                    </span>
                    <Button
                      onClick={() => goToPage(page + 1)}
                      variant="outline"
                      disabled={page >= totalPages}
                    >
                      {t('common.next')}
                    </Button>
                  </nav>
                )}
              </>
            ) : (
              <div className="text-center py-16">
                <Building2 className="w-16 h-16 text-navy-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-navy-900 mb-2">
                  {t('explore.emptyTitle')}
                </h3>
                <p className="text-navy-500 mb-6">{t('explore.emptyDescription')}</p>
                <Button onClick={() => setSearchParams({})} variant="outline">
                  {t('explore.clearFilters')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
