import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import {
  CalendarDays,
  Download,
  Eye,
  Loader2,
  ShoppingBag,
  Star,
  Store,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '../components/common/Card';
import { DashboardStatsSkeleton } from '../components/common/Skeleton';
import { ErrorState } from '../components/common/ErrorState';
import { NotAvailableYet } from '../components/common/OffsetPager';
import { businessApi } from '../services/api';
import { formatNumber, formatDateTime } from '../lib/utils';
import i18n, { intlLocaleFor } from '../i18n';
import type { BusinessStatistics, Id } from '../types';

interface SummaryStatCardProps {
  title: string;
  value: string;
  description: string;
  icon: LucideIcon;
  accent: string;
  footer?: React.ReactNode;
}

function SummaryStatCard({ title, value, description, icon: Icon, accent, footer }: SummaryStatCardProps) {
  return (
    <Card className="flex min-h-48 flex-col justify-between p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-navy-500">{title}</p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-navy-900" dir="auto">
            {value}
          </p>
        </div>
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${accent}`}>
          <Icon className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
        </span>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-xs leading-5 text-navy-500">{description}</p>
        {footer}
      </div>
    </Card>
  );
}

export function DashboardAnalyticsPage() {
  const { t } = useTranslation();
  const params = useParams<{ businessId: Id }>();
  const businessId = params.businessId ?? '';

  const [period, setPeriod] = useState<'7d' | '30d' | 'this_year'>('7d');
  const [stats, setStats] = useState<BusinessStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequestId = ++requestId.current;
    if (!businessId) {
      setError(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const res = await businessApi.getStatistics(businessId, period);
      if (currentRequestId === requestId.current) setStats(res.data.data);
    } catch {
      if (currentRequestId === requestId.current) setError(true);
    } finally {
      if (currentRequestId === requestId.current) setLoading(false);
    }
  }, [businessId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-full bg-navy-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-8" aria-busy="true">
        <div className="mx-auto max-w-7xl">
          <div className="mb-5 flex items-center gap-2 text-sm font-medium text-primary-700" role="status">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            {t('analytics.loading')}
          </div>
          <DashboardStatsSkeleton />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-full bg-navy-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <ErrorState message={t('analytics.loadError')} onRetry={() => void load()} />
        </div>
      </div>
    );
  }
  if (!stats) {
    return (
      <div className="min-h-full bg-navy-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <NotAvailableYet label={t('dashboard.noStatisticsYet')} />
        </div>
      </div>
    );
  }

  const periodStats = stats.period_stats;
  const downloadReport = () => {
    const escapeCsv = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows: Array<Array<string | number>> = [
      [t('analytics.title'), t(`analytics.periods.${period}`)],
      [t('analytics.fromDate'), periodStats.from_date],
      [t('analytics.toDate'), periodStats.to_date],
      [],
      [t('analytics.totalVisits'), periodStats.profile_views],
      [t('analytics.interactionsOrders'), periodStats.total_orders],
      [t('dashboard.averageRating'), periodStats.average_rating],
      [t('analytics.totalReviews'), periodStats.total_reviews],
      [t('analytics.activeListings'), stats.active_listings],
      [],
      [t('analytics.visitsByDate'), t('analytics.date'), t('analytics.visitsValue')],
      ...periodStats.daily_views.map((day) => [day.date, t('analytics.visitsValue'), day.views]),
      [],
      [t('analytics.ratingDistribution'), t('analytics.reviewsValue')],
      ...[1, 2, 3, 4, 5].map((rating) => [
        t('analytics.ratingStars', { count: rating }),
        periodStats.rating_distribution[String(rating) as '1' | '2' | '3' | '4' | '5'],
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `hq-analytics-${period}-${periodStats.to_date}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const summaryCards: SummaryStatCardProps[] = [
    {
      title: t('analytics.totalVisits'),
      value: formatNumber(periodStats.profile_views),
      description: t('analytics.visitsInSelectedPeriod'),
      icon: Eye,
      accent: 'bg-sky text-primary-600',
      footer: (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
          {t(`analytics.periods.${period}`)}
        </span>
      ),
    },
    {
      title: t('analytics.interactionsOrders'),
      value: formatNumber(periodStats.total_orders),
      description: t('analytics.ordersAndCustomers', {
        orders: formatNumber(periodStats.completed_orders),
        customers: formatNumber(periodStats.total_customers),
      }),
      icon: ShoppingBag,
      accent: 'bg-emerald-50 text-emerald-600',
    },
    {
      title: t('dashboard.averageRating'),
      value: `${formatNumber(periodStats.average_rating)} / 5`,
      description: t('analytics.fromReviews', { count: formatNumber(periodStats.total_reviews) }),
      icon: Star,
      accent: 'bg-gold-50 text-gold-600',
    },
    {
      title: t('analytics.activeListings'),
      value: formatNumber(stats.active_listings),
      description: t('analytics.currentActiveListings', {
        products: formatNumber(stats.active_products),
        services: formatNumber(stats.active_services),
      }),
      icon: Store,
      accent: 'bg-violet-50 text-violet-600',
    },
  ];
  const chartLocale = intlLocaleFor(i18n.resolvedLanguage ?? i18n.language);
  const weeklyViewsChartData = periodStats.daily_views.map((day) => ({
    ...day,
    label: new Intl.DateTimeFormat(chartLocale, { month: 'short', day: 'numeric' })
      .format(new Date(`${day.date}T12:00:00Z`)),
  }));
  const ratingsChartData = [1, 2, 3, 4, 5].map((rating) => ({
    name: t('analytics.ratingStars', { count: rating }),
    reviews: periodStats.rating_distribution[String(rating) as '1' | '2' | '3' | '4' | '5'],
  }));

  return (
    <div className="min-h-full bg-navy-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-7 flex flex-col gap-4 sm:mb-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
              {t('analytics.title')}
            </h1>
            <p className="mt-1 text-sm text-navy-500">
              {t('dashboard.computedAt', { date: formatDateTime(stats.computed_at) })}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-sm font-medium text-navy-700">
              <CalendarDays className="h-4 w-4 text-navy-400" aria-hidden="true" />
              <span>{t('analytics.dateRange')}</span>
              <select
                value={period}
                onChange={(event) => setPeriod(event.target.value as typeof period)}
                className="min-h-10 rounded-button border border-navy-200 bg-white px-3 text-sm text-navy-800 shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
              >
                <option value="7d">{t('analytics.periods.7d')}</option>
                <option value="30d">{t('analytics.periods.30d')}</option>
                <option value="this_year">{t('analytics.periods.this_year')}</option>
              </select>
            </label>
            <button
              type="button"
              onClick={downloadReport}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-button bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {t('analytics.exportCsv')}
            </button>
          </div>
        </header>

        <section aria-label={t('analytics.summary')} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <SummaryStatCard key={card.title} {...card} />
          ))}
        </section>

        <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2 sm:mt-8" aria-label={t('analytics.charts')}>
          <Card className="min-w-0 p-5 sm:p-6">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-navy-900">{t('analytics.visitsByDate')}</h2>
              <p className="mt-1 text-sm text-navy-500">
                {t('analytics.periodDateRange', { from: periodStats.from_date, to: periodStats.to_date })}
              </p>
            </div>
            <div className="h-72 w-full min-w-0" role="img" aria-label={t('analytics.visitsByDate')}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyViewsChartData} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke="#e8eff7" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={12}
                    tick={{ fill: '#64748b', fontSize: 12 }}
                  />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                  <Tooltip
                    formatter={(value) => [formatNumber(Number(value)), t('analytics.visitsValue')]}
                    contentStyle={{ borderRadius: 12, borderColor: '#e8eff7' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="views"
                    name={t('analytics.visitsValue')}
                    stroke="#1E78D6"
                    strokeWidth={3}
                    dot={{ r: 4, fill: '#1E78D6', strokeWidth: 2, stroke: '#fff' }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="min-w-0 p-5 sm:p-6">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-navy-900">{t('analytics.ratingDistribution')}</h2>
              <p className="mt-1 text-sm text-navy-500">{t('analytics.fromReviews', { count: formatNumber(periodStats.total_reviews) })}</p>
            </div>
            <div className="h-72 w-full min-w-0" role="img" aria-label={t('analytics.ratingDistribution')}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ratingsChartData} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke="#e8eff7" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                  <Tooltip
                    formatter={(value) => [formatNumber(Number(value)), t('analytics.reviewsValue')]}
                    contentStyle={{ borderRadius: 12, borderColor: '#e8eff7' }}
                  />
                  <Bar dataKey="reviews" name={t('analytics.reviewsValue')} fill="#FFC83D" radius={[6, 6, 0, 0]} maxBarSize={44}>
                    {ratingsChartData.map((entry, index) => (
                      <Cell key={entry.name} fill={index === 4 ? '#f5b022' : '#FFC83D'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </section>

        <Card className="mt-6 flex items-start gap-3 border-primary-100 bg-white p-4 sm:mt-8 sm:p-5">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky text-primary-600">
            <TrendingUp className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-navy-900">{t('analytics.unavailableTitle')}</h2>
            <p className="mt-1 text-sm leading-6 text-navy-500">{t('analytics.gapReason')}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}