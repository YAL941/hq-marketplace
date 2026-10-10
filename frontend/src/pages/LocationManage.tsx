import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Plus, Star, Power, Pencil } from 'lucide-react';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { Input } from '../components/common/Input';
import { useAuth } from '../context/useAuth';
import { locationApi } from '../services/api';
import type { CreateLocationInput, Location } from '../types';

const emptyForm: CreateLocationInput = {
  locationName: '',
  address: '',
  city: '',
  district: '',
  phone: '',
};

export function LocationManagePage() {
  const { t } = useTranslation();
  const { currentBusiness } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);
  const [form, setForm] = useState<CreateLocationInput>(emptyForm);
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!currentBusiness) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const response = await locationApi.listForBusiness(currentBusiness.business_id);
      setLocations(response.data.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [currentBusiness]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveLocation = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentBusiness) return;
    setSaving(true);
    setMessage('');
    try {
      const input = { ...form, locationName: form.locationName.trim() };
      if (editingLocationId) {
        await locationApi.update(currentBusiness.business_id, editingLocationId, input);
      } else {
        await locationApi.create(currentBusiness.business_id, {
          ...input,
          isPrimary: locations.length === 0,
        });
      }
      setForm(emptyForm);
      setEditingLocationId(null);
      setMessage(t(editingLocationId ? 'branches.updated' : 'branches.created'));
      await load();
    } catch {
      setMessage(t('branches.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const updateLocation = async (location: Location, patch: Partial<CreateLocationInput>) => {
    if (!currentBusiness) return;
    setMessage('');
    try {
      await locationApi.update(currentBusiness.business_id, location.location_id, patch);
      setMessage(t('branches.updated'));
      await load();
    } catch {
      setMessage(t('branches.saveError'));
    }
  };

  const editLocation = (location: Location) => {
    setEditingLocationId(location.location_id);
    setForm({
      locationName: location.location_name,
      address: location.address ?? '',
      city: location.city ?? '',
      district: location.district ?? '',
      phone: location.phone ?? '',
    });
    setMessage('');
  };

  if (loading) {
    return <div className="mx-auto max-w-7xl px-4 py-8 text-navy-600" role="status">{t('common.loading')}</div>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-2xl font-bold text-navy-900">{t('branches.title')}</h1>
        <p className="mt-1 text-navy-600">{t('branches.subtitle')}</p>
      </header>

      {message && <p className="rounded-lg bg-primary-50 p-3 text-sm text-primary-800" role="status">{message}</p>}
      {error ? (
        <ErrorState onRetry={() => void load()} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
          <section aria-labelledby="branch-list-title" className="space-y-4">
            <h2 id="branch-list-title" className="text-lg font-semibold text-navy-900">
              {t('branches.yourLocations', { count: locations.length })}
            </h2>
            {locations.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<MapPin className="h-8 w-8" aria-hidden="true" />}
                  title={t('branches.emptyTitle')}
                  description={t('branches.emptyDescription')}
                />
              </Card>
            ) : (
              locations.map((location) => (
                <Card key={location.location_id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-navy-900">{location.location_name}</h3>
                        {location.is_primary && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gold-50 px-2 py-1 text-xs font-medium text-gold-800">
                            <Star className="h-3 w-3" aria-hidden="true" /> {t('branches.primary')}
                          </span>
                        )}
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${location.is_active ? 'bg-success-50 text-success-600' : 'bg-navy-100 text-navy-600'}`}>
                          {location.is_active ? t('branches.active') : t('branches.inactive')}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-navy-600">
                        {[location.address, location.district, location.city].filter(Boolean).join(' · ') || t('branches.noAddress')}
                      </p>
                      {location.phone && <p className="mt-1 text-sm text-navy-600" dir="ltr">{location.phone}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!location.is_primary && (
                        <Button variant="outline" size="sm" onClick={() => void updateLocation(location, { isPrimary: true })}>
                          <Star className="me-1 h-4 w-4" aria-hidden="true" /> {t('branches.makePrimary')}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => editLocation(location)}>
                        <Pencil className="me-1 h-4 w-4" aria-hidden="true" /> {t('common.edit')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void updateLocation(location, { isActive: !location.is_active })}
                      >
                        <Power className="me-1 h-4 w-4" aria-hidden="true" />
                        {location.is_active ? t('branches.deactivate') : t('branches.activate')}
                      </Button>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </section>

          <section aria-labelledby="branch-create-title">
            <Card className="p-5">
              <h2 id="branch-create-title" className="text-lg font-semibold text-navy-900">
                {editingLocationId
                  ? <Pencil className="me-2 inline h-5 w-5 text-primary-600" aria-hidden="true" />
                  : <Plus className="me-2 inline h-5 w-5 text-primary-600" aria-hidden="true" />}
                {t(editingLocationId ? 'branches.editTitle' : 'branches.addTitle')}
              </h2>
              <p className="mt-1 text-sm text-navy-600">{t('branches.addDescription')}</p>
              <form onSubmit={saveLocation} className="mt-5 space-y-4">
                <Input
                  label={t('branches.name')}
                  value={form.locationName}
                  onChange={(event) => setForm({ ...form, locationName: event.target.value })}
                  minLength={2}
                  maxLength={150}
                  required
                />
                <Input
                  label={t('branches.address')}
                  value={form.address ?? ''}
                  onChange={(event) => setForm({ ...form, address: event.target.value })}
                  maxLength={500}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label={t('branches.city')}
                    value={form.city ?? ''}
                    onChange={(event) => setForm({ ...form, city: event.target.value })}
                    maxLength={120}
                  />
                  <Input
                    label={t('branches.district')}
                    value={form.district ?? ''}
                    onChange={(event) => setForm({ ...form, district: event.target.value })}
                    maxLength={120}
                  />
                </div>
                <Input
                  label={t('branches.phone')}
                  type="tel"
                  value={form.phone ?? ''}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                  maxLength={20}
                />
                <div className="flex gap-3">
                  <Button type="submit" className="flex-1" loading={saving}>
                    {t(editingLocationId ? 'branches.saveEdit' : 'branches.addButton')}
                  </Button>
                  {editingLocationId && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditingLocationId(null);
                        setForm(emptyForm);
                      }}
                    >
                      {t('common.cancel')}
                    </Button>
                  )}
                </div>
              </form>
            </Card>
          </section>
        </div>
      )}
    </div>
  );
}
