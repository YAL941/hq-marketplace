import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, RefreshCw, XCircle } from 'lucide-react';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { toFieldIssue, wholesaleAdminApi } from '../services/api';
import type { WholesaleSupplierApplication } from '../types';

export function AdminWholesaleSuppliersPage() {
  const { t } = useTranslation();
  const [applications, setApplications] = useState<WholesaleSupplierApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await wholesaleAdminApi.applications('pending');
      setApplications(response.data.data);
    } catch (requestError) {
      setError(toFieldIssue(requestError).message || t('wholesale.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (application: WholesaleSupplierApplication, status: 'approved' | 'rejected') => {
    setBusy(application.business_id);
    setError('');
    try {
      await wholesaleAdminApi.reviewApplication(application.business_id, status);
      await load();
    } catch (requestError) {
      setError(toFieldIssue(requestError).message || t('wholesale.saveError'));
    } finally {
      setBusy('');
    }
  };

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">{t('wholesale.adminTitle')}</h1>
          <p className="mt-1 text-sm text-navy-600">{t('wholesale.adminDescription')}</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />{t('wholesale.refresh')}
        </Button>
      </header>
      {error && <p role="alert" className="rounded-lg bg-error-50 p-3 text-sm text-error-700">{error}</p>}
      {loading ? <p className="text-sm text-navy-500">{t('wholesale.loading')}</p> : applications.length === 0 ? (
        <Card><p className="text-sm text-navy-600">{t('wholesale.noApplications')}</p></Card>
      ) : (
        <div className="space-y-3">
          {applications.map((application) => (
            <Card key={application.business_id} className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-navy-900">{application.business_name}</h2>
                  <Badge variant="warning">{t('wholesale.supplierStatus.pending')}</Badge>
                </div>
                <p className="mt-1 text-sm text-navy-600">{[application.city, application.email, application.phone].filter(Boolean).join(' · ')}</p>
                {application.description && <p className="mt-2 max-w-3xl text-sm text-navy-700">{application.description}</p>}
              </div>
              <div className="flex gap-2">
                <Button size="sm" loading={busy === application.business_id} onClick={() => void review(application, 'approved')}>
                  <BadgeCheck size={16} />{t('wholesale.approve')}
                </Button>
                <Button size="sm" variant="outline" disabled={busy === application.business_id} onClick={() => void review(application, 'rejected')}>
                  <XCircle size={16} />{t('wholesale.rejectApplication')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
