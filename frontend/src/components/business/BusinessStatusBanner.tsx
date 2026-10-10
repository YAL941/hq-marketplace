import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, LifeBuoy } from 'lucide-react';
import { businessApi } from '../../services/api';
import { cn } from '../../lib/utils';
import type { Id, StaffBusinessProfile } from '../../types';

/**
 * The business's verification state, said once at the top of every dashboard
 * screen.
 *
 * The reason this exists is that "listed" and "registered" are different states,
 * and the dashboard is reachable in both. A business registered ten minutes ago
 * has a working dashboard and no public page, and without this the two look
 * identical from inside. So the banner states which one it is, from the fields
 * the staff read returns and nothing else:
 *
 *   rejected -> the reason, which only an admin can set
 *   pending  -> under review, not visible to the public yet
 *   live     -> verified and active, with a link to the public page
 *   anything else (suspended, closed) -> the status the API returned, labelled
 *
 * It renders nothing while loading and nothing when the read fails. A dashboard
 * that cannot load its statistics has a larger problem to report, and a banner
 * that guessed would be worse than an absent one.
 */
export function BusinessStatusBanner({ businessId }: { businessId: Id }) {
  const { t } = useTranslation();
  const [business, setBusiness] = useState<StaffBusinessProfile | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    try {
      const res = await businessApi.getForBusiness(businessId);
      setBusiness(res.data.data);
    } catch {
      setBusiness(null);
    }
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!business) return null;

  const rejected = business.status === 'rejected' || business.verification_status === 'rejected';
  const pending = !rejected && (business.status === 'pending' || business.verification_status === 'pending');
  const live = !rejected && !pending && business.status === 'active' && business.is_verified;

  if (rejected) {
    return (
      <div
        role="status"
        className="business-status-banner flex flex-col items-start gap-2 border-b border-error-600/20 bg-error-50 px-4 py-3 sm:flex-row sm:gap-3 sm:px-6"
      >
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-error-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-error-700">{t('statusBanner.rejectedTitle')}</p>
          {business.rejection_reason && (
            <p className="mt-0.5 break-words text-sm text-error-700">{business.rejection_reason}</p>
          )}
          <p className="text-xs text-error-600 mt-1">{t('statusBanner.rejectedHint')}</p>
          <Link
            to="/dashboard/settings"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-error-700 underline underline-offset-4 mt-2"
          >
            <LifeBuoy className="w-4 h-4" aria-hidden="true" />
            {t('statusBanner.fixDetails')}
          </Link>
        </div>
      </div>
    );
  }

  if (pending) {
    return (
      <div role="status" className="business-status-banner flex items-start gap-3 border-b border-warning-600/20 bg-warning-50 px-4 py-3 sm:px-6">
        <Clock className="w-5 h-5 text-warning-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-navy-900">{t('statusBanner.pendingTitle')}</p>
          <p className="text-xs text-navy-600 mt-0.5">{t('statusBanner.pendingBody')}</p>
        </div>
      </div>
    );
  }

  if (live) {
    return (
      <div role="status" className="business-status-banner business-status-banner--live flex flex-col items-stretch gap-3 border-b border-success-600/20 bg-success-50 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-6">
        <span className="inline-flex min-h-9 w-fit items-center gap-2 rounded-full border border-success-600/20 bg-white px-3 py-1.5 text-sm font-semibold text-success-600 shadow-sm">
          <CheckCircle2 className="h-4 w-4 text-success-600" aria-hidden="true" />
          {t('statusBanner.liveLabel')}
        </span>
        <p className="w-full text-sm leading-5 text-navy-600 sm:min-w-0 sm:flex-1">{t('statusBanner.liveBody')}</p>
        <Link
          to={`/business/${business.business_slug}`}
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-success-600/20 bg-white px-3.5 text-sm font-semibold text-success-600 shadow-sm transition hover:border-success-600 hover:bg-success-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success-600 sm:w-auto"
        >
          {t('statusBanner.viewPublic')}
          <ExternalLink className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  /**
   * `suspended` and `closed` are states the database allows and nothing in the
   * API currently sets. If one ever arrives, it is labelled with the status the
   * server sent rather than being rounded off to "active" or hidden.
   */
  return (
    <div
      role="status"
      className={cn(
        'business-status-banner flex items-center gap-3 border-b border-navy-200 bg-navy-100 px-4 py-3 sm:px-6'
      )}
    >
      <AlertTriangle className="w-5 h-5 text-navy-500 flex-shrink-0" aria-hidden="true" />
      <p className="text-sm text-navy-700">
        <span className="font-semibold">{t('statusBanner.otherTitle')}</span>{' '}
        <span className="capitalize">{t(`status.${business.status}`, { defaultValue: business.status })}</span>
      </p>
    </div>
  );
}