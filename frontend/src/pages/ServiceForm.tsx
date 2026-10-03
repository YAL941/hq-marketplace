import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { Skeleton } from '../components/common/Skeleton';
import { serviceApi, toFieldIssue, type FieldIssue } from '../services/api';
import type { CatalogueStatus, Id, Service } from '../types';

const STATUSES: CatalogueStatus[] = ['draft', 'active', 'inactive', 'archived'];

interface FormState {
  serviceName: string;
  description: string;
  price: string;
  currency: string;
  durationMinutes: string;
  capacity: string;
  isBookable: boolean;
  status: CatalogueStatus;
}

/** Create and edit in one component; the route decides which by `:serviceId`. */
export function ServiceFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ businessId: Id; serviceId: Id }>();
  const serviceId = params.serviceId ?? '';
  const isEdit = serviceId !== '';
  const businessId = params.businessId ?? '';

  const [form, setForm] = useState<FormState>({
    serviceName: '',
    description: '',
    price: '',
    currency: 'USD',
    durationMinutes: '',
    capacity: '',
    isBookable: false,
    status: 'draft',
  });
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [issue, setIssue] = useState<FieldIssue | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadFailed(false);
      try {
        const res = await serviceApi.getForBusiness(businessId, serviceId);
        if (cancelled) return;
        const s: Service = res.data.data;
        setForm({
          serviceName: s.service_name,
          description: s.description ?? '',
          price: s.price,
          currency: s.currency,
          durationMinutes: s.duration_minutes === null ? '' : String(s.duration_minutes),
          capacity: s.capacity === null ? '' : String(s.capacity),
          isBookable: s.is_bookable,
          status: s.status,
        });
      } catch {
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [businessId, serviceId, isEdit]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setIssue(null);
  };

  const fieldError = (field: FieldIssue['field']) =>
    issue && issue.field === field ? issue.message || t('common.saveFailed') : undefined;

  /**
   * An optional positive integer, or null for "not stated".
   *
   * Returns null rather than undefined for a blank box because the schema is
   * `nullish` and null is what the column stores; undefined would leave the key
   * off the patch entirely, which on an edit means "do not change this".
   */
  const positiveInteger = (raw: string): number | null => {
    if (raw.trim() === '') return null;
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : null;
  };

  const validate = (): FieldIssue | null => {
    if (form.serviceName.trim().length < 2) {
      return { field: 'serviceName', message: t('service.errorName') };
    }
    if (form.price.trim() === '') {
      return { field: 'price', message: t('service.errorPriceRequired') };
    }
    const price = Number(form.price);
    if (!Number.isFinite(price) || price < 0) {
      return { field: 'price', message: t('service.errorPrice') };
    }
    if (!/^[A-Z]{3}$/.test(form.currency)) {
      return { field: 'currency', message: t('service.errorCurrency') };
    }
    // Both are `z.number().int().positive().nullish()`, so 0 or -1 is invalid
    // rather than merely unusual.
    for (const [key, label] of [['durationMinutes', 'service.errorDuration'], ['capacity', 'service.errorCapacity']] as const) {
      const raw = form[key];
      if (raw.trim() !== '' && (!Number.isInteger(Number(raw)) || Number(raw) <= 0)) {
        return { field: key, message: t(label) };
      }
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validate();
    if (invalid) {
      setIssue(invalid);
      return;
    }

    setSaving(true);
    setIssue(null);
    try {
      const payload = {
        serviceName: form.serviceName.trim(),
        description: form.description.trim() || null,
        price: Number(form.price),
        currency: form.currency.toUpperCase(),
        durationMinutes: positiveInteger(form.durationMinutes),
        capacity: positiveInteger(form.capacity),
        isBookable: form.isBookable,
        status: form.status,
      };

      if (isEdit) {
        await serviceApi.update(businessId, serviceId, payload);
      } else {
        await serviceApi.create(businessId, payload);
      }
      navigate(`/dashboard/business/${businessId}/services`);
    } catch (error) {
      setIssue(toFieldIssue(error));
    } finally {
      setSaving(false);
    }
  };

  if (loadFailed) {
    return (
      <div className="py-16">
        <EmptyState
          icon={<Sparkles className="w-8 h-8" />}
          title={t('common.loadFailed')}
          action={
            <Button variant="outline" onClick={() => navigate(`/dashboard/business/${businessId}/services`)}>
              {t('service.backToList')}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate(`/dashboard/business/${businessId}/services`)}
        className="inline-flex items-center gap-1 text-sm text-navy-500 hover:text-navy-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
        {t('service.backToList')}
      </button>

      <h1 className="text-2xl font-bold text-navy-900 mb-6">
        {isEdit ? t('service.editTitle') : t('service.createTitle')}
      </h1>

      <Card className="p-6 max-w-2xl">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} variant="rectangular" height={44} />
            ))}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {issue && !issue.field && (
              <p className="p-3 bg-error-50 border border-error-200 rounded-button text-error-700 text-sm" role="alert">
                {issue.message || t('common.saveFailed')}
              </p>
            )}

            <Input
              label={t('service.name')}
              value={form.serviceName}
              onChange={(e) => set('serviceName', e.target.value)}
              required
              maxLength={200}
              error={fieldError('serviceName')}
            />

            <div>
              <label htmlFor="service-description" className="block text-sm font-medium text-navy-700 mb-1.5">
                {t('service.description')}
              </label>
              <textarea
                id="service-description"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                rows={4}
                maxLength={5000}
                className="w-full rounded-button border border-navy-300 px-4 py-2.5 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label={t('service.price')}
                value={form.price}
                onChange={(e) => set('price', e.target.value)}
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                required
                error={fieldError('price')}
              />
              <Input
                label={t('service.currency')}
                value={form.currency}
                onChange={(e) => set('currency', e.target.value.toUpperCase())}
                maxLength={3}
                required
                helperText={t('service.currencyHint')}
                error={fieldError('currency')}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label={`${t('service.duration')} (${t('common.minutes')})`}
                value={form.durationMinutes}
                onChange={(e) => set('durationMinutes', e.target.value)}
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                error={fieldError('durationMinutes')}
              />
              <Input
                label={t('service.capacity')}
                value={form.capacity}
                onChange={(e) => set('capacity', e.target.value)}
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                error={fieldError('capacity')}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-navy-700 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isBookable}
                onChange={(e) => set('isBookable', e.target.checked)}
                className="w-4 h-4 accent-primary-500"
              />
              {t('service.isBookable')}
            </label>

            <div>
              <label htmlFor="service-status" className="block text-sm font-medium text-navy-700 mb-1.5">
                {t('service.status')}
              </label>
              <select
                id="service-status"
                value={form.status}
                onChange={(e) => set('status', e.target.value as CatalogueStatus)}
                className="w-full rounded-button border border-navy-300 px-3 py-2.5 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`status.${status}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <Button type="submit" loading={saving}>
                {isEdit ? t('common.save') : t('service.create')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate(`/dashboard/business/${businessId}/services`)}
                disabled={saving}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}