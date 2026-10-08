import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertCircle, Building2, Globe, Save, Shield, Users, XCircle } from 'lucide-react';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { ImageUpload } from '../components/common/ImageUpload';
import { Toast, useToasts } from '../components/common/Toast';
import { Badge } from '../components/common/Badge';
import { EmptyState } from '../components/common/EmptyState';
import { Skeleton } from '../components/common/Skeleton';
import { Avatar } from '../components/layout/Avatar';
import { useAuth } from '../context/AuthContext';
import { businessApi, toFieldIssue, type FieldIssue } from '../services/api';
import { useCategories } from '../hooks/useCategories';
import { formatDate } from '../lib/utils';
import { normalisePhone } from '../lib/phone';
import type {
  BusinessMember,
  BusinessProfilePatch,
  BusinessRecord,
  StaffBusinessProfile,
} from '../types';

interface FormState {
  businessName: string;
  businessDescription: string;
  categoryId: string;
  phone: string;
  whatsapp: string;
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
  categoryId: '',
  phone: '',
  whatsapp: '',
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
 * one. The shape of the API decides three things here:
 *
 *   * The form is prefilled from `GET /api/business/:businessId`, the staff read.
 *     It used to be prefilled from the public profile, which is a 404 for a
 *     business that is still `pending` or has been `rejected` — that is, for
 *     exactly the businesses whose owner most needs this screen. The staff read
 *     also carries the business email and category, which the public profile
 *     never published, so those two boxes are no longer guesses.
 *   * The editable set is what `PATCH /api/business/:businessId` accepts:
 *     name, description, category, phone, WhatsApp, email, website, address,
 *     city, district, logo and cover. Nothing else is offered, because a field
 *     that cannot be saved is worse than an absent one. `latitude`/`longitude`
 *     are accepted by the route but there is no map here to source them from, and
 *     `status`/`verification_status` belong to an admin decision.
 *   * Phone and WhatsApp are normalised to E.164 by the server and by the copy of
 *     its rules in `lib/phone.ts`, so the canonical form is shown while typing
 *     and an unusable number is caught before the round trip.
 */

interface BusinessStatusBannerProps {
  profile: StaffBusinessProfile | null;
}

/**
 * Shows the current business state, drawn from the staff read so it works while
 * the business is still `pending` or has been `rejected`. Three cases are
 * spelled out; anything else only reports the raw status label, with no claim
 * about what a visitor can see.
 */
function BusinessStatusBanner({ profile }: BusinessStatusBannerProps) {
  const { t } = useTranslation();
  if (!profile) return null;

  const isLive = profile.status === 'active' && profile.is_verified && profile.verification_status === 'verified';

  if (isLive) {
    return (
      <div className="p-4 bg-success-50 border border-success-200 rounded-button flex items-start gap-3">
        <Globe className="w-5 h-5 text-success-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-success-800">{t('settings.bannerLive')}</p>
          <p className="text-sm text-success-700">{t('settings.bannerLiveBody')}</p>
        </div>
        <Link
          to={`/business/${profile.business_slug}`}
          className="ms-auto text-sm font-medium text-primary-700 hover:text-primary-800"
        >
          {t('settings.bannerLiveLink')}
        </Link>
      </div>
    );
  }

  if (profile.status === 'rejected') {
    return (
      <div className="p-4 bg-error-50 border border-error-200 rounded-button flex items-start gap-3">
        <XCircle className="w-5 h-5 text-error-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-error-800">{t('settings.bannerRejected')}</p>
          <p className="text-sm text-error-700">{t('settings.bannerRejectedBody')}</p>
          {profile.rejection_reason && (
            <p className="mt-1 text-sm text-error-700">
              <span className="font-medium">{t('settings.bannerRejectionReason')}</span> {profile.rejection_reason}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (profile.status === 'pending') {
    return (
      <div className="p-4 bg-warning-50 border border-warning-200 rounded-button flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-warning-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-warning-800">{t('settings.bannerPending')}</p>
          <p className="text-sm text-warning-700">{t('settings.bannerPendingBody')}</p>
        </div>
      </div>
    );
  }

  // suspended / closed (or active but not yet verified): only the literal status
  // is shown, so the UI never asserts a visibility it cannot confirm.
  return (
    <div className="p-4 bg-navy-50 border border-navy-200 rounded-button flex items-start gap-3">
      <AlertCircle className="w-5 h-5 text-navy-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
      <Badge variant="info" size="sm">{t(`status.${profile.status}`)}</Badge>
      <p className="text-sm text-navy-600">{t('settings.recordVerification')}: {t(`status.${profile.verification_status}`)}</p>
    </div>
  );
}

/** Which of the two image columns a link edit refers to. */
type ImageSlot = 'logo' | 'cover';

export function DashboardSettingsPage() {
  const { t } = useTranslation();
  const { user, businesses, currentBusiness, refreshBusinessLogo, setCurrentBusiness } = useAuth();
  const { categories } = useCategories({ includeEmpty: true });
  const businessId = currentBusiness?.business_id ?? '';

  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [issue, setIssue] = useState<FieldIssue | null>(null);
  const [saved, setSaved] = useState<BusinessRecord | null>(null);
  const [members, setMembers] = useState<BusinessMember[] | null>(null);
  const [profile, setProfile] = useState<StaffBusinessProfile | null>(null);
  /**
   * Whether the person typed in a link for that slot during this visit.
   *
   * An upload or a removal writes the column on the server immediately, which
   * makes the form's copy of it stale by definition. Sending it again on the
   * next Save would overwrite the new file with the old value, so the PATCH
   * carries these two fields only while this says the link was deliberately
   * edited here.
   */
  const [linkEdited, setLinkEdited] = useState<Record<ImageSlot, boolean>>({ logo: false, cover: false });
  /**
   * Which upload widgets have a request in flight, tracked per slot.
   *
   * Per slot rather than one shared flag because the two widgets are
   * independent: with a single boolean, a logo that finished would report
   * `false` while the cover was still uploading, re-enabling Save in the middle
   * of an upload. Deriving the page-wide value from this keeps that impossible.
   */
  const [mediaBusyBySlot, setMediaBusyBySlot] = useState<Record<ImageSlot, boolean>>({ logo: false, cover: false });
  const mediaBusy = mediaBusyBySlot.logo || mediaBusyBySlot.cover;
  const { toasts, show: showToast, dismiss } = useToasts();

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setLoadFailed(false);
    setIssue(null);
    setSaved(null);
    setForm(EMPTY);
    // A reload discards whatever the link boxes held, so their dirty flags go
    // with them. Leaving a flag set would make the next Save overwrite the
    // freshly loaded column with a value the person has not seen since.
    setLinkEdited({ logo: false, cover: false });
    try {
      const [profileRes, membersRes] = await Promise.all([
        // The staff read, not the public profile: it is the only one that
        // answers for a business which is not publicly visible.
        businessApi.getForBusiness(businessId),
        businessApi.getMembers(businessId).catch(() => null),
      ]);
      const profile = profileRes.data.data;
      setProfile(profile);
      setForm({
        businessName: profile.business_name,
        businessDescription: profile.business_description ?? '',
        categoryId: profile.business_category_id ?? '',
        phone: profile.phone ?? '',
        whatsapp: profile.whatsapp_number ?? '',
        email: profile.email ?? '',
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

  /**
   * Typing a link marks that slot as deliberately edited, which is the only
   * thing that lets the next Save carry it.
   */
  const setLink = (key: 'logoUrl' | 'coverImageUrl', value: string) => {
    set(key, value);
    setLinkEdited((prev) => ({ ...prev, [key === 'logoUrl' ? 'logo' : 'cover']: true }));
  };

  /**
   * Adopts a value the server has just written, in both places that hold it.
   *
   * An upload answers with the updated row and a removal answers 204, so in each
   * case the new column value is known rather than needing a re-read. It is
   * written to the form *and* to the loaded profile together, because the form
   * is what a later Save would send and the profile is what the banner and any
   * re-render read; updating one alone is how a stale value comes back and
   * silently reverts the image.
   *
   * The dirty flag is cleared as well: the server now holds this value, so it
   * is no longer a pending edit to be submitted.
   */
  const applyStoredUrl = (slot: ImageSlot, value: string | null) => {
    setForm((prev) => (slot === 'logo' ? { ...prev, logoUrl: value ?? '' } : { ...prev, coverImageUrl: value ?? '' }));
    setProfile((prev) =>
      prev ? (slot === 'logo' ? { ...prev, logo_url: value } : { ...prev, cover_image_url: value }) : prev,
    );
    setLinkEdited((prev) => ({ ...prev, [slot]: false }));
    setSaved(null);
    setIssue(null);
    // The header and the sidebar read the logo from the auth context, which
    // fetched it before this change. Without this they would keep showing the
    // previous logo until the next full reload.
    if (slot === 'logo') void refreshBusinessLogo();
  };

  const fieldError = (field: FieldIssue['field']) =>
    issue && issue.field === field ? issue.message || t('common.saveFailed') : undefined;

  /**
   * The canonical form of a number box, or the reason it has none.
   *
   * This is the client mirror of the server's normaliser, and the server's own
   * 400 still wins if the two ever disagree: the point is to catch the mistake
   * here, where the message can sit under the box that caused it.
   */
  const numberProblem = (value: string): string | null => {
    if (value.trim() === '') return null;
    const result = normalisePhone(value);
    return result.ok ? null : t(`listBusiness.phoneProblem.${result.reason}`);
  };

  const phonePreview = useMemo(() => {
    const result = form.phone.trim() === '' ? null : normalisePhone(form.phone);
    return result && result.ok ? result.e164 : null;
  }, [form.phone]);

  const whatsappPreview = useMemo(() => {
    const result = form.whatsapp.trim() === '' ? null : normalisePhone(form.whatsapp);
    return result && result.ok ? result.e164 : null;
  }, [form.whatsapp]);

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
      // An image column the person never touched holds whatever the server wrote,
      // which after an upload is a `/uploads/...` path — not a URL `new URL`
      // accepts. Validating it anyway would fail a form over a value the person
      // cannot see in the box they would have to fix it in.
      const slot = key === 'logoUrl' ? 'logo' : key === 'coverImageUrl' ? 'cover' : null;
      if (slot && !linkEdited[slot]) continue;
      const value = form[key].trim();
      if (value === '') continue;
      try {
        new URL(value);
      } catch {
        return { field: key, message: t('settings.errorUrl') };
      }
    }
    const phone = numberProblem(form.phone);
    if (phone) return { field: 'phone', message: phone };
    const whatsapp = numberProblem(form.whatsapp);
    if (whatsapp) return { field: 'whatsapp', message: whatsapp };
    if (form.categoryId !== '') {
      const parsed = Number(form.categoryId);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { field: 'categoryId', message: t('listBusiness.errorCategory') };
      }
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
      const patch: BusinessProfilePatch = {
        businessName: form.businessName.trim(),
        businessDescription: form.businessDescription.trim() || null,
        // `businessCategoryId` is a JSON number: the route validates it with
        // `z.number()`, and the id arrives as a string from the category list.
        businessCategoryId: form.categoryId === '' ? null : Number(form.categoryId),
        phone: form.phone.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        website: form.website.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        district: form.district.trim() || null,
      };
      if (form.email.trim() !== '') patch.email = form.email.trim();

      // The two image columns are the exception to "send everything". They are
      // written by the upload routes themselves, so including them here — even
      // with the value this page was just handed — would be a second, redundant
      // write of data the server already has, and would revert an upload if this
      // form's copy were ever one request behind. Only a deliberate link edit
      // goes in the payload.
      if (linkEdited.logo) patch.logoUrl = form.logoUrl.trim() || null;
      if (linkEdited.cover) patch.coverImageUrl = form.coverImageUrl.trim() || null;

      // Read before the flags are cleared below. The `logoUrl` this request just
      // carried is the one thing the context has not seen yet.
      const savedLogoLink = linkEdited.logo;

      const res = await businessApi.update(businessId, patch);
      const updated = res.data.data;
      setSaved(updated);
      // The PATCH response is the whole row, so the two image columns come back
      // authoritative here too. Adopting them keeps the form from holding a
      // value the server has already moved on from, whichever way the request
      // was built.
      setForm((prev) => ({
        ...prev,
        logoUrl: updated.logo_url ?? '',
        coverImageUrl: updated.cover_image_url ?? '',
      }));
      setLinkEdited({ logo: false, cover: false });
      if (savedLogoLink) void refreshBusinessLogo();
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              logo_url: updated.logo_url,
              cover_image_url: updated.cover_image_url,
              status: updated.status,
              verification_status: updated.verification_status,
              updated_at: updated.updated_at,
            }
          : prev,
      );
    } catch (error) {
      const failure = toFieldIssue(error);
      // A 403 here means the account may edit the business but not this
      // permission; a 429 means the shared write budget is spent. Both are
      // reported in the page's language and as a toast, because the inline
      // banner sits above the fields the person was looking at. Anything else
      // keeps the server's own wording, which is already written for a reader.
      const message =
        failure.status === 403
          ? t('errors.forbidden')
          : failure.status === 429
            ? t('errors.rateLimited')
            : failure.message || t('common.saveFailed');
      setIssue({ ...failure, message });
      showToast(message, 'error');
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

      <BusinessStatusBanner profile={profile} />

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
                  <label htmlFor="settings-category" className="block text-sm font-medium text-navy-700 mb-1.5">
                    {t('settings.category')}
                  </label>
                  <select
                    id="settings-category"
                    value={form.categoryId}
                    onChange={(e) => set('categoryId', e.target.value)}
                    className="w-full rounded-button border border-navy-300 px-3 py-2.5 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="">{t('settings.categoryAny')}</option>
                    {categories.map((category) => (
                      <option key={category.category_id} value={category.category_id}>
                        {category.category_name}
                      </option>
                    ))}
                  </select>
                  {fieldError('categoryId') && (
                    <p className="mt-1.5 text-sm text-error-600" role="alert">
                      {fieldError('categoryId')}
                    </p>
                  )}
                  <p className="mt-1.5 text-sm text-navy-500">{t('settings.categoryHint')}</p>
                </div>

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
                    helperText={phonePreview ? `${t('listBusiness.willStore')} ${phonePreview}` : t('listBusiness.phoneHint')}
                    error={fieldError('phone')}
                  />
                  <Input
                    label={t('settings.whatsapp')}
                    type="tel"
                    value={form.whatsapp}
                    onChange={(e) => set('whatsapp', e.target.value)}
                    maxLength={20}
                    placeholder="+252 61 000 0000"
                    helperText={whatsappPreview ? `${t('listBusiness.willStore')} ${whatsappPreview}` : t('listBusiness.whatsappHint')}
                    error={fieldError('whatsapp')}
                  />
                </div>

                <Input
                  label={t('settings.email')}
                  type="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  helperText={t('settings.emailNotReadable')}
                  error={fieldError('email')}
                />

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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {(['logo', 'cover'] as const).map((slot) => (
                    <div key={slot} className="min-w-0">
                      <ImageUpload
                        kind={slot}
                        businessId={businessId}
                        shape={slot === 'logo' ? 'square' : 'wide'}
                        value={slot === 'logo' ? form.logoUrl : form.coverImageUrl}
                        onChange={(value) => applyStoredUrl(slot, value)}
                        // Locked while the PATCH is in flight, and the Save button
                        // is locked while an upload is: either order of the same
                        // two writes must not overlap, or the last one to land
                        // silently wins.
                        disabled={saving}
                        onBusyChange={(busy) => setMediaBusyBySlot((prev) => ({ ...prev, [slot]: busy }))}
                        // The widget reports (kind, message); the page's own
                        // toast helper takes them the other way round.
                        onNotify={(kind, message) => showToast(message, kind)}
                      />
                      {/* The URL box stays, behind a disclosure. Uploading is the
                          easy path but not the only one — an owner whose logo
                          already lives on a CDN, or who wants to point at a file
                          that has not been uploaded yet, needs to type one. */}
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-navy-500 hover:text-navy-700">
                          {t('settings.imageLinkOption')}
                        </summary>
                        <div className="mt-2">
                          <Input
                            label={slot === 'logo' ? t('settings.logoUrl') : t('settings.coverImageUrl')}
                            type="url"
                            value={slot === 'logo' ? form.logoUrl : form.coverImageUrl}
                            onChange={(e) => setLink(slot === 'logo' ? 'logoUrl' : 'coverImageUrl', e.target.value)}
                            error={fieldError(slot === 'logo' ? 'logoUrl' : 'coverImageUrl')}
                          />
                        </div>
                      </details>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-3 pt-2">
                  <Button type="submit" loading={saving} disabled={mediaBusy}>
                    <Save className="w-4 h-4 me-2" aria-hidden="true" />
                    {t('common.save')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void load()} disabled={saving || mediaBusy}>
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
                <p className="text-xs text-navy-500 truncate">{user?.email ?? user?.phone ?? '—'}</p>
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

      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onRemove={() => dismiss(toast.id)} />
      ))}
    </div>
  );
}