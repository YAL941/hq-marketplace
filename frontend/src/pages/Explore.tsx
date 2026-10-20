import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { Building2, LocateFixed, MapPin, SlidersHorizontal } from 'lucide-react';
import { BusinessCard } from '../components/business/BusinessCard';
import { NearbyBusinessMap } from '../components/business/NearbyBusinessMap';
import { BusinessCardSkeleton } from '../components/common/Skeleton';
import { Button } from '../components/common/Button';
import { ErrorState } from '../components/common/ErrorState';
import { CategoryBar } from '../components/common/CategoryBar';
import { AdvancedSearch } from '../components/search/AdvancedSearch';
import type { FilterOption, SearchFilters, SortOption } from '../components/search/AdvancedSearch';
import { businessApi, directoryApi } from '../services/api';
import { useCategories } from '../hooks/useCategories';
import type { DirectorySort, NearbyBusiness, PublicBusinessCard, PublicCity } from '../types';

const PAGE_SIZE = 12;

/** Options the server actually supports. Anything else is not a sort it can do. */
const SORT_OPTIONS: SortOption[] = [
  { value: 'newest', label: '' },
  { value: 'rating', label: '' },
  { value: 'featured', label: '' },
];

const SORT_LABEL_KEYS: Record<DirectorySort, string> = {
  newest: 'explore.sortNewest',
  rating: 'explore.sortRating',
  featured: 'explore.sortFeatured',
};

/** Rating is a minimum, so a business with 4.5 matches a "4+" filter. */
function matchesRating(rating: string | null, minRating: number | null): boolean {
  if (minRating === null) return true;
  if (!rating) return false;
  const value = Number.parseFloat(rating);
  if (Number.isNaN(value)) return false;
  return value >= minRating;
}

export function ExplorePage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { categories: categoryList } = useCategories();
  const [businesses, setBusinesses] = useState<PublicBusinessCard[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [cities, setCities] = useState<PublicCity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [nearbyBusinesses, setNearbyBusinesses] = useState<NearbyBusiness[]>([]);
  const [nearbyOrigin, setNearbyOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [showNearby, setShowNearby] = useState(false);

  // URL is the single source of truth, so a filtered view can be shared as a
  // link and the back button behaves the way people expect. The panel is fed
  // from it and writes back to it, so the two can never disagree.
  const q = searchParams.get('q') ?? '';
  const featureds = searchParams.getAll('featured');
  const featuredOnly = featureds.length > 0 && featureds.every((value) => value === 'true');
  const city = searchParams.get('city') ?? '';
  const sort = (searchParams.get('sort') as DirectorySort | null) ?? 'newest';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const searchCategories = useMemo(
    () => (searchParams.get('category') ?? '').split(',').filter(Boolean),
    [searchParams],
  );
  const minRating = useMemo(() => {
    const raw = searchParams.get('minRating');
    if (!raw) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isNaN(value) ? null : value;
  }, [searchParams]);

  const sortOptions = useMemo<SortOption[]>(
    () => SORT_OPTIONS.map((option) => ({
      value: option.value,
      label: t(SORT_LABEL_KEYS[option.value as DirectorySort]),
    })),
    [t],
  );

  const categoryOptions = useMemo<FilterOption[]>(
    () => categoryList.map((category) => ({
      value: category.category_slug,
      label: category.category_name,
      count: category.business_count,
    })),
    [categoryList],
  );

  const searchValue: SearchFilters = useMemo(
    () => ({ query: q, categories: searchCategories, minRating, serviceTypes: [] }),
    [q, searchCategories, minRating],
  );

  // A switch from the controlled URL shape back into the filter shape, so a
  // back/forward or a shared link lands the panel on the same selection.
  const handleSearchChange = (next: SearchFilters) => {
    const params = new URLSearchParams(searchParams);
    const value = next.query.trim();
    if (value) params.set('q', value);
    else params.delete('q');

    if (next.categories.length > 0) params.set('category', next.categories.join(','));
    else params.delete('category');

    if (next.minRating !== null) params.set('minRating', String(next.minRating));
    else params.delete('minRating');

    // Any filter change invalidates the current page number.
    params.set('page', '1');
    setSearchParams(params);
  };

  const handleReset = useCallback(() => {
    // Keeps only what the panel does not own: city and sort are separate concerns
    // and the results toolbar still needs them.
    const params = new URLSearchParams();
    if (city) params.set('city', city);
    if (sort !== 'newest') params.set('sort', sort);
    setSearchParams(params);
  }, [city, sort, setSearchParams]);

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

  const findNearbyBusinesses = () => {
    setShowNearby(true);
    setNearbyError(null);
    if (!navigator.geolocation) {
      setNearbyError('explore.geolocationUnavailable');
      return;
    }

    setNearbyLoading(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const origin = { lat: coords.latitude, lng: coords.longitude };
        setNearbyOrigin(origin);
        try {
          const response = await businessApi.listNearby({ ...origin, radiusKm: 25, limit: 50 });
          setNearbyBusinesses(response.data.data);
        } catch {
          setNearbyError('explore.nearbySearchError');
          setNearbyBusinesses([]);
        } finally {
          setNearbyLoading(false);
        }
      },
      (error) => {
        setNearbyLoading(false);
        setNearbyBusinesses([]);
        setNearbyError(
          error.code === error.PERMISSION_DENIED
            ? 'explore.geolocationDenied'
            : error.code === error.TIMEOUT
              ? 'explore.geolocationTimeout'
              : 'explore.geolocationUnavailable',
        );
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 12_000 },
    );
  };

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
      // The directory route takes one category per request, so a multi-select
      // list is fanned out and merged here rather than sent as a comma join.
      const requested = searchCategories.length > 0 ? searchCategories : [undefined];
      const responses = await Promise.all(
        requested.map((category) => businessApi.listPublic({
          q: q || undefined,
          category: category || undefined,
          city: city || undefined,
          featured: featuredOnly || undefined,
          sort,
          page,
          limit: PAGE_SIZE,
        })),
      );

      const merged: PublicBusinessCard[] = [];
      const seen = new Set<string>();
      let serverTotal = 0;
      for (const res of responses) {
        serverTotal += Number(res.data.meta?.total ?? res.data.data.length);
        for (const item of res.data.data) {
          if (seen.has(item.business_id)) continue;
          seen.add(item.business_id);
          merged.push(item);
        }
      }

      setBusinesses(merged);
      setTotalCount(serverTotal);
      setTotalPages(Math.max(1, Math.ceil(serverTotal / PAGE_SIZE)));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [q, city, featuredOnly, sort, page, searchCategories]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen bg-navy-50">
      <div className="bg-white border-b border-navy-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-navy-900">{t('explore.title')}</h1>
              <p className="text-navy-500 mt-1">
                {loading
                  ? t('common.loading')
                  : `${t('explore.results', { count: totalCount })}${q ? ` · "${q}"` : ''}`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={findNearbyBusinesses}
                variant={showNearby ? 'primary' : 'outline'}
                size="sm"
                loading={nearbyLoading}
              >
                <LocateFixed className="me-1.5 h-4 w-4" />
                {t('explore.nearMe')}
              </Button>
              {cities.length > 0 && (
                <select
                  aria-label={t('explore.city')}
                  value={city}
                  onChange={(event) => updateFilter('city', event.target.value || null)}
                  className="rounded-button border border-navy-300 bg-white px-3 py-2 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">{t('explore.allCities')}</option>
                  {cities.map((option) => (
                    <option key={option.city} value={option.city}>
                      {option.city} ({option.business_count})
                    </option>
                  ))}
                </select>
              )}
              <Button
                onClick={() => updateFilter('featured', !featuredOnly)}
                variant={featuredOnly ? 'primary' : 'outline'}
                size="sm"
                aria-pressed={featuredOnly}
              >
                <SlidersHorizontal className="w-4 h-4 me-1.5" />
                {t('business.featured')}
              </Button>
            </div>
          </div>
          <div className="mt-5">
            <CategoryBar selected={searchCategories[0] ?? null} variant="light" />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {showNearby && (
          <section className="mb-6 rounded-card border border-navy-200 bg-white p-4 shadow-card sm:p-6" aria-live="polite">
            <div className="mb-4 flex items-start gap-3">
              <MapPin className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary-600" aria-hidden="true" />
              <div>
                <h2 className="font-semibold text-navy-900">{t('explore.nearbyTitle')}</h2>
                <p className="mt-1 text-sm text-navy-600">
                  {nearbyLoading
                    ? t('explore.locating')
                    : nearbyOrigin
                      ? t('explore.nearbyResults', { count: nearbyBusinesses.length })
                      : t('explore.nearbyPrompt')}
                </p>
                {nearbyError && (
                  <p role="alert" className="mt-2 text-sm text-error-700">{t(nearbyError)}</p>
                )}
              </div>
            </div>
            {nearbyOrigin && !nearbyLoading && !nearbyError && (
              nearbyBusinesses.length > 0 ? (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
                  <NearbyBusinessMap
                    businesses={nearbyBusinesses}
                    origin={nearbyOrigin}
                    ariaLabel={t('explore.nearbyMapLabel')}
                    originLabel={t('explore.youAreHere')}
                  />
                  <ul className="max-h-80 space-y-2 overflow-y-auto">
                    {nearbyBusinesses.map((business) => (
                      <li key={business.business_id}>
                        <Link
                          to={`/business/${business.business_slug}`}
                          className="flex items-start justify-between gap-3 rounded-lg border border-navy-100 p-3 hover:bg-navy-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-navy-900">{business.business_name}</span>
                            {business.city && <span className="text-sm text-navy-500">{business.city}</span>}
                          </span>
                          <span className="flex flex-shrink-0 items-center gap-1 text-sm text-primary-700">
                            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                            {t('explore.distanceKm', { distance: business.distance_km.toFixed(1) })}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="rounded-lg bg-navy-50 p-4 text-sm text-navy-600">{t('explore.nearbyEmpty')}</p>
              )
            )}
          </section>
        )}
        <AdvancedSearch
          categories={categoryOptions}
          value={searchValue}
          onChange={handleSearchChange}
          onReset={handleReset}
          resultCount={totalCount}
          loading={loading}
          sort={{
            value: sort,
            options: sortOptions,
            onChange: (value) => updateFilter('sort', value),
          }}
        >
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => <BusinessCardSkeleton key={i} />)}
            </div>
          ) : error ? (
            <ErrorState onRetry={() => void load()} />
          ) : (
            <>
              <ResultsGrid
                businesses={businesses.filter((business) => matchesRating(business.average_rating, minRating))}
                hasActiveFilters={Boolean(q || searchCategories.length > 0 || minRating)}
                onClear={() => {
                  setSearchParams(new URLSearchParams());
                  handleReset();
                }}
              />

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
          )}
        </AdvancedSearch>
      </div>
    </div>
  );
}

function ResultsGrid({
  businesses,
  hasActiveFilters,
  onClear,
}: {
  businesses: PublicBusinessCard[];
  hasActiveFilters: boolean;
  onClear: () => void;
}) {
  const { t } = useTranslation();

  if (businesses.length > 0) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {businesses.map((business) => (
          <BusinessCard key={business.business_id} business={business} />
        ))}
      </div>
    );
  }

  return (
    <div className="text-center py-16">
      <Building2 className="w-16 h-16 text-navy-300 mx-auto mb-4" />
      <h3 className="text-lg font-medium text-navy-900 mb-2">{t('explore.emptyTitle')}</h3>
      <p className="text-navy-500 mb-6">{t('explore.emptyDescription')}</p>
      {hasActiveFilters && (
        <Button onClick={onClear} variant="outline">
          {t('explore.clearFilters')}
        </Button>
      )}
    </div>
  );
}
