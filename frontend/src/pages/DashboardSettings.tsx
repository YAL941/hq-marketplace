import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Save, Users, Shield } from 'lucide-react';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Badge } from '../components/common/Badge';
import { EmptyState } from '../components/common/EmptyState';
import { Skeleton } from '../components/common/Skeleton';
import { Avatar } from '../components/layout/Avatar';
import { useAuth } from '../context/AuthContext';
import { businessApi, toFieldIssue, type FieldIssue } from '../services/api';
import { formatDate } from '../lib/utils';
import type { BusinessMember, BusinessProfilePatch, BusinessRecord } from '../types';

interface FormState {
  businessName: string;
  businessDescription: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  city: string;
  district: string;
  logoUrl: string;
  coverImageUrl: string;
}

const EMPTY: FormState = {
  businessName: '',
  businessDescription: '',
  phone: '',
  email: '',
  website: '',
  address: '',
  city: '',
  district: '',
  logoUrl: '',
  coverImageUrl: '',
};

/**
 * Settings.
 *
 * Everything on this screen is either read from an endpoint or written through
 * one. Three facts about the API shape the screen:
 *
 *   * There is **no** owner read for a business record. `GET /api/business/:id`
 *     does not exist — only PATCH, `/statistics` and `/members`. The form is
 *     therefore prefilled from `GET /api/businesses/:businessId`, the public
 *     profile, which an owner is allowed to read and which carries the fields
 *     that are edited here. It does **not** carry the business email, so that
 *     box starts empty and is only sent once it has been typed into.
 *   * `status`, `is_verified` and `verification_status` are returned by the
 *     PATCH response, so they are shown after a save and never before one.
 *     Nothing here invents them, and nothing claims a business is verified.
 *   * The old version of this page wrote `is_verified: false` and a hard-coded
 *     "Active" into a client-side object and saved it with a `setTimeout`. That
 *     is gone: the save is a real PATCH and its answer is what the screen shows.
 */
export function DashboardSettingsPage() {
  const { t } = useTranslation();
  const { user, businesses, currentBusiness, setCurrentBusiness } = useAuth();
  const businessId = currentBusiness?.business_id ?? '';

  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [issue, setIssue] = useState<FieldIssue | null>(null);
  const [saved, setSaved] = useState<BusinessRecord | null>(null);
  const [members, setMembers] = useState<BusinessMember[] | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setLoadFailed(false);
    setIssue(null);
    setSaved(null);
    setForm(EMPTY);
    try {
      const [profileRes, membersRes] = await Promise.all([
        businessApi.getPublic(businessId),
        businessApi.getMembers(businessId).catch(() => null),
      ]);
      const profile = profileRes.data.data;
      setForm({
        businessName: profile.business_name,
        businessDescription: profile.business_description ?? '',
        phone: profile.phone ?? '',
        // The public profile does not publish the business email, so this starts
        // empty rather than being filled with something that was not returned.
        email: '',
        website: profile.website ?? '',
        address: profile.address ?? '',
        city: profile.city ?? '',
        district: profile.district ?? '',
        logoUrl: profile.logo_url ?? '',
        coverImageUrl: profile.cover_image_url ?? '',
      });
      setMembers(membersRes ? membersRes.data.data : null);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setIssue(null);
    setSaved(null);
  };

  const fieldError = (field: FieldIssue['field']) =>
    issue && issue.field === field ? issue.message || t('common.saveFailed') : undefined;

  /**
   * Mirrors the server's schema, so the message appears next to the box that
   * caused it rather than as a banner after the round trip.
   */
  const validate = (): FieldIssue | null => {
    if (form.businessName.trim().length < 2) {
      return { field: 'businessName', message: t('settings.errorName') };
    }
    if (form.email.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      return { field: 'email', message: t('settings.errorEmail') };
    }
    for (const key of ['website', 'logoUrl', 'coverImageUrl'] as const) {
      const value = form[key].trim();
      if (value === '') continue;
      try {
        new URL(value);
      } catch {
        return { field: key, message: t('settings.errorUrl') };
      }
    }
    if (form.phone.trim().length > 20) {
      return { field: 'phone', message: t('settings.errorPhone') };
    }
    return null;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validate();
    if (invalid) {
      setIssue(invalid);
      return;
    }

    setSaving(true);
    setIssue(null);
    setSaved(null);
    try {
      // Every field is sent, with an empty box as null: the schema is
      // `nullish` on all of them, so this both clears a value and sets it.
      // `email` is left out entirely while it is blank, because a PATCH that
      // carries `email: null` would erase an address the form never read.
      const patch: BusinessProfilePatch = {
        businessName: form.businessName.trim(),
        businessDescription: form.businessDescription.trim() || null,
        phone: form.phone.trim() || null,
        website: form.website.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        district: form.district.trim() || null,
        logoUrl: form.logoUrl.trim() || null,
        coverImageUrl: form.coverImageUrl.trim() || null,
      };
      if (form.email.trim() !== '') patch.email = form.email.trim();

      const res = await businessApi.update(businessId, patch);
      setSaved(res.data.data);
    } catch (error) {
      setIssue(toFieldIssue(error));
    } finally {
      setSaving(false);
    }
  };

  if (businesses.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-navy-900 mb-6">{t('settings.title')}</h1>
        <Card>
          <EmptyState
            icon={<Building2 className="w-8 h-8" />}
            title={t('settings.noBusinessTitle')}
            description={t('settings.noBusinessBody')}
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy-900">{t('settings.title')}</h1>
        <p className="text-sm text-navy-500 mt-1">{t('settings.subtitle')}</p>
      </div>

      {/* One account can belong to several businesses, and the record being
          edited is whichever is selected here. */}
      {businesses.length > 1 && (
        <div className="mb-6 max-w-sm">
          <label htmlFor="settings-business" className="block text-sm font-medium text-navy-700 mb-1.5">
            {t('settings.whichBusiness')}
          </label>
          <select
            id="settings-business"
            value={businessId}
            onChange={(event) => {
              const next = businesses.find((b) => b.business_id === event.target.value);
              if (next) setCurrentBusiness(next);
            }}
            className="w-full rounded-button border border-navy-300 px-3 py-2.5 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            {businesses.map((business) => (
              <option key={business.business_id} value={business.business_id}>
                {business.business_name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-navy-900 mb-4">{t('settings.profileTitle')}</h2>

            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} variant="rectangular" height={44} />
                ))}
              </div>
            ) : loadFailed ? (
              <EmptyState
                icon={<Building2 className="w-8 h-8" />}
                title={t('common.loadFailed')}
                action={<Button variant="outline" onClick={() => void load()}>{t('common.retry')}</Button>}
              />
            ) : (
              <form onSubmit={handleSave} className="space-y-5" noValidate>
                {issue && !issue.field && (
                  <p className="p-3 bg-error-50 border border-error-200 rounded-button text-error-700 text-sm" role="alert">
                    {issue.message || t('common.saveFailed')}
                  </p>
                )}

                {saved && (
                  <p className="p-3 bg-success-50 border border-success-200 rounded-button text-success-600 text-sm" role="status">
                    {t('settings.savedAt', { date: formatDate(saved.updated_at) })}
                  </p>
                )}

                <Input
                  label={t('settings.businessName')}
                  value={form.businessName}
                  onChange={(e) => set('businessName', e.target.value)}
                  maxLength={200}
                  required
                  error={fieldError('businessName')}
                />

                <div>
                  <label htmlFor="settings-description" className="block text-sm font-medium text-navy-700 mb-1.5">
                    {t('settings.description')}
                  </label>
                  <textarea
                    id="settings-description"
                    value={form.businessDescription}
                    onChange={(e) => set('businessDescription', e.target.value)}
                    rows={4}
                    maxLength={5000}
                    className="w-full rounded-button border border-navy-300 px-4 py-2.5 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label={t('settings.phone')}
                    type="tel"
                    value={form.phone}
                    onChange={(e) => set('phone', e.target.value)}
                    maxLength={20}
                    placeholder="+252 61 000 0000"
                    error={fieldError('phone')}
                  />
                  <Input
                    label={t('settings.email')}
                    type="email"
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    helperText={t('settings.emailNotReadable')}
                    error={fieldError('email')}
                  />
                </div>

                <Input
                  label={t('settings.website')}
                  type="url"
                  value={form.website}
                  onChange={(e) => set('website', e.target.value)}
                  placeholder="https://example.com"
                  error={fieldError('website')}
                />

                <Input
                  label={t('settings.address')}
                  value={form.address}
                  onChange={(e) => set('address', e.target.value)}
                  maxLength={500}
                  error={fieldError('address')}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label={t('settings.city')}
                    value={form.city}
                    onChange={(e) => set('city', e.target.value)}
                    maxLength={120}
                    error={fieldError('city')}
                  />
                  <Input
                    label={t('settings.district')}
                    value={form.district}
                    onChange={(e) => set('district', e.target.value)}
                    maxLength={120}
                    error={fieldError('district')}
                  />
                </div>

                <Input
                  label={t('settings.logoUrl')}
                  type="url"
                  value={form.logoUrl}
                  onChange={(e) => set('logoUrl', e.target.value)}
                  error={fieldError('logoUrl')}
                />
                <Input
                  label={t('settings.coverImageUrl')}
                  type="url"
                  value={form.coverImageUrl}
                  onChange={(e) => set('coverImageUrl', e.target.value)}
                  error={fieldError('coverImageUrl')}
                />

                <div className="flex flex-wrap gap-3 pt-2">
                  <Button type="submit" loading={saving}>
                    <Save className="w-4 h-4 me-2" aria-hidden="true" />
                    {t('common.save')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void load()} disabled={saving}>
                    {t('settings.reload')}
                  </Button>
                </div>
              </form>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {/* Only after a save: these three fields exist on the PATCH response
              and nowhere the form could have read them from. */}
          {saved && (
            <Card className="p-5">
              <h2 className="font-semibold text-navy-900 mb-3">{t('settings.savedRecordTitle')}</h2>
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-navy-500">{t('settings.recordStatus')}</dt>
                  <dd>
                    <Badge variant="info" size="sm">{saved.status}</Badge>
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-navy-500">{t('settings.recordVerification')}</dt>
                  <dd>
                    <Badge variant="default" size="sm">{saved.verification_status}</Badge>
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-navy-500">{t('settings.recordUpdated')}</dt>
                  <dd className="text-navy-900">{formatDate(saved.updated_at)}</dd>
                </div>
              </dl>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="font-semibold text-navy-900 mb-3">{t('settings.accountTitle')}</h2>
            <div className="flex items-center gap-3">
              <Avatar name={user?.full_name || 'User'} size="md" />
              <div className="min-w-0">
                <p className="font-medium text-navy-900 truncate">{user?.full_name}</p>
                <p className="text-xs text-navy-500 truncate">{user?.email}</p>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold text-navy-900 mb-3 flex items-center gap-2">
              <Users className="w-4 h-4 text-navy-400" aria-hidden="true" />
              {t('settings.teamTitle')}
            </h2>
            {members === null ? (
              <p className="text-sm text-navy-500">{t('settings.teamUnavailable')}</p>
            ) : members.length === 0 ? (
              <p className="text-sm text-navy-500">{t('settings.teamEmpty')}</p>
            ) : (
              <ul className="divide-y divide-navy-100">
                {members.map((member) => (
                  <li key={member.business_user_id} className="py-3 flex items-center gap-3">
                    <Avatar name={member.full_name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-navy-900 truncate">{member.full_name}</p>
                      <p className="text-xs text-navy-500 truncate">{member.email}</p>
                    </div>
                    <Badge variant="info" size="sm">{member.role_name}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold text-navy-900 mb-2 flex items-center gap-2">
              <Shield className="w-4 h-4 text-navy-400" aria-hidden="true" />
              {t('settings.securityTitle')}
            </h2>
            <p className="text-sm text-navy-500">{t('settings.securityBody')}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}