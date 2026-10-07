import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Card } from '../components/common/Card';
import { CategoryIcon } from '../components/common/CategoryIcon';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { Skeleton } from '../components/common/Skeleton';
import { useCategories } from '../hooks/useCategories';

export function CategoriesPage() {
  const { t } = useTranslation();
  const { categories, loading, error, retry } = useCategories();

  return (
    <div className="min-h-screen bg-navy-50">
      <section className="bg-white border-b border-navy-200">
        <div className="max-w-7xl mx-auto px-4 py-10 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-navy-900">{t('categories.title')}</h1>
          <p className="mt-2 text-navy-500">{t('categories.subtitle')}</p>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, index) => <Skeleton key={index} className="h-28 rounded-card" />)}
          </div>
        ) : error ? (
          <ErrorState onRetry={() => void retry()} />
        ) : categories.length === 0 ? (
          <EmptyState title={t('categories.emptyTitle')} description={t('categories.emptyDescription')} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((category) => (
              <Link key={category.category_id} to={`/categories/${category.category_slug}`} className="group">
                <Card className="flex h-full items-center gap-4 p-5 transition-shadow group-hover:shadow-card">
                  <CategoryIcon slug={category.category_slug} size="card" />
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold text-navy-900 group-hover:text-primary-700">
                      {category.category_name}
                    </h2>
                    {category.description && <p className="mt-1 line-clamp-2 text-sm text-navy-500">{category.description}</p>}
                    <p className="mt-2 text-sm text-navy-600">
                      {t('categories.businessCount', { count: category.business_count })}
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 flex-shrink-0 text-navy-400 rtl:rotate-180" aria-hidden="true" />
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
