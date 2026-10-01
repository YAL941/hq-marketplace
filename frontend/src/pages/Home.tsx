import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, MapPin, Search, Store, Heart } from 'lucide-react';
import { BusinessCard } from '../components/business/BusinessCard';
import { CategoryCard } from '../components/business/CategoryCard';
import { SearchBar } from '../components/common/SearchBar';
import { Badge } from '../components/common/Badge';
import { Card } from '../components/common/Card';
import { BusinessCardSkeleton, CategoryCardSkeleton } from '../components/common/Skeleton';
import { ErrorState } from '../components/common/ErrorState';
import { businessApi, directoryApi } from '../services/api';
import { formatNumber } from '../lib/utils';
import type { PublicBusinessCard, PublicCategory, PublicCity } from '../types';

const HOW_IT_WORKS = [
  { key: 'step1', icon: Search },
  { key: 'step2', icon: Store },
  { key: 'step3', icon: Heart },
] as const;

export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [featured, setFeatured] = useState<PublicBusinessCard[]>([]);
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [cities, setCities] = useState<PublicCity[]>([]);
  // Counts come from the server, so a home page for an empty deployment reads
  // "0 businesses" instead of inventing "500+".
  const [totalBusinesses, setTotalBusinesses] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [featuredRes, totalRes, catRes, cityRes] = await Promise.all([
        businessApi.listPublic({ featured: true, sort: 'featured', limit: 8 }),
        // A cheap first page whose only job is to read meta.total.
        businessApi.listPublic({ limit: 1 }),
        directoryApi.categories(),
        directoryApi.cities(),
      ]);

      setFeatured(featuredRes.data.data);
      setTotalBusinesses(Number(totalRes.data.meta?.total ?? 0));
      // A category nobody has a business in would render as an empty page, so
      // it is dropped here rather than on the categories route.
      setCategories(catRes.data.data.filter((c) => c.business_count > 0));
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
      <section className="relative bg-gradient-to-br from-navy-900 via-navy-800 to-navy-900 text-white overflow-hidden">
        <div className="absolute inset-0 hero-dots" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <div className="max-w-3xl">
            <Badge variant="info" className="mb-4 text-sm">{t('brand.tagline')}</Badge>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-6">
              {t('home.heroTitle')}
            </h1>
            <p className="text-lg sm:text-xl text-navy-200 mb-8 max-w-2xl">
              {t('home.heroSubtitle')}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 max-w-xl">
              <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                onSearch={handleSearch}
                placeholder={t('explore.searchPlaceholder')}
                className="flex-1"
              />
              {cities.length > 0 && (
                <div className="relative">
                  <label htmlFor="home-city" className="sr-only">{t('explore.city')}</label>
                  <MapPin
                    className="absolute start-4 top-1/2 -translate-y-1/2 w-5 h-5 text-navy-300"
                    aria-hidden="true"
                  />
                  <select
                    id="home-city"
                    value={selectedCity}
                    onChange={(e) => setSelectedCity(e.target.value)}
                    className="w-full ps-12 pe-4 py-3 bg-white/10 text-white border border-white/20 rounded-button focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors min-w-[200px]"
                  >
                    <option value="">{t('explore.allCities')}</option>
                    {cities.map((city) => (
                      <option key={city.city} value={city.city} className="text-navy-900">
                        {city.city}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 inset-x-0 h-16 bg-gradient-to-t from-navy-50 to-transparent" />
      </section>

      <section className="bg-white border-b border-navy-200 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
            <div>
              <div className="text-3xl font-bold text-navy-900">
                {loading ? '—' : formatNumber(totalBusinesses)}
              </div>
              <div className="text-navy-500 text-sm">
                {t('home.statsBusinesses', { count: totalBusinesses })}
              </div>
            </div>
            <div>
              <div className="text-3xl font-bold text-navy-900">
                {loading ? '—' : formatNumber(categories.length)}
              </div>
              <div className="text-navy-500 text-sm">
                {t('home.statsCategories', { count: categories.length })}
              </div>
            </div>
            <div>
              <div className="text-3xl font-bold text-navy-900">
                {loading ? '—' : formatNumber(cities.length)}
              </div>
              <div className="text-navy-500 text-sm">
                {t('home.statsCities', { count: cities.length })}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 bg-navy-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8 gap-4">
            <div>
              <h2 className="text-2xl font-bold text-navy-900">{t('business.sections.categories')}</h2>
              <p className="text-navy-500 mt-1">{t('business.sections.categoriesSubtitle')}</p>
            </div>
            <Link
              to="/explore"
              className="text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1 flex-shrink-0"
            >
              {t('common.viewAll')} <ArrowRight className="w-4 h-4 rtl:rotate-180" />
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {[...Array(6)].map((_, i) => <CategoryCardSkeleton key={i} />)}
            </div>
          ) : categories.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {categories.map((category) => (
                <CategoryCard key={category.category_id} category={category} />
              ))}
            </div>
          ) : (
            <p className="text-center text-navy-500 py-12">
              {t('business.sections.categoriesEmpty')}
            </p>
          )}
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8 gap-4">
            <div>
              <h2 className="text-2xl font-bold text-navy-900">
                {t('business.sections.featured')}
              </h2>
              <p className="text-navy-500 mt-1">{t('business.sections.featuredSubtitle')}</p>
            </div>
            <Link
              to="/explore"
              className="text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1 flex-shrink-0"
            >
              {t('common.viewAll')} <ArrowRight className="w-4 h-4 rtl:rotate-180" />
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[...Array(4)].map((_, i) => <BusinessCardSkeleton key={i} />)}
            </div>
          ) : error ? (
            <ErrorState onRetry={() => void load()} />
          ) : featured.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {featured.map((business) => (
                <BusinessCard key={business.business_id} business={business} />
              ))}
            </div>
          ) : (
            <p className="text-center text-navy-500 py-12">{t('business.sections.categoriesEmpty')}</p>
          )}
        </div>
      </section>

      <section className="py-16 bg-navy-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold text-navy-900">{t('home.howItWorks')}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map((step) => (
              <Card key={step.key} padding="lg" className="text-center">
                <div className="w-14 h-14 rounded-xl bg-primary-100 flex items-center justify-center mx-auto mb-4 text-primary-600">
                  <step.icon className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-semibold text-navy-900 mb-2">
                  {t(`home.${step.key}Title`)}
                </h3>
                <p className="text-navy-500">{t(`home.${step.key}Body`)}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
