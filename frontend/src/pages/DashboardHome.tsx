import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import {
  ShoppingBag, DollarSign, Users, Star, Package, Sparkles, MessageSquare, Clock,
} from 'lucide-react';
import { Card } from '../components/common/Card';
import { DashboardStatsSkeleton } from '../components/common/Skeleton';
import { ErrorState } from '../components/common/ErrorState';
import { NotAvailableYet } from '../components/common/OffsetPager';
import { businessApi } from '../services/api';
import { formatCurrency, formatNumber, formatDateTime } from '../lib/utils';
import type { BusinessStatistics, Id } from '../types';

/**
 * The owner's home.
 *
 * Every figure here is read from `GET /business/:id/statistics`, which is a
 * single row of lifetime counters. There is no period, so nothing on this page
 * can say "this month" or "up 12%" — and nothing does. A trend needs two points
 * to draw a line between, and this API returns one.
 */
export function DashboardHomePage() {
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

  // The row can legitimately be absent: the refresh inside the route writes it,
  // but a business that has just been created may not have one yet.
  if (!stats) {
    return <NotAvailableYet label={t('dashboard.noStatisticsYet')} />;
  }

  const cards = [
    { label: t('dashboard.totalOrders'), value: formatNumber(stats.total_orders), Icon: ShoppingBag },
    { label: t('dashboard.totalRevenue'), value: formatCurrency(stats.total_revenue), Icon: DollarSign },
    { label: t('dashboard.totalCustomers'), value: formatNumber(stats.total_customers), Icon: Users },
    { label: t('dashboard.averageRating'), value: `${formatNumber(stats.average_rating)} / 5`, Icon: Star },
    { label: t('dashboard.pendingOrders'), value: formatNumber(stats.pending_orders), Icon: Clock },
    { label: t('dashboard.completedOrders'), value: formatNumber(stats.completed_orders), Icon: ShoppingBag },
    { label: t('dashboard.cancelledOrders'), value: formatNumber(stats.cancelled_orders), Icon: ShoppingBag },
    { label: t('dashboard.totalProducts'), value: formatNumber(stats.total_products), Icon: Package },
    { label: t('dashboard.totalServices'), value: formatNumber(stats.total_services), Icon: Sparkles },
    { label: t('dashboard.totalReviews'), value: formatNumber(stats.total_reviews), Icon: MessageSquare },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy-900">{t('dashboard.title')}</h1>
        <p className="text-sm text-navy-500 mt-1">
          {t('dashboard.computedAt', { date: formatDateTime(stats.computed_at) })}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {cards.map(({ label, value, Icon }) => (
          <Card key={label} className="p-4">
            <div className="w-9 h-9 rounded-card bg-sky flex items-center justify-center mb-3">
              <Icon className="w-5 h-5 text-primary-500" strokeWidth={1.75} aria-hidden="true" />
            </div>
            <p className="text-xs text-navy-500">{label}</p>
            <p className="text-xl font-bold text-navy-900 mt-0.5 break-words">{value}</p>
          </Card>
        ))}
      </div>

      {/* The split is real and it is all the API has: one total, no second
          point to compare it against. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5">
          <h2 className="font-semibold text-navy-900 mb-1">{t('dashboard.orderBreakdown')}</h2>
          <p className="text-sm text-navy-500 mb-4">{t('dashboard.orderBreakdownBody')}</p>
          <dl className="space-y-3">
            {[
              ['pending', stats.pending_orders],
              ['completed', stats.completed_orders],
              ['cancelled', stats.cancelled_orders],
            ].map(([key, count]) => {
              const total = stats.total_orders || 0;
              const share = total === 0 ? 0 : Math.round((Number(count) / total) * 100);
              return (
                <div key={key}>
                  <div className="flex justify-between text-sm mb-1">
                    <dt className="text-navy-600">{t(`orderStatus.${key}`)}</dt>
                    <dd className="text-navy-900">
                      {formatNumber(Number(count))}
                      <span className="text-navy-400 ms-1">({share}%)</span>
                    </dd>
                  </div>
                  <div className="h-2 rounded-full bg-navy-100 overflow-hidden">
                    <div className="h-full bg-primary-500 rounded-full" style={{ width: `${share}%` }} />
                  </div>
                </div>
              );
            })}
          </dl>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="font-semibold text-navy-900 mb-4">{t('dashboard.quickActions')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { to: `/dashboard/business/${businessId}/products/create`, label: t('product.create') },
              { to: `/dashboard/business/${businessId}/services/create`, label: t('service.create') },
              { to: `/dashboard/business/${businessId}/orders`, label: t('order.title') },
              { to: `/dashboard/business/${businessId}/reviews`, label: t('review.title') },
              { to: '/dashboard/settings', label: t('settings.title') },
            ].map((action) => (
              <Link
                key={action.to}
                to={action.to}
                className="rounded-button border border-navy-200 px-4 py-3 text-sm font-medium text-navy-700 hover:border-primary-300 hover:text-primary-700 transition-colors"
              >
                {action.label}
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}