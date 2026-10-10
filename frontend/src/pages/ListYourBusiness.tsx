import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, BadgeCheck, CheckCircle2, Clock, Store, XCircle } from 'lucide-react';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Card } from '../components/common/Card';
import { Skeleton } from '../components/common/Skeleton';
import { businessApi, directoryApi, authApi, toFieldIssue, type FieldIssue } from '../services/api';
import { normalisePhone } from '../lib/phone';
import { useAuth } from '../context/useAuth';
import { useCategories } from '../hooks/useCategories';
import { VerificationJourney } from '../components/home/VerificationJourney';
import type { BusinessProfilePatch, BusinessRegistrationInput, PublicCity, StaffBusinessProfile } from '../types';

interface FormState {
  businessName: string;
  categoryId: string;
  city: string;
  district: string;
  address: string;
  phone: string;
  whatsapp: string;
  description: string;
}

const EMPTY: FormState = {
  businessName: '',
  categoryId: '',
  city: '',
  district: '',
  address: '',
  phone: '',
  whatsapp: '',
  description: '',
};

type SubmitResult =
  | { kind: 'pending'; businessId: string; businessName: string }
  | { kind: 'verified'; businessId: string; businessName: string; slug: string };

/**
 * "List your business".
 *
 * This is the onboarding form that fills in a business. It exists as its own
 * screen, after login, because registering as a business owner at signup only
 * records a **name** — the server creates the business with nothing else — and
 * because a business created here starts `pending`: it is invisible in the
 * public directory until somebody approves it.
 *
 * Nothing here invents a value. The category list and the city suggestions come
 * from the API; the city stays free text because `/api/cities` only reports
 * cities that already have a public business, so a closed list of them would
 * refuse a perfectly valid new business in a town with nothing listed yet.
 */
export function ListYourBusinessPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, isLoading: authLoading, refreshUser } = useAuth();
  const { categories, loading: categoriesLoading } = useCategories({ includeEmpty: true });

  /**
   * The URL decides the mode. A bare `?complete=<businessId>` switches the page
   * from "create a new business" to "complete an existing one": the form is
   * prefilled from the staff read and saved with a PATCH instead of a POST.
   */
  const completeId = searchParams.get('complete') ?? '';

  const [form, setForm] = useState<FormState>(EMPTY);
  const [cities, setCities] = useState<PublicCity[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [issue, setIssue] = useState<FieldIssue | null>(null);
  const [submission, setSubmission] = useState<SubmitResult | null>(null);
  const [rejectionBanner, setRejectionBanner] = useState<string | null>(null);

  /** The staff read of the business being completed, used to prefill the form. */
  const [profile, setProfile] = useState<StaffBusinessProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(!!completeId);
  const [profileError, setProfileError] = useState<FieldIssue | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setIssue((current) => (current?.field === key ? null : current));
  };

  /**
   * Reference data. Both lists are optional to the form: a failure here must not
   * block a registration, because the category can be left unset and the city is
   * typed. It only means the select is empty.
   */
  const loadReference = useCallback(async () => {
    setLoading(true);
    const [cityResult] = await Promise.allSettled([
      directoryApi.cities(),
    ]);
    if (cityResult.status === 'fulfilled') setCities(cityResult.value.data.data);
    setLoading(false);
  }, []);

  /**
   * Complete mode loads the business so every editable box can be prefilled.
   *
   * 403 means the caller is not a member; 404 means the id does not match a
   * business at all. Both answer the same way the staff read does: with a clear
   * message instead of an empty form, because an editable form for a business
   * the account cannot reach is a lie.
   */
  const loadProfile = useCallback(async () => {
    if (!completeId) return;
    setProfileLoading(true);
    setProfileError(null);
    try {
      const res = await businessApi.getForBusiness(completeId);
      const p = res.data.data;
      setProfile(p);
      setForm({
        businessName: p.business_name,
        categoryId: p.business_category_id ?? '',
        city: p.city ?? '',
        district: p.district ?? '',
        address: p.address ?? '',
        phone: p.phone ?? '',
        whatsapp: p.whatsapp_number ?? '',
        description: p.business_description ?? '',
      });
    } catch (error) {
      const err = toFieldIssue(error);
      if (err.status === 403) {
        setProfileError({ message: t('listBusiness.notMember') });
      } else if (err.status === 404) {
        setProfileError({ message: t('listBusiness.notFound') });
      } else {
        setProfileError(err);
      }
    } finally {
      setProfileLoading(false);
    }
  }, [completeId, t]);

  useEffect(() => {
    void loadReference();
  }, [loadReference]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  /**
   * Login is required, and the person comes back here afterwards.
   *
   * The redirect keeps the intended destination in `state.from`, which is the
   * react-router convention: without it, signing in would drop whoever clicked
   * "list your business" on the home page instead of where they were going.
   */
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login', { replace: true, state: { from: '/list-your-business' } });
    }
  }, [authLoading, isAuthenticated, navigate]);

  /**
   * The normalised number, shown next to the box while it is being typed.
   *
   * `normalisePhone` is a preview, not the value that gets sent: the server
   * normalises again, and sending the client's own output would hide a
   * disagreement between the two copies of the rules instead of surfacing it.
   */
  const phonePreview = useMemo(() => {
    if (form.phone.trim() === '') return null;
    const result = normalisePhone(form.phone);
    return result.ok ? result.e164 : null;
  }, [form.phone]);

  const whatsappPreview = useMemo(() => {
    if (form.whatsapp.trim() === '') return null;
    const result = normalisePhone(form.whatsapp);
    return result.ok ? result.e164 : null;
  }, [form.whatsapp]);

  const phoneProblem = useMemo(() => {
    if (form.phone.trim() === '') return null;
    const result = normalisePhone(form.phone);
    return result.ok ? null : t(`listBusiness.phoneProblem.${result.reason}`);
  }, [form.phone, t]);

  const whatsappProblem = useMemo(() => {
    if (form.whatsapp.trim() === '') return null;
    const result = normalisePhone(form.whatsapp);
    return result.ok ? null : t(`listBusiness.phoneProblem.${result.reason}`);
  }, [form.whatsapp, t]);

  const fieldError = (field: string) => (issue?.field === field ? issue.message : undefined);

  const validate = (): FieldIssue | null => {
    if (form.businessName.trim().length < 2) {
      return { field: 'businessName', message: t('listBusiness.errorName') };
    }
    // A category id is optional, but a value that is not a positive integer is
    // a 400 from the server, so it is caught here where the select can explain.
    if (form.categoryId !== '') {
      const parsed = Number(form.categoryId);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { field: 'categoryId', message: t('listBusiness.errorCategory') };
      }
    }
    if (phoneProblem) return { field: 'phone', message: phoneProblem };
    if (whatsappProblem) return { field: 'whatsapp', message: whatsappProblem };
    return null;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const local = validate();
    if (local) {
      setIssue(local);
      return;
    }

    setSaving(true);
    setIssue(null);
    setRejectionBanner(null);
    try {
      if (completeId) {
        // Complete mode never creates: it patches the business the URL names,
        // sending the same editable fields the Settings page writes — including
        // category and WhatsApp. Fields the form does not edit (email, website,
        // logo, cover) are simply omitted, which a partial PATCH leaves alone.
        const patch: BusinessProfilePatch = {
          businessName: form.businessName.trim(),
          businessDescription: form.description.trim() || null,
          businessCategoryId: form.categoryId === '' ? null : Number(form.categoryId),
          phone: form.phone.trim() || null,
          whatsapp: form.whatsapp.trim() || null,
          city: form.city.trim() || null,
          district: form.district.trim() || null,
          address: form.address.trim() || null,
        };
        await businessApi.update(completeId, patch);
        // The PATCH response is a BusinessRecord and does not carry
        // `rejection_reason`. The real state is therefore read back from the
        // staff read, which also catches a status an admin changed during the
        // edit; a verified business is never reported as pending.
        const p = (await businessApi.getForBusiness(completeId)).data.data;
        const live = p.status === 'active' && p.is_verified && p.verification_status === 'verified';
        if (live) {
          setSubmission({
            kind: 'verified',
            businessId: p.business_id,
            businessName: p.business_name,
            slug: p.business_slug,
          });
        } else if (p.status === 'rejected') {
          // Keep the form editable and surface the reason; the owner can fix
          // details and save again to request another review.
          setRejectionBanner(p.rejection_reason ?? t('listBusiness.rejectedBodyFallback'));
        } else {
          setSubmission({ kind: 'pending', businessId: p.business_id, businessName: p.business_name });
        }
      } else {
        // Create mode sends only fields with a value; an empty box is omitted,
        // not sent as an empty string, so the server stores null rather than ''.
        const payload: BusinessRegistrationInput = { businessName: form.businessName.trim() };
        if (form.categoryId !== '') payload.businessCategoryId = Number(form.categoryId);
        if (form.city.trim() !== '') payload.city = form.city.trim();
        if (form.district.trim() !== '') payload.district = form.district.trim();
        if (form.address.trim() !== '') payload.address = form.address.trim();
        if (form.phone.trim() !== '') payload.phone = form.phone.trim();
        if (form.whatsapp.trim() !== '') payload.whatsapp = form.whatsapp.trim();
        if (form.description.trim() !== '') payload.description = form.description.trim();

        const res = await authApi.registerBusiness(payload);
        const business = res.data.data;
        // The membership was created with the business, so `/auth/me` is stale
        // until it is refetched. Without this the sidebar would show no business
        // and the dashboard link on the success screen would go nowhere.
        await refreshUser();
        setSubmission({ kind: 'pending', businessId: business.business_id, businessName: business.business_name });
      }
    } catch (error) {
      setIssue(toFieldIssue(error));
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || (!isAuthenticated && !submission)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  if (submission?.kind === 'pending')
    return <PendingVerification businessId={submission.businessId} name={submission.businessName} />;
  if (submission?.kind === 'verified')
    return (
      <SavedConfirmation
        businessId={submission.businessId}
        name={submission.businessName}
        slug={submission.slug}
      />
    );

  if (completeId && profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  if (completeId && profileError) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <Card className="p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-error-50 text-error-600 flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-8 h-8" aria-hidden="true" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-navy-900 mb-3">{profileError.message}</h1>
          <div className="flex flex-wrap gap-3 justify-center">
            <Button variant="outline" onClick={() => void loadProfile()}>{t('common.retry')}</Button>
            <Link to="/" className="text-primary-600 hover:text-primary-800 font-medium">{t('common.back')}</Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary-50 text-primary-700 text-sm font-medium mb-4">
          <Store className="w-4 h-4" aria-hidden="true" />
          {t('listBusiness.badge')}
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-navy-900 mb-3">{t('listBusiness.title')}</h1>
        <p className="text-navy-600 max-w-2xl">
          {completeId
            ? profile
              ? t('listBusiness.completeSubtitle', { name: profile.business_name })
              : t('listBusiness.subtitle')
            : t('listBusiness.subtitle')}
        </p>
      </div>

      <VerificationJourney ctaTarget="#list-business-form" />

      <Card className="p-6">
        {profileLoading || loading || categoriesLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} variant="rectangular" height={44} />
            ))}
          </div>
        ) : (
          <>
          <form id="list-business-form" onSubmit={handleSubmit} className="scroll-mt-24 space-y-5" noValidate>
            {issue && !issue.field && (
              <p
                className="p-3 bg-error-50 border border-error-200 rounded-button text-error-700 text-sm"
                role="alert"
              >
                {issue.message || t('common.saveFailed')}
              </p>
            )}

            {rejectionBanner && (
              <div
                className="p-3 bg-error-50 border border-error-200 rounded-button flex items-start gap-3 text-error-700 text-sm"
                role="alert"
              >
                <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <span>{rejectionBanner}</span>
              </div>
            )}

            <Input
              label={t('listBusiness.businessName')}
              value={form.businessName}
              onChange={(e) => set('businessName', e.target.value)}
              required
              maxLength={200}
              helperText={t('listBusiness.businessNameHint')}
              error={fieldError('businessName')}
            />

            <div>
              <label htmlFor="list-business-category" className="block text-sm font-medium text-navy-700 mb-1.5">
                {t('listBusiness.category')}
              </label>
              <select
                id="list-business-category"
                value={form.categoryId}
                onChange={(e) => set('categoryId', e.target.value)}
                className="w-full rounded-button border border-navy-300 px-3 py-2.5 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="">{t('listBusiness.categoryAny')}</option>
                {categories.map((category) => (
                  <option key={category.category_id} value={category.category_id}>
                    {category.category_name}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-sm text-navy-500">{t('listBusiness.categoryHint')}</p>
            </div>

            <div>
              <label htmlFor="list-business-city" className="block text-sm font-medium text-navy-700 mb-1.5">
                {t('listBusiness.city')}
              </label>
              <input
                id="list-business-city"
                list="list-business-city-options"
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
                maxLength={120}
                className="w-full rounded-button border border-navy-300 px-4 py-2.5 bg-white text-navy-900 placeholder:text-navy-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              {/* Suggestions, not a limit: /api/cities only knows the cities that
                  already have a public business. */}
              <datalist id="list-business-city-options">
                {(cities ?? []).map((entry) => (
                  <option key={entry.city} value={entry.city} />
                ))}
              </datalist>
              <p className="mt-1.5 text-sm text-navy-500">{t('listBusiness.cityHint')}</p>
            </div>

            <Input
              label={t('listBusiness.district')}
              value={form.district}
              onChange={(e) => set('district', e.target.value)}
              maxLength={120}
              error={fieldError('district')}
            />

            <Input
              label={t('listBusiness.address')}
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              maxLength={500}
              error={fieldError('address')}
            />

            <PhoneField
              id="list-business-phone"
              label={t('listBusiness.phone')}
              hint={t('listBusiness.phoneHint')}
              value={form.phone}
              preview={phonePreview}
              problem={phoneProblem ?? fieldError('phone')}
              onChange={(value) => set('phone', value)}
            />

            <PhoneField
              id="list-business-whatsapp"
              label={t('listBusiness.whatsapp')}
              hint={t('listBusiness.whatsappHint')}
              value={form.whatsapp}
              preview={whatsappPreview}
              problem={whatsappProblem ?? fieldError('whatsapp')}
              onChange={(value) => set('whatsapp', value)}
            />

            <div>
              <label htmlFor="list-business-description" className="block text-sm font-medium text-navy-700 mb-1.5">
                {t('listBusiness.description')}
              </label>
              <textarea
                id="list-business-description"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                rows={4}
                maxLength={5000}
                className="w-full rounded-button border border-navy-300 px-4 py-2.5 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              <p className="mt-1.5 text-sm text-navy-500">{t('listBusiness.descriptionHint')}</p>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <Button type="submit" loading={saving}>
                {completeId ? t('common.save') : t('listBusiness.submit')}
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate('/')} disabled={saving}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
          <p className="mt-5 text-sm leading-6 text-navy-500">
            {t('privacy.businessListingNotePrefix')}{' '}
            <Link to="/privacy" className="text-primary-700 underline underline-offset-2 hover:text-primary-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
              {t('privacy.title')}
            </Link>.
          </p>
          <p className="mt-2 text-sm leading-6 text-navy-500">
            {t('terms.listingAgreementPrefix')}{' '}
            <Link to="/terms" className="text-primary-700 underline underline-offset-2 hover:text-primary-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
              {t('footer.termsOfService')}
            </Link>{' '}
            {t('terms.listingAgreementAnd')}{' '}
            <Link to="/privacy" className="text-primary-700 underline underline-offset-2 hover:text-primary-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
              {t('footer.privacyPolicy')}
            </Link>.
          </p>
          <p className="mt-2 text-sm">
            <Link to="/safety" className="text-primary-700 underline underline-offset-2 hover:text-primary-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
              {t('safety.listingLink')}
            </Link>
          </p>
          </>
        )}
      </Card>
    </div>
  );
}

/**
 * A number box with its normalised form shown underneath.
 *
 * The preview is there so the person can see the number that will be stored
 * before they submit, and the problem message is the client mirror of the
 * server's rule — which means an unusable number is caught here instead of
 * after a round trip, while the server's own 400 still wins if the two ever
 * disagree.
 */
function PhoneField({
  id,
  label,
  hint,
  value,
  preview,
  problem,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  preview: string | null;
  problem?: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <Input
        id={id}
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type="tel"
        inputMode="tel"
        placeholder="+252 61 000 0000"
        helperText={hint}
        error={problem}
      />
      {preview && (
        <p className="mt-1.5 text-sm text-navy-500">
          {t('listBusiness.willStore')} <span className="font-mono text-navy-700">{preview}</span>
        </p>
      )}
    </div>
  );
}

/**
 * What happens after a successful registration.
 *
 * The business is `pending`, which means three things that are worth stating
 * rather than leaving the person to find out: it is not in the directory yet,
 * nothing about it can be seen by a visitor, and the dashboard still works. The
 * slug is shown because it is the address the business will keep, and a person
 * listing a business may want to write it down.
 */
function PendingVerification({ businessId, name }: { businessId: string; name: string }) {
  const { t } = useTranslation();
  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <Card className="p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-warning-50 text-warning-600 flex items-center justify-center mx-auto mb-6">
          <Clock className="w-8 h-8" aria-hidden="true" />
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold text-navy-900 mb-3">{t('listBusiness.pendingTitle')}</h1>
        <p className="text-navy-600 mb-6">{t('listBusiness.pendingBody', { name })}</p>

        <ul className="text-start space-y-3 mb-8">
          {[
            { icon: Clock, text: t('listBusiness.pendingStepReview') },
            { icon: BadgeCheck, text: t('listBusiness.pendingStepDecision') },
            { icon: CheckCircle2, text: t('listBusiness.pendingStepListed') },
          ].map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-sm text-navy-700">
              <Icon className="w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <span>{text}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-3 justify-center">
          <Link to={`/dashboard/business/${businessId}`}>
            <Button>{t('listBusiness.goToDashboard')}</Button>
          </Link>
          <Link to="/">
            <Button variant="outline">{t('listBusiness.backHome')}</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}

/**
 * Shown when a complete-mode save lands on a business that is already verified,
 * i.e. an admin approved it while it was being edited. A verified business is
 * never reported as pending.
 */
function SavedConfirmation({ businessId, name, slug }: { businessId: string; name: string; slug: string }) {
  const { t } = useTranslation();
  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <Card className="p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-success-50 text-success-600 flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-8 h-8" aria-hidden="true" />
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold text-navy-900 mb-3">{t('listBusiness.savedTitle')}</h1>
        <p className="text-navy-600 mb-6">{t('listBusiness.savedBody', { name })}</p>

        <div className="flex flex-wrap gap-3 justify-center">
          <Link to={`/business/${slug}`}>
            <Button>{t('listBusiness.viewPublic')}</Button>
          </Link>
          <Link to={`/dashboard/business/${businessId}`}>
            <Button variant="outline">{t('listBusiness.goToDashboard')}</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}