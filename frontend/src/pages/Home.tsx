import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, MapPin, Shapes, Smartphone, Store, UserRound } from 'lucide-react';
import { BusinessCard } from '../components/business/BusinessCard';
import { Button } from '../components/common/Button';
import { HeroSearch } from '../components/home/HeroSearch';
import { BusinessCardSkeleton } from '../components/common/Skeleton';
import { ErrorState } from '../components/common/ErrorState';
import { VerificationJourney } from '../components/home/VerificationJourney';
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
  const [totalBusinesses, setTotalBusinesses] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

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
      const total = totalRes.data.meta?.total;
      setTotalBusinesses(typeof total === 'number' && Number.isFinite(total) ? total : null);
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

  return (
    <div className="min-h-screen min-w-0 bg-navy-50">
      <HeroSearch cities={cities} />
      <VerificationJourney />

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
                <BusinessCard key={business.business_id} business={business} featured />
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

      {!loading && !error && totalBusinesses !== null && (
        <section className="bg-white px-4 pb-16 sm:px-6 lg:px-8" aria-label={t('home.statsHeading')}>
          <div className="mx-auto max-w-5xl rounded-3xl border border-white/70 bg-[linear-gradient(135deg,#0B3A78_0%,#1769C4_65%,#2F8FF0_100%)] p-6 text-white shadow-[0_24px_60px_rgba(11,58,120,0.18)] sm:p-9">
            <h2 className="text-center text-xl font-bold sm:text-2xl">{t('home.statsHeading')}</h2>
            <dl className="mt-7 grid grid-cols-1 divide-y divide-white/20 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:rtl:divide-x-reverse">
              {[
                { value: totalBusinesses, label: t('home.statsBusinesses', { count: totalBusinesses }), Icon: Building2 },
                { value: cities.length, label: t('home.statsCities', { count: cities.length }), Icon: MapPin },
                ...(!categoriesLoading && !categoriesError
                  ? [{ value: categories.length, label: t('home.statsCategories', { count: categories.length }), Icon: Shapes }]
                  : []),
              ].map(({ value, label, Icon }) => (
                <div key={label} className="flex items-center justify-center gap-4 py-5 text-center sm:flex-col sm:py-2">
                  <Icon className="h-6 w-6 shrink-0 text-gold-400" aria-hidden="true" />
                  <div>
                    <dt className="mt-1 text-sm text-white/90">{label}</dt>
                    <dd className="text-3xl font-bold text-gold-300">{formatNumber(value)}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </div>
        </section>
      )}

      <section className="bg-navy-50 py-16">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_auto] lg:px-8">
          <div className="text-center lg:text-start">
            <h2 className="text-2xl font-bold text-navy-900 sm:text-3xl">{t('home.ctaTitle')}</h2>
            <p className="mx-auto mt-3 max-w-xl text-navy-600 lg:mx-0">{t('home.ctaSubtitle')}</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
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
              className="mt-6 text-sm font-medium text-primary-600 underline underline-offset-4 hover:text-primary-700"
            >
              {t('home.ctaListBusiness')}
            </button>
          </div>
          <div aria-hidden="true" className="relative mx-auto flex h-64 w-64 items-center justify-center rounded-full bg-[radial-gradient(circle,#E6F3FF_0%,#D4E9FA_55%,rgba(212,233,250,0)_72%)] sm:h-72 sm:w-72">
            <div className="absolute bottom-10 h-28 w-40 rounded-[2rem] border border-white bg-white/80 shadow-xl" />
            <Store className="absolute bottom-[4.5rem] h-12 w-12 text-primary-500" strokeWidth={1.5} />
            <div className="absolute bottom-4 start-[5.5rem] flex h-36 w-24 items-center justify-center rounded-t-[3.5rem] rounded-b-2xl bg-gradient-to-br from-primary-500 to-navy-800 shadow-lg">
              <UserRound className="mb-10 h-16 w-16 text-white" strokeWidth={1.4} />
            </div>
            <div className="absolute bottom-[4.5rem] end-[4.5rem] flex h-20 w-12 items-center justify-center rounded-lg border-2 border-navy-800 bg-white shadow-md">
              <Smartphone className="h-8 w-8 text-gold-500" strokeWidth={1.8} />
            </div>
            <span className="absolute end-8 top-12 h-4 w-4 rounded-full bg-gold-400 shadow-[0_0_24px_rgba(255,200,61,0.75)]" />
            <span className="absolute start-8 top-24 h-3 w-3 rounded-full bg-primary-300 shadow-[0_0_20px_rgba(47,143,240,0.55)]" />
          </div>
        </div>
      </section>
    </div>
  );
}