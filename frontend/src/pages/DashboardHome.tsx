import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import {
  ShoppingBag, DollarSign, Users, Star, Package, Sparkles, MessageSquare, Clock, AlertCircle,
  CheckCircle2, XCircle, ArrowUpRight, PackagePlus, Settings,
} from 'lucide-react';
import { Card } from '../components/common/Card';
import { DashboardStatsSkeleton } from '../components/common/Skeleton';
import { ErrorState } from '../components/common/ErrorState';
import { NotAvailableYet } from '../components/common/OffsetPager';
import { businessApi } from '../services/api';
import { formatCurrency, formatNumber, formatDateTime } from '../lib/utils';
import type { BusinessStatistics, StaffBusinessProfile, Id } from '../types';

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
  const [profile, setProfile] = useState<StaffBusinessProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(false);
    try {
      const res = await businessApi.getStatistics(businessId);
      setStats(res.data.data);
      // Best-effort: the staff profile is only needed to spot an incomplete
      // listing. A failure here must not hide the statistics, which are the
      // point of the page.
      try {
        const pres = await businessApi.getForBusiness(businessId);
        setProfile(pres.data.data);
      } catch {
        setProfile(null);
      }
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
    { label: t('dashboard.completedOrders'), value: formatNumber(stats.completed_orders), Icon: CheckCircle2 },
    { label: t('dashboard.cancelledOrders'), value: formatNumber(stats.cancelled_orders), Icon: XCircle },
    { label: t('dashboard.totalProducts'), value: formatNumber(stats.total_products), Icon: Package },
    { label: t('dashboard.totalServices'), value: formatNumber(stats.total_services), Icon: Sparkles },
    { label: t('dashboard.totalReviews'), value: formatNumber(stats.total_reviews), Icon: MessageSquare },
  ];

  // A business created with only a name is incomplete until it has a category,
  // a city and a phone. The link points at complete mode for the current
  // business, never at the create form.
  const incomplete =
    profile && (profile.business_category_id == null || !profile.city || !profile.phone);

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-navy-500">
            {t('sidebar.overview')}
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-navy-950 sm:text-3xl">{t('dashboard.title')}</h1>
        </div>
        <p className="text-xs text-navy-500 sm:text-sm">
          {t('dashboard.computedAt', { date: formatDateTime(stats.computed_at) })}
        </p>
      </div>

      {incomplete && (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-warning-600/20 bg-warning-50 p-4 text-sm text-warning-600 shadow-sm">
          <AlertCircle className="w-5 h-5 text-warning-600 flex-shrink-0" aria-hidden="true" />
          <span className="flex-1">{t('dashboard.incompleteProfile')}</span>
          <Link
            to={`/list-your-business?complete=${businessId}`}
            className="inline-flex items-center gap-1 font-semibold text-primary-700 transition-colors hover:text-primary-800"
          >
            {t('dashboard.completeIt')}
            <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
          </Link>
        </div>
      )}

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map(({ label, value, Icon }) => (
          <Card key={label} className="rounded-2xl border-navy-100 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
            <div className="mb-5 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-50">
                <Icon className="h-5 w-5 text-navy-700" strokeWidth={1.8} aria-hidden="true" />
              </span>
              <p className="min-w-0 break-words text-2xl font-bold tracking-tight text-navy-950">{value}</p>
            </div>
            <p className="text-sm font-medium text-navy-500">{label}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Card className="rounded-2xl border-navy-100 p-5 shadow-sm sm:p-6 xl:col-span-3">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-navy-950">{t('dashboard.orderBreakdown')}</h2>
            </div>
            <div className="shrink-0 rounded-xl bg-navy-50 px-3 py-2 text-end">
              <p className="text-xs text-navy-500">{t('dashboard.totalOrders')}</p>
              <p className="font-semibold tabular-nums text-navy-900">{formatNumber(stats.total_orders)}</p>
            </div>
          </div>
          <dl className="space-y-5">
            {[
              { key: 'pending', count: stats.pending_orders, color: 'bg-orange-500' },
              { key: 'completed', count: stats.completed_orders, color: 'bg-blue-500' },
              { key: 'cancelled', count: stats.cancelled_orders, color: 'bg-red-500' },
            ].map(({ key, count, color }) => {
              const total = stats.total_orders || 0;
              const share = total === 0 ? 0 : Math.round((Number(count) / total) * 100);
              const label = t(`orderStatus.${key}`);
              return (
                <div key={key}>
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                    <dt className="flex items-center gap-2 font-medium text-navy-700">
                      <span className={`h-2.5 w-2.5 rounded-full ${color}`} aria-hidden="true" />
                      {label}
                    </dt>
                    <dd className="tabular-nums text-navy-900">
                      {formatNumber(Number(count))}
                      <span className="ms-2 text-navy-400">({share}%)</span>
                    </dd>
                  </div>
                  <div
                    className="h-2 overflow-hidden rounded-full bg-navy-100"
                    role="progressbar"
                    aria-label={label}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={share}
                  >
                    <div className={`h-full rounded-full ${color}`} style={{ width: `${share}%` }} />
                  </div>
                </div>
              );
            })}
          </dl>
        </Card>

        <Card className="rounded-2xl border-navy-100 p-5 shadow-sm sm:p-6 xl:col-span-2">
          <h2 className="mb-5 font-semibold text-navy-950">{t('dashboard.quickActions')}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {[
              { to: `/dashboard/business/${businessId}/products/create`, label: t('product.create'), Icon: PackagePlus },
              { to: `/dashboard/business/${businessId}/services/create`, label: t('service.create'), Icon: Sparkles },
              { to: `/dashboard/business/${businessId}/orders`, label: t('order.title'), Icon: ShoppingBag },
              { to: `/dashboard/business/${businessId}/reviews`, label: t('review.title'), Icon: MessageSquare },
              { to: '/dashboard/settings', label: t('settings.title'), Icon: Settings },
            ].map((action) => (
              <Link
                key={action.to}
                to={action.to}
                className="group flex items-center justify-between gap-3 rounded-xl border border-navy-100 bg-white px-4 py-3.5 text-sm font-medium text-navy-700 shadow-sm transition duration-150 hover:border-navy-200 hover:bg-navy-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <action.Icon className="h-4 w-4 shrink-0 text-navy-600" aria-hidden="true" />
                  {action.label}
                </span>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-navy-400 transition group-hover:text-navy-700 rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}