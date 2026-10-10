import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle, Clock, RefreshCw, ChevronDown, Bell, Search } from 'lucide-react';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Input } from '../components/common/Input';
import { EmptyState } from '../components/common/EmptyState';
import { TableSkeleton } from '../components/common/Skeleton';
import { adminApi } from '../services/api';
import { formatDate, formatDateTime, cn, getStatusLabel } from '../lib/utils';
import { isAxiosError } from 'axios';
import type {
  AdminBusinessCounts,
  AdminBusinessFilter,
  AdminBusinessNotifications,
  AdminBusinessRow,
  PageMeta,
} from '../types';

const PAGE_SIZE = 20;
const STATUS_TABS: AdminBusinessFilter[] = ['all', 'pending', 'active', 'rejected'];
const EMPTY_COUNTS: AdminBusinessCounts = { all: 0, pending: 0, active: 0, rejected: 0 };

interface Toast {
  id: number;
  message: string;
  kind: 'success' | 'error' | 'warning';
}

type Decision = 'approve' | 'reject';

interface RowAction {
  row: AdminBusinessRow;
  decision: Decision;
  reason: string;
  committing: boolean;
  error: string | null;
}

function iconForStatus(status: string) {
  if (status === 'active') return <CheckCircle className="w-4 h-4 text-success-600" />;
  if (status === 'rejected') return <XCircle className="w-4 h-4 text-error-600" />;
  return <Clock className="w-4 h-4 text-warning-600" />;
}

function statusBadgeVariant(status: string): 'success' | 'warning' | 'danger' {
  if (status === 'active') return 'success';
  if (status === 'rejected') return 'danger';
  return 'warning';
}

function verificationBadgeVariant(status: string): 'success' | 'warning' | 'danger' | 'verified' {
  if (status === 'verified') return 'verified';
  if (status === 'rejected') return 'danger';
  return 'warning';
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function relativeTime(value: string, language: string): string {
  const ageSeconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  const locale = language.startsWith('ar') ? 'ar' : language.startsWith('so') ? 'so' : 'en';
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, seconds] of units) {
    if (Math.abs(ageSeconds) >= seconds) return formatter.format(Math.round(ageSeconds / seconds), unit);
  }
  return formatter.format(0, 'minute');
}

function DetailsPanel({ row }: { row: AdminBusinessRow }) {
  const { t } = useTranslation();
  const fields: Array<[string, string | null]> = [
    [t('admin.businessName'), row.business_name],
    [t('admin.category'), row.category_name ?? t('admin.noCategory')],
    [
      t('admin.location'),
      [row.address, row.city, row.district].filter(Boolean).join(', ') || t('admin.noCity'),
    ],
    [t('admin.contact'), row.email ?? row.phone ?? row.whatsapp_number ?? t('admin.noContact')],
    [
      t('admin.owner'),
      row.owner_full_name
        ? `${row.owner_full_name}${row.owner_email ? ` (${row.owner_email})` : ''}`
        : t('admin.noOwner'),
    ],
    [t('admin.submitted'), formatDate(row.created_at)],
    [t('admin.verified'), row.verified_at ? formatDateTime(row.verified_at) : '—'],
  ];
  if (row.rejection_reason) {
    fields.push([t('admin.rejectReasonLabel'), row.rejection_reason]);
  }

  return (
    <Card padding="md" className="bg-navy-50">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {fields.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <span className="font-medium text-navy-600">{label}:</span>
            <span className="text-navy-600 break-words">{value ?? '—'}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Toast({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
  return (
    <div
      className={cn(
        'fixed bottom-4 start-4 max-w-sm rounded-card border px-4 py-3 shadow-card text-sm',
        toast.kind === 'success'
          ? 'bg-success-50 text-success-700 border-success-200'
          : toast.kind === 'warning'
            ? 'bg-gold-50 text-navy-800 border-gold-200'
            : 'bg-error-50 text-error-700 border-error-200',
      )}
    >
      {toast.message}
      <button
        type="button"
        onClick={onRemove}
        className="absolute end-2 top-2 text-navy-400 hover:text-navy-600"
        aria-label="Dismiss"
      >
        x
      </button>
    </div>
  );
}

export function AdminBusinessesPage() {
  const { t, i18n } = useTranslation();

  const [activeTab, setActiveTab] = useState<AdminBusinessFilter>('pending');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [businesses, setBusinesses] = useState<AdminBusinessRow[]>([]);
  const [counts, setCounts] = useState<AdminBusinessCounts>(EMPTY_COUNTS);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [action, setAction] = useState<RowAction | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notifications, setNotifications] = useState<AdminBusinessNotifications | null>(null);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationError, setNotificationError] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);
  const previousUnreadCount = useRef(0);
  const [badgePulse, setBadgePulse] = useState(false);

  const showToast = useCallback((message: string, kind: Toast['kind']) => {
    const timer = window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== timer));
    }, 4000);
    setToasts((current) => [...current, { id: Number(timer), message, kind }]);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await adminApi.listBusinesses({
        status: activeTab,
        search,
        page,
        limit: PAGE_SIZE,
      });
      setBusinesses(res.data.data);
      setCounts(res.data.counts ?? EMPTY_COUNTS);
      setMeta((res.data.meta ?? null) as PageMeta | null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [activeTab, page, search]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const refreshNotifications = useCallback(async () => {
    try {
      const response = await adminApi.getBusinessNotifications();
      setNotifications(response.data.data);
      setNotificationError(false);
      if (response.data.data.unreadCount > previousUnreadCount.current) {
        setBadgePulse(true);
        window.setTimeout(() => setBadgePulse(false), 700);
      }
      previousUnreadCount.current = response.data.data.unreadCount;
    } catch {
      setNotificationError(true);
    }
  }, []);

  useEffect(() => {
    void refreshNotifications();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshNotifications();
    }, 30_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshNotifications();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshNotifications]);

  useEffect(() => {
    if (!notificationOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !notificationRef.current?.contains(event.target)) {
        setNotificationOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNotificationOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [notificationOpen]);

  useEffect(() => {
    if (!action) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !action.committing) setAction(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [action]);

  const switchTab = (status: AdminBusinessFilter) => {
    setActiveTab(status);
    setPage(1);
    setAction(null);
  };

  const closeAction = () => setAction(null);
  const openNotifications = async () => {
    setNotificationOpen((isOpen) => !isOpen);
    if (notificationOpen) return;
    try {
      await adminApi.markBusinessNotificationsSeen();
      await refreshNotifications();
    } catch {
      setNotificationError(true);
    }
  };
  const viewPending = () => {
    setNotificationOpen(false);
    switchTab('pending');
  };

  const beginApprove = (row: AdminBusinessRow) => {
    setAction({ row, decision: 'approve', reason: '', committing: false, error: null });
  };
  const beginReject = (row: AdminBusinessRow) => {
    setAction({ row, decision: 'reject', reason: '', committing: false, error: null });
  };

  const updateRow = (row: AdminBusinessRow, decision: Decision, reason: string) => {
    setBusinesses((current) =>
      current.map((b) => {
        if (b.business_id !== row.business_id) return b;
        return {
          ...b,
          ...(decision === 'approve'
            ? {
              status: 'active',
                verification_status: 'verified',
                is_verified: true,
                verified_at: new Date().toISOString(),
                rejection_reason: null,
              }
            : {
                status: 'rejected',
                verification_status: 'rejected',
                is_verified: false,
                verified_at: null,
                rejection_reason: reason,
              }),
        };
      }),
    );
  };

  const commit = async () => {
    if (!action) return;
    const { row, decision, reason } = action;
    setAction((prev) => prev && { ...prev, committing: true, error: null });
    try {
      const result = await adminApi.setBusinessStatus(row.business_id, {
        status: decision === 'approve' ? 'active' : 'rejected',
        reason,
      });
      updateRow(row, decision, reason);
      showToast(
        t(result.data.email.sent ? 'admin.successEmailSent' : 'admin.successEmailFailed', {
          name: row.business_name,
        }),
        result.data.email.sent ? 'success' : 'warning',
      );
      setAction(null);
      void load();
      void refreshNotifications();
    } catch (err) {
      if (isAxiosError(err)) {
        const status = err.response?.status;
        const message = err.response?.data?.error?.message;
        if (status === 409) {
          setAction(null);
          showToast(t('admin.errorAlreadyReviewed'), 'error');
          void load();
          return;
        }
        if (status === 400) {
          setAction((prev) => prev && { ...prev, committing: false, error: message ?? t('admin.errorReason') });
          return;
        }
        if (status === 403) {
          setAction((prev) =>
            prev && {
              ...prev,
              committing: false,
              error: decision === 'approve' ? t('admin.errorApprove') : t('admin.errorReject'),
            },
          );
          return;
        }
        if (status === 404) {
          setBusinesses((current) => current.filter((b) => b.business_id !== row.business_id));
          setAction(null);
          showToast(t('admin.errorNotFound'), 'error');
          return;
        }
      }
      setAction((prev) => prev && { ...prev, committing: false, error: t('errors.unknown') });
    }
  };

  const handleReasonChange = (value: string) =>
    setAction((prev) => prev && { ...prev, reason: value.slice(0, 500), error: null });

  const renderActionCell = (row: AdminBusinessRow) => {
    const open = action?.row.business_id === row.business_id;

    if (!open) {
      return (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => beginApprove(row)}>
            {t('admin.approve')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => beginReject(row)}>
            {t('admin.reject')}
          </Button>
          <button
            type="button"
            onClick={() => setSelectedId(selectedId === row.business_id ? null : row.business_id)}
            className="p-1 rounded-button hover:bg-navy-100 text-navy-600"
            aria-label={selectedId === row.business_id ? t('admin.hideDetails') : t('admin.viewDetails')}
          >
            <ChevronDown
              className={cn('w-4 h-4 transition-transform', selectedId === row.business_id && 'rotate-180')}
            />
          </button>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-navy-900">{t('admin.title')}</h1>
        <div className="flex items-center gap-2">
          <div className="relative" ref={notificationRef}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void openNotifications()}
              aria-label={t('admin.notifications')}
              aria-expanded={notificationOpen}
              aria-haspopup="true"
              className="relative"
            >
              <Bell className="w-5 h-5" />
              {!!notifications?.unreadCount && (
                <span
                  className={cn(
                    'absolute -top-1 -end-1 min-w-5 h-5 px-1 rounded-full bg-error-500 text-white text-xs flex items-center justify-center',
                    badgePulse && 'animate-bounce',
                  )}
                >
                  {notifications.unreadCount > 99 ? '99+' : notifications.unreadCount}
                </span>
              )}
            </Button>
            {notificationOpen && (
              <div
                className="absolute end-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-card border border-navy-200 bg-white p-3 shadow-card animate-slide-down"
                role="dialog"
                aria-label={t('admin.notifications')}
              >
                <div className="flex items-center justify-between gap-3 border-b border-navy-100 pb-2">
                  <h2 className="font-semibold text-navy-900">{t('admin.recentRegistrations')}</h2>
                  <span className="text-xs text-navy-500">{t('admin.unreadCount', { count: notifications?.unreadCount ?? 0 })}</span>
                </div>
                {notificationError ? (
                  <p className="py-4 text-sm text-error-600" role="alert">{t('admin.notificationsError')}</p>
                ) : notifications?.recent.length ? (
                  <ul className="max-h-80 overflow-y-auto divide-y divide-navy-100">
                    {notifications.recent.map((item) => (
                      <li key={item.business_id}>
                        <button
                          type="button"
                          className="flex w-full items-start gap-3 py-3 text-start hover:bg-navy-50"
                          onClick={() => {
                            setNotificationOpen(false);
                            setSearchInput(item.business_name);
                            setActiveTab('all');
                            setPage(1);
                          }}
                        >
                          <span className={cn('mt-2 h-2 w-2 shrink-0 rounded-full', item.is_new ? 'bg-primary-600' : 'bg-transparent')} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-navy-900">{item.business_name}</span>
                            <span className="block text-xs text-navy-500">
                              {relativeTime(item.created_at, i18n.language)} · {getStatusLabel(item.status)}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-5 text-center text-sm text-navy-500">{t('admin.noNotifications')}</p>
                )}
                <Button variant="outline" size="sm" className="mt-2 w-full" onClick={viewPending}>
                  {t('admin.viewAllPending')}
                </Button>
              </div>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => void load()} aria-label={t('common.retry')}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="mb-5 max-w-xl">
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value.slice(0, 120))}
          placeholder={t('admin.searchPlaceholder')}
          aria-label={t('admin.searchPlaceholder')}
          maxLength={120}
          leftIcon={<Search className="h-4 w-4" />}
        />
      </div>

      <nav className="flex flex-wrap items-center gap-2 mb-6" aria-label={t('nav.dashboardNavigation')}>
        {STATUS_TABS.map((status) => {
          const isActive = activeTab === status;
          return (
            <button
              key={status}
              type="button"
              onClick={() => switchTab(status)}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-button transition-colors',
                isActive ? 'bg-primary-600 text-white' : 'text-navy-600 hover:bg-navy-100',
              )}
            >
              {status !== 'all' && iconForStatus(status)}
              <span className="ms-2">{t(`admin.${status}Tab`)}</span>
              <span className={cn('ms-2 rounded-full px-2 py-0.5 text-xs', isActive ? 'bg-white/20' : 'bg-navy-100')}>
                {counts[status]}
              </span>
            </button>
          );
        })}
      </nav>

      {loading ? (
        <TableSkeleton rows={8} />
      ) : error ? (
        <EmptyState
          title={t('admin.errorLoad')}
          description={t('errors.network')}
          action={
            <Button variant="outline" onClick={() => void load()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : businesses.length === 0 ? (
        <EmptyState title={search ? t('admin.noResults') : t(`admin.empty${capitalize(activeTab)}`)} />
      ) : (
        <>
          <div className="hidden sm:block">
            <table className="w-full text-sm text-start text-navy-700">
              <thead className="bg-navy-50 text-xs font-medium text-navy-500 uppercase">
                <tr>
                  <th className="px-4 py-3">{t('admin.businessName')}</th>
                  <th className="px-4 py-3">{t('admin.category')}</th>
                  <th className="px-4 py-3">{t('admin.location')}</th>
                  <th className="px-4 py-3">{t('admin.contact')}</th>
                  <th className="px-4 py-3">{t('admin.status')}</th>
                  <th className="px-4 py-3">{t('admin.verification')}</th>
                  <th className="px-4 py-3">{t('admin.owner')}</th>
                  <th className="px-4 py-3">{t('admin.submitted')}</th>
                  <th className="px-4 py-3 text-center">{t('admin.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-200">
                {businesses.map((row) => (
                  <tr key={row.business_id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-navy-900">{row.business_name}</div>
                      <div className="text-xs text-navy-500">{row.business_slug}</div>
                    </td>
                    <td className="px-4 py-3">{row.category_name ?? t('admin.noCategory')}</td>
                    <td className="px-4 py-3">
                      {[row.city, row.district].filter(Boolean).join(', ') || t('admin.noCity')}
                    </td>
                    <td className="px-4 py-3">
                      {row.email ?? row.phone ?? row.whatsapp_number ?? t('admin.noContact')}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusBadgeVariant(row.status)}>{getStatusLabel(row.status)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={verificationBadgeVariant(row.verification_status)}>
                        {getStatusLabel(row.verification_status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {row.owner_full_name
                        ? `${row.owner_full_name}${row.owner_email ? ` (${row.owner_email})` : ''}`
                        : t('admin.noOwner')}
                    </td>
                    <td className="px-4 py-3">{formatDate(row.created_at)}</td>
                    <td className="px-4 py-3">{renderActionCell(row)}</td>
                    {selectedId === row.business_id && (
                      <tr>
                        <td colSpan={9} className="px-4 py-3">
                          <DetailsPanel row={row} />
                        </td>
                      </tr>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="sm:hidden space-y-4">
            {businesses.map((row) => (
              <Card key={row.business_id} padding="md" className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium text-navy-900">{row.business_name}</div>
                    <div className="text-xs text-navy-500">{row.business_slug}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedId(selectedId === row.business_id ? null : row.business_id)}
                    className="p-1 rounded-button hover:bg-navy-100 text-navy-600"
                    aria-label={selectedId === row.business_id ? t('admin.hideDetails') : t('admin.viewDetails')}
                  >
                    <ChevronDown
                      className={cn('w-4 h-4', selectedId === row.business_id && 'rotate-180')}
                    />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={statusBadgeVariant(row.status)}>{getStatusLabel(row.status)}</Badge>
                  <Badge variant={verificationBadgeVariant(row.verification_status)}>
                    {getStatusLabel(row.verification_status)}
                  </Badge>
                </div>
                <div className="text-xs text-navy-500">
                  {row.category_name ?? t('admin.noCategory')} ·{' '}
                  {[row.city, row.district].filter(Boolean).join(', ') || t('admin.noCity')}
                </div>
                <div className="text-xs text-navy-500">
                  {row.email ?? row.phone ?? row.whatsapp_number ?? t('admin.noContact')}
                </div>
                <div className="text-xs text-navy-500">{formatDate(row.created_at)}</div>
                {selectedId === row.business_id && <DetailsPanel row={row} />}
                {renderActionCell(row)}
              </Card>
            ))}
          </div>

          {meta && (
            <div className="flex items-center justify-between mt-6">
              <span className="text-sm text-navy-500">
                {t('admin.pageInfo', { page: meta.page, totalPages: meta.totalPages })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={!meta.hasPrevious}
                >
                  {t('admin.previous')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!meta.hasNext}
                >
                  {t('admin.next')}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          toast={toast}
          onRemove={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
        />
      ))}

      {action && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !action.committing) closeAction();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="business-review-title"
            className="w-full max-w-lg rounded-card bg-white p-6 shadow-card"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="business-review-title" className="text-lg font-semibold text-navy-900">
              {t(action.decision === 'approve' ? 'admin.approveConfirm' : 'admin.rejectConfirm')}
            </h2>
            <p className="mt-2 text-sm text-navy-600">
              {action.decision === 'approve'
                ? t('admin.approveConfirmBody')
                : action.row.business_name}
            </p>
            {action.decision === 'reject' && (
              <div className="mt-4">
                <label htmlFor="business-rejection-reason" className="text-sm font-medium text-navy-700">
                  {t('admin.rejectReasonLabel')}
                </label>
                <textarea
                  id="business-rejection-reason"
                  value={action.reason}
                  onChange={(event) => handleReasonChange(event.target.value)}
                  placeholder={t('admin.rejectReasonPlaceholder')}
                  className="mt-1 w-full rounded-button border border-navy-300 bg-white px-3 py-2 text-sm text-navy-900 resize-y focus:outline-none focus:ring-2 focus:ring-primary-500"
                  rows={4}
                  maxLength={500}
                  disabled={action.committing}
                  autoFocus
                />
                <p className="mt-1 text-xs text-navy-500">{t('admin.rejectReasonHint')} ({action.reason.length}/500)</p>
              </div>
            )}
            {action.error && <p className="mt-3 text-sm text-error-600" role="alert">{action.error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={closeAction} disabled={action.committing}>
                {t('admin.cancel')}
              </Button>
              <Button
                size="sm"
                variant={action.decision === 'approve' ? 'primary' : 'danger'}
                loading={action.committing}
                onClick={() => void commit()}
                autoFocus={action.decision === 'approve'}
              >
                {t(action.decision === 'approve' ? 'admin.approveConfirmAction' : 'admin.rejectConfirmAction')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
