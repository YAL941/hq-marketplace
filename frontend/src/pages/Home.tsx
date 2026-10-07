import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, MapPin, Store } from 'lucide-react';
import { BusinessCard } from '../components/business/BusinessCard';
import { SearchBar } from '../components/common/SearchBar';
import { Button } from '../components/common/Button';
import { CategoryBar } from '../components/common/CategoryBar';
import { BusinessCardSkeleton } from '../components/common/Skeleton';
import { ErrorState } from '../components/common/ErrorState';
import { businessApi, directoryApi } from '../services/api';
import { formatNumber } from '../lib/utils';
import { useCategories } from '../hooks/useCategories';
import type { PublicBusinessCard, PublicCity } from '../types';

const FEATURED_LIMIT = 4;

export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { categories, loading: categoriesLoading, error: categoriesError } = useCategories();

  const [featured, setFeatured] = useState<PublicBusinessCard[]>([]);
  const [cities, setCities] = useState<PublicCity[]>([]);
  /**
   * Counts come from the server. A home page for an empty deployment reads
   * "0 businesses listed" rather than inventing a number, and the featured
   * section falls back to the newest businesses when nothing is featured yet.
   */
  const [totalBusinesses, setTotalBusinesses] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [featuredRes, newestRes, totalRes, cityRes] = await Promise.all([
        businessApi.listPublic({ featured: true, sort: 'featured', limit: FEATURED_LIMIT }),
        // Read at the same time as the featured query so the two sections can
        // never disagree with each other or cost an extra round trip.
        businessApi.listPublic({ sort: 'newest', limit: FEATURED_LIMIT }),
        // A cheap first page whose only job is to read meta.total.
        businessApi.listPublic({ limit: 1 }),
        directoryApi.cities(),
      ]);

      // An editorial pick is not guaranteed, so an empty featured result is
      // filled with the newest listings rather than an empty section.
      setFeatured(
        featuredRes.data.data.length > 0 ? featuredRes.data.data : newestRes.data.data,
      );
      setTotalBusinesses(Number(totalRes.data.meta?.total ?? 0));
      setCities(cityRes.data.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSearch = (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const params = new URLSearchParams({ q: trimmed });
    if (selectedCity) params.set('city', selectedCity);
    navigate(`/explore?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-navy-50">
      {/* Hero: navy to blue, so the gold buttons and chips read as accents. */}
      <section className="relative overflow-hidden bg-gradient-to-br from-navy-900 via-navy-900 to-primary-700 text-white">
        <div className="absolute inset-0 hero-dots" aria-hidden="true" />

        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              {t('home.heroTitle')}
            </h1>
            <p className="mt-5 max-w-2xl text-base text-navy-200 sm:text-lg">
              {t('home.heroSubtitle')}
            </p>

            {/* The search row is the hero's only control group, so it stays a
                single column on a phone rather than splitting the input from
                its own button. */}
            <div className="mt-8 flex flex-col gap-3 sm:max-w-2xl">
              <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                onSearch={handleSearch}
                placeholder={t('home.heroSearchPlaceholder')}
                className="w-full"
              />

              <div className="flex flex-col gap-3 sm:flex-row">
                {cities.length > 0 && (
                  <div className="relative flex-1">
                    <label htmlFor="home-city" className="sr-only">
                      {t('home.heroCitiesLabel')}
                    </label>
                    <MapPin
                      className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 h-5 w-5 text-navy-300"
                      aria-hidden="true"
                    />
                    <select
                      id="home-city"
                      value={selectedCity}
                      onChange={(e) => setSelectedCity(e.target.value)}
                      className="w-full rounded-button border border-white/20 bg-white/10 py-3 ps-12 pe-4 text-white transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-gold-400"
                    >
                      <option value="" className="text-navy-900">
                        {t('home.heroAllCities')}
                      </option>
                      {cities.map((city) => (
                        <option key={city.city} value={city.city} className="text-navy-900">
                          {city.city}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <Button
                  variant="gold"
                  size="lg"
                  onClick={() => handleSearch(searchQuery)}
                  className="sm:w-auto"
                >
                  {t('home.heroSearchCta')}
                </Button>
              </div>
            </div>

            <div className="mt-6">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-navy-200">
                {t('home.browseCategories')}
              </h2>
              <CategoryBar selected={null} variant="onDark" />
            </div>

            {/* Every figure here is a server count. Nothing is hardcoded. */}
            {!loading && (
              <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-4">
                {[
                  { value: totalBusinesses, label: t('home.statsBusinesses', { count: totalBusinesses }) },
                  { value: cities.length, label: t('home.statsCities', { count: cities.length }) },
                  ...(!categoriesLoading && !categoriesError
                    ? [{ value: categories.length, label: t('home.statsCategories', { count: categories.length }) }]
                    : []),
                ].map((stat) => (
                  <div key={stat.label}>
                    <dt className="sr-only">{stat.label}</dt>
                    <dd>
                      <span className="block text-3xl font-bold text-gold-400">
                        {formatNumber(stat.value)}
                      </span>
                      <span className="text-sm text-navy-200">{stat.label}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-navy-900 sm:text-3xl">
                {t('business.sections.featured')}
              </h2>
              <p className="mt-1 text-navy-500">{t('business.sections.featuredSubtitle')}</p>
            </div>
            <Link
              to="/explore"
              className="flex items-center gap-1 font-medium text-primary-600 hover:text-primary-700"
            >
              {t('common.viewAll')}
              <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <BusinessCardSkeleton key={i} />
              ))}
            </div>
          ) : error ? (
            <ErrorState onRetry={() => void load()} />
          ) : featured.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {featured.map((business) => (
                <BusinessCard key={business.business_id} business={business} />
              ))}
            </div>
          ) : (
            <div className="py-12 text-center">
              <Building2 className="mx-auto mb-4 h-12 w-12 text-navy-300" aria-hidden="true" />
              <p className="text-navy-500">{t('business.sections.categoriesEmpty')}</p>
            </div>
          )}
        </div>
      </section>

      <section className="bg-navy-50 py-16">
        <div className="mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8">
          <Store className="mx-auto mb-4 h-10 w-10 text-primary-500" aria-hidden="true" />
          <h2 className="text-2xl font-bold text-navy-900 sm:text-3xl">{t('home.ctaTitle')}</h2>
          <p className="mx-auto mt-3 max-w-xl text-navy-600">{t('home.ctaSubtitle')}</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button variant="gold" size="lg" onClick={() => navigate('/register')}>
              {t('home.ctaButton')}
            </Button>
            <Button variant="outline" size="lg" onClick={() => navigate('/explore')}>
              {t('home.ctaSecondary')}
            </Button>
          </div>
          {/* For an account that already exists: signing up again is the wrong
              instruction. This link works either way, because the listing page
              sends an anonymous visitor to the login screen first and brings
              them back here afterwards. */}
          <button
            type="button"
            onClick={() => navigate('/list-your-business')}
            className="mt-6 text-sm font-medium text-primary-600 hover:text-primary-700 underline underline-offset-4"
          >
            {t('home.ctaListBusiness')}
          </button>
        </div>
      </section>
    </div>
  );
}