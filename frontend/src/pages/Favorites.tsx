import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { BusinessCard } from '../components/business/BusinessCard';
import { Button } from '../components/common/Button';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { BusinessCardSkeleton } from '../components/common/Skeleton';
import { useAuth } from '../context/useAuth';
import { useFavorites } from '../context/useFavorites';

export function FavoritesPage() {
  const { t } = useTranslation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { businesses, isLoading, hasError, refresh } = useFavorites();

  if (authLoading) {
    return <div className="min-h-screen bg-navy-50" aria-busy="true" />;
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-navy-50 flex items-center justify-center px-4">
        <EmptyState
          icon={<Heart className="h-8 w-8" aria-hidden="true" />}
          title={t('favorites.signInTitle')}
          description={t('favorites.signInDescription')}
          action={<Link to={`/login?next=${encodeURIComponent('/favorites')}`}><Button>{t('nav.signIn')}</Button></Link>}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy-50">
      <section className="bg-white border-b border-navy-200">
        <div className="max-w-7xl mx-auto px-4 py-10 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-navy-900">{t('favorites.title')}</h1>
          <p className="mt-2 text-navy-500">{t('favorites.subtitle')}</p>
        </div>
      </section>
      <section className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(3)].map((_, index) => <BusinessCardSkeleton key={index} />)}
          </div>
        ) : hasError ? (
          <ErrorState onRetry={() => void refresh()} />
        ) : businesses.length === 0 ? (
          <EmptyState
            icon={<Heart className="h-8 w-8" aria-hidden="true" />}
            title={t('favorites.emptyTitle')}
            description={t('favorites.emptyDescription')}
            action={<Link to="/explore"><Button variant="outline">{t('favorites.explore')}</Button></Link>}
          />
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {businesses.map((business) => <BusinessCard key={business.business_id} business={business} />)}
          </div>
        )}
      </section>
    </div>
  );
}
