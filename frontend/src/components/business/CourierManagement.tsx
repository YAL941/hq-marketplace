import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus, UserRound, UserRoundX } from 'lucide-react';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { Input } from '../common/Input';
import { businessApi, toFieldIssue, type FieldIssue } from '../../services/api';
import type { BusinessCourier, Id } from '../../types';

export function CourierManagement({ businessId }: { businessId: Id }) {
  const { t } = useTranslation();
  const [couriers, setCouriers] = useState<BusinessCourier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [issue, setIssue] = useState<FieldIssue | null>(null);
  const [notice, setNotice] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busyCourierId, setBusyCourierId] = useState<Id | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await businessApi.listCouriers(businessId);
      setCouriers(response.data.data);
    } catch (error) {
      setIssue(toFieldIssue(error));
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createCourier = async (event: React.FormEvent) => {
    event.preventDefault();
    setIssue(null);
    setNotice('');
    if (fullName.trim().length < 2 || password.length < 8 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setIssue({ message: t('settings.courierInvalid') });
      return;
    }
    setSaving(true);
    try {
      await businessApi.createCourier(businessId, {
        fullName: fullName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        password,
      });
      setFullName('');
      setEmail('');
      setPhone('');
      setPassword('');
      setNotice(t('settings.courierCreated'));
      await load();
    } catch (error) {
      setIssue(toFieldIssue(error));
    } finally {
      setSaving(false);
    }
  };

  const toggleCourier = async (courier: BusinessCourier) => {
    setIssue(null);
    setBusyCourierId(courier.business_courier_id);
    try {
      await businessApi.setCourierActive(businessId, courier.business_courier_id, !courier.active);
      await load();
    } catch (error) {
      setIssue(toFieldIssue(error));
    } finally {
      setBusyCourierId(null);
    }
  };

  return (
    <Card className="mt-6 p-5 sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
          <UserRound className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-navy-900">{t('settings.couriersTitle')}</h2>
          <p className="mt-1 text-sm text-navy-500">{t('settings.couriersDescription')}</p>
        </div>
      </div>

      {issue && (
        <p className="mb-4 rounded-button border border-error-200 bg-error-50 p-3 text-sm text-error-700" role="alert">
          {issue.message || t('common.saveFailed')}
        </p>
      )}
      {notice && (
        <p className="mb-4 rounded-button border border-success-200 bg-success-50 p-3 text-sm text-success-700" role="status">
          {notice}
        </p>
      )}

      <form onSubmit={createCourier} className="grid gap-4 sm:grid-cols-2">
        <Input label={t('settings.courierName')} value={fullName} onChange={(event) => setFullName(event.target.value)} required maxLength={200} />
        <Input label={t('settings.courierEmail')} type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} />
        <Input label={t('settings.courierPhone')} type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={30} />
        <Input label={t('settings.courierPassword')} type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete="new-password" />
        <div className="sm:col-span-2">
          <p className="mb-3 text-xs text-navy-500">{t('settings.courierCredentialsNote')}</p>
          <Button type="submit" disabled={saving}>
            <UserPlus className="me-2 h-4 w-4" aria-hidden="true" />
            {saving ? t('common.saving') : t('settings.createCourier')}
          </Button>
        </div>
      </form>

      <div className="mt-7 border-t border-navy-100 pt-5">
        <h3 className="mb-3 font-semibold text-navy-900">{t('settings.courierList')}</h3>
        {loading ? (
          <p className="text-sm text-navy-500">{t('common.loading')}</p>
        ) : couriers.length === 0 ? (
          <p className="text-sm text-navy-500">{t('settings.courierEmpty')}</p>
        ) : (
          <ul className="divide-y divide-navy-100">
            {couriers.map((courier) => (
              <li key={courier.business_courier_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-navy-900">{courier.full_name}</p>
                  <p className="break-all text-sm text-navy-500">{courier.email}{courier.phone ? ` · ${courier.phone}` : ''}</p>
                  <p className={`mt-1 text-xs font-medium ${courier.active ? 'text-success-700' : 'text-navy-500'}`}>
                    {courier.active ? t('settings.courierActive') : t('settings.courierInactive')}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyCourierId === courier.business_courier_id}
                  onClick={() => void toggleCourier(courier)}
                >
                  <UserRoundX className="me-2 h-4 w-4" aria-hidden="true" />
                  {courier.active ? t('settings.disableCourier') : t('settings.enableCourier')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
