import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { Card } from '../components/common/Card';
import { DashboardStatsSkeleton } from '../components/common/Skeleton';
import { ErrorState } from '../components/common/ErrorState';
import { NotAvailableYet } from '../components/common/OffsetPager';
import { businessApi } from '../services/api';
import { formatCurrency, formatNumber, formatDateTime } from '../lib/utils';
import type { BusinessStatistics, Id } from '../types';

/**
 * Analytics, which is a name this page has to earn.
 *
 * `business_statistics` is one row of lifetime counters: totals, a rating and a
 * revenue figure, with no timestamps per event and no series. That rules out a
 * trend line, a day-by-day chart, a best-seller ranking and anything with a
 * period selector. Those are listed as unavailable instead of being drawn from
 * invented numbers — the previous version of this page shipped a revenue chart
 * built from hard-coded points and a "+14.8%" that no query could produce.
 */
export function DashboardAnalyticsPage() {
  const { t } = useTranslation();
  const params = useParams<{ businessId: Id }>();
  const businessId = params.businessId ?? '';

  const [stats, setStats] = useState<BusinessStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(false);
    try {
      const res = await businessApi.getStatistics(businessId);
      setStats(res.data.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <DashboardStatsSkeleton />;
  if (error) return <ErrorState onRetry={() => void load()} />;
  if (!stats) return <NotAvailableYet label={t('dashboard.noStatisticsYet')} />;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy-900">{t('analytics.title')}</h1>
        <p className="text-sm text-navy-500 mt-1">
          {t('dashboard.computedAt', { date: formatDateTime(stats.computed_at) })}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Card className="p-5">
          <p className="text-sm text-navy-500">{t('dashboard.totalRevenue')}</p>
          <p className="text-2xl font-bold text-navy-900 mt-1">
            {formatCurrency(stats.total_revenue)}
          </p>
          <p className="text-xs text-navy-400 mt-2">{t('analytics.lifetimeOnly')}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-navy-500">{t('dashboard.totalOrders')}</p>
          <p className="text-2xl font-bold text-navy-900 mt-1">
            {formatNumber(stats.total_orders)}
          </p>
          <p className="text-xs text-navy-400 mt-2">{t('analytics.lifetimeOnly')}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-navy-500">{t('dashboard.averageRating')}</p>
          <p className="text-2xl font-bold text-navy-900 mt-1">
            {formatNumber(stats.average_rating)} / 5
          </p>
          <p className="text-xs text-navy-400 mt-2">
            {t('analytics.fromReviews', { count: stats.total_reviews })}
          </p>
        </Card>
      </div>

      <h2 className="text-lg font-semibold text-navy-900 mb-4 flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-navy-400" strokeWidth={1.75} aria-hidden="true" />
        {t('analytics.unavailableTitle')}
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          t('analytics.gapRevenueOverTime'),
          t('analytics.gapOrdersOverTime'),
          t('analytics.gapBestSellers'),
          t('analytics.gapTrafficSources'),
        ].map((label) => (
          <NotAvailableYet key={label} label={label} />
        ))}
      </div>

      <p className="mt-6 text-sm text-navy-500">{t('analytics.gapReason')}</p>
    </div>
  );
}