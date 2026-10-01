import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { Building2, ArrowLeft } from 'lucide-react';
import { BusinessCard } from '../components/business/BusinessCard';
import { BusinessCardSkeleton } from '../components/common/Skeleton';
import { Button } from '../components/common/Button';
import { ErrorState } from '../components/common/ErrorState';
import { CategoryIcon } from '../components/common/CategoryIcon';
import { businessApi, directoryApi } from '../services/api';
import type { PublicBusinessCard, PublicCategory } from '../types';

const PAGE_SIZE = 12;

export function CategoryPage() {
  const { t } = useTranslation();
  const { category: categorySlug } = useParams<{ category: string }>();

  const [category, setCategory] = useState<PublicCategory | null>(null);
  const [businesses, setBusinesses] = useState<PublicBusinessCard[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // The category list is the only source of a category's real name, count and
  // id. Nothing here is derived from the slug: a slug is a URL, not a record.
  const load = useCallback(async () => {
    if (!categorySlug) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const [catRes, bizRes] = await Promise.all([
        directoryApi.categories(),
        businessApi.listPublic({ category: categorySlug, page, limit: PAGE_SIZE }),
      ]);

      const matched = catRes.data.data.find((c) => c.category_slug === categorySlug);
      setCategory(matched ?? null);
      setBusinesses(bizRes.data.data);
      setTotalCount(Number(bizRes.data.meta?.total ?? bizRes.data.data.length));
      setTotalPages(Number(bizRes.data.meta?.totalPages ?? 1));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [categorySlug, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // A different category means a different result set, so the pager resets.
  useEffect(() => {
    setPage(1);
  }, [categorySlug]);

  if (!loading && !error && !category) {
    return (
      <div className="min-h-screen bg-navy-50 flex items-center justify-center px-4">
        <div className="text-center">
          <Building2 className="w-16 h-16 text-navy-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-navy-900 mb-2">{t('category.emptyTitle')}</h1>
          <p className="text-navy-500 mb-6">{t('category.emptyDescription')}</p>
          <Link to="/explore">
            <Button variant="outline">
              <ArrowLeft className="w-4 h-4 me-2 rtl:rotate-180" />
              {t('category.backToExplore')}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy-50">
      <div className="bg-white border-b border-navy-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Link
            to="/explore"
            className="inline-flex items-center gap-1 text-sm text-navy-500 hover:text-navy-900 transition-colors mb-3"
          >
            <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
            {t('category.backToExplore')}
          </Link>
          <div className="flex items-center gap-4">
            <CategoryIcon slug={category?.category_slug ?? categorySlug} size="card" />
            <div>
              <h1 className="text-2xl font-bold text-navy-900">
                {category?.category_name ?? categorySlug}
              </h1>
              {category?.description && (
                <p className="text-navy-500 mt-1 max-w-2xl">{category.description}</p>
              )}
            </div>
          </div>
          <p className="text-navy-500 mt-1">
            {loading ? t('common.loading') : t('explore.results', { count: totalCount })}
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
              <nav className="mt-8 flex items-center justify-center gap-2" aria-label={t('common.pagination')}>
                <Button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  variant="outline"
                  disabled={page === 1}
                >
                  {t('common.previous')}
                </Button>
                <span className="px-4 text-sm text-navy-600">
                  {t('common.pageOf', { page, totalPages })}
                </span>
                <Button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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
            <h2 className="text-lg font-medium text-navy-900 mb-2">
              {t('explore.emptyTitle')}
            </h2>
            <p className="text-navy-500 mb-6">{t('explore.emptyDescription')}</p>
            <Link to="/explore">
              <Button variant="outline">{t('explore.clearFilters')}</Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
