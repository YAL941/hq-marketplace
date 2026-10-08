import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle, Clock, RefreshCw, ChevronDown } from 'lucide-react';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { EmptyState } from '../components/common/EmptyState';
import { TableSkeleton } from '../components/common/Skeleton';
import { adminApi } from '../services/api';
import { formatDate, formatDateTime, cn, getStatusLabel } from '../lib/utils';
import { isAxiosError } from 'axios';
import type { AdminBusinessRow, AdminBusinessStatus, PageMeta } from '../types';

const PAGE_SIZE = 20;
const STATUS_TABS: AdminBusinessStatus[] = ['pending', 'active', 'rejected'];
const REASON_MIN_LENGTH = 5;

interface Toast {
  id: number;
  message: string;
  kind: 'success' | 'error';
}

type Decision = 'approve' | 'reject';

interface RowAction {
  row: AdminBusinessRow;
  decision: Decision;
  reason: string;
  committing: boolean;
  noop: boolean;
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
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<AdminBusinessStatus>('pending');
  const [page, setPage] = useState(1);
  const [businesses, setBusinesses] = useState<AdminBusinessRow[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [action, setAction] = useState<RowAction | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, kind: 'success' | 'error') => {
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
        page,
        limit: PAGE_SIZE,
      });
      setBusinesses(res.data.data);
      setMeta((res.data.meta ?? null) as PageMeta | null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [activeTab, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const switchTab = (status: AdminBusinessStatus) => {
    setActiveTab(status);
    setPage(1);
    setAction(null);
  };

  const closeAction = () => setAction(null);

  const beginApprove = (row: AdminBusinessRow) => {
    setAction({ row, decision: 'approve', reason: '', committing: false, noop: false, error: null });
  };
  const beginReject = (row: AdminBusinessRow) => {
    setAction({ row, decision: 'reject', reason: '', committing: false, noop: false, error: null });
  };

  const updateRow = (row: AdminBusinessRow, decision: Decision, reason: string) => {
    setBusinesses((current) =>
      current.map((b) => {
        if (b.business_id !== row.business_id) return b;
        return {
          ...b,
          ...(decision === 'approve'
            ? {
                status: 'active' as AdminBusinessStatus,
                verification_status: 'verified',
                is_verified: true,
                verified_at: new Date().toISOString(),
                rejection_reason: null,
              }
            : {
                status: 'rejected' as AdminBusinessStatus,
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
    const { row, decision, reason, noop } = action;
    setAction((prev) => prev && { ...prev, committing: true, error: null });
    try {
      await adminApi.decideVerification(row.business_id, {
        decision,
        reason,
        force: noop,
      });
      updateRow(row, decision, reason);
      showToast(
        decision === 'approve' ? t('admin.successApprove', { name: row.business_name }) : t('admin.successReject', { name: row.business_name }),
        'success',
      );
      setAction(null);
      void load();
    } catch (err) {
      if (isAxiosError(err)) {
        const status = err.response?.status;
        const message = err.response?.data?.error?.message;
        if (status === 409) {
          setAction((prev) => prev && { ...prev, committing: false, noop: true, error: null });
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

  const handleReasonChange = (value: string) => {
    setAction((prev) => prev && { ...prev, reason: value, error: null });
  };

  const reasonValid = (action?.reason?.trim().length ?? 0) >= REASON_MIN_LENGTH;

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

    const { decision, committing, noop, error: actionError } = action;
    const confirmingApprove = decision === 'approve' && !noop;
    const confirmingReject = decision === 'reject' && !noop;
    const forceApprove = decision === 'approve' && noop;
    const forceReject = decision === 'reject' && noop;

    return (
      <div className="flex flex-col gap-3 min-w-[240px]">
        {confirmingApprove && (
          <>
            <p className="text-sm text-navy-700">{t('admin.approveConfirmBody')}</p>
            {actionError && <p className="text-sm text-error-600">{actionError}</p>}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={closeAction} disabled={committing}>
                {t('admin.cancel')}
              </Button>
              <Button size="sm" variant="primary" loading={committing} onClick={commit}>
                {t('admin.approveConfirmAction')}
              </Button>
            </div>
          </>
        )}

        {confirmingReject && (
          <>
            <label className="text-sm font-medium text-navy-700">{t('admin.rejectReasonLabel')}</label>
            <textarea
              value={action.reason}
              onChange={(e) => handleReasonChange(e.target.value)}
              placeholder={t('admin.rejectReasonPlaceholder')}
              className="w-full rounded-button border border-navy-300 bg-white px-3 py-2 text-sm text-navy-900 resize-y-none focus:outline-none focus:ring-2 focus:ring-primary-500"
              rows={3}
              maxLength={500}
              disabled={committing}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-navy-500">
                {t('admin.rejectReasonHint')} ({action.reason.trim().length}/{REASON_MIN_LENGTH})
              </span>
              {actionError && <p className="text-sm text-error-600">{actionError}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={closeAction} disabled={committing}>
                {t('admin.cancel')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                loading={committing}
                disabled={!reasonValid}
                onClick={commit}
              >
                {t('admin.rejectConfirmAction')}
              </Button>
            </div>
          </>
        )}

        {forceApprove && (
          <>
            <p className="text-sm text-navy-700">{t('admin.alreadyVerifiedBody')}</p>
            <Button size="sm" variant="primary" loading={committing} onClick={commit}>
              {t('admin.forceApprove')}
            </Button>
          </>
        )}

        {forceReject && (
          <>
            <p className="text-sm text-navy-700">{t('admin.alreadyRejectedBody')}</p>
            <Button size="sm" variant="danger" loading={committing} onClick={commit}>
              {t('admin.forceReject')}
            </Button>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-navy-900">{t('admin.title')}</h1>
        <Button size="sm" variant="ghost" onClick={() => void load()} aria-label={t('common.retry')}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      <nav className="flex items-center gap-2 mb-6" aria-label={t('nav.dashboardNavigation')}>
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
              {iconForStatus(status)}
              <span className="ms-2">{t(`admin.${status}Tab`)}</span>
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
        <EmptyState title={t(`admin.empty${capitalize(activeTab)}`)} />
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
    </div>
  );
}
