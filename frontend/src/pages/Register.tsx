import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import {
  Eye, EyeOff, Mail, Lock, User, Phone, Store, UserRound, AlertCircle,
} from 'lucide-react';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Card } from '../components/common/Card';
import { Logo } from '../components/branding/Logo';
import { useAuth } from '../context/AuthContext';
import { toFieldIssue, type FieldIssue } from '../services/api';
import { isEmailLike, normalisePhone, type PhoneProblem } from '../lib/phone';
import type { AccountRole } from '../types';

const MIN_PASSWORD_LENGTH = 8;

/** A deliberately loose shape check; the server owns the real rule. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Signup.
 *
 * Phone and email are one choice with two live inputs rather than a pair of
 * radio buttons, because the server accepts either or both. A phone typed in
 * any of the shapes Somali users actually write is normalised to E.164 and shown
 * back, so the person can see what will be stored before they commit to it.
 */
export function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { register } = useAuth();

  const [role, setRole] = useState<AccountRole>('customer');
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    email: '',
    businessName: '',
    password: '',
  });
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [issue, setIssue] = useState<FieldIssue | null>(null);
  const [loading, setLoading] = useState(false);

  const phoneResult = formData.phone.trim() === '' ? null : normalisePhone(formData.phone);
  const phone = phoneResult?.ok ? phoneResult.e164 : null;
  const phoneProblem: PhoneProblem | null =
    phoneResult && !phoneResult.ok ? phoneResult.reason : null;

  const isBusiness = role === 'business_owner';

  const setField = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    setIssue(null);
  };

  const phoneMessage = (): string | undefined => {
    if (!phoneProblem) return undefined;
    switch (phoneProblem) {
      case 'letters':
        return t('auth.phoneProblemLetters');
      case 'country':
        return t('auth.phoneProblemCountry');
      case 'length':
        return t('auth.phoneProblemLength', {
          min: 8,
          max: 9,
        });
      default:
        return t('auth.phoneProblemLetters');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIssue(null);

    const fullName = formData.fullName.trim();
    const businessName = formData.businessName.trim();
    const emailRaw = formData.email.trim();
    // The field holding an `@` is treated as an email even when the person also
    // filled the phone box, which is what makes the pair of inputs work without
    // a switch to keep in sync.
    const usePhone = !isEmailLike(emailRaw) && formData.phone.trim() !== '';

    const localIssue = (field: FieldIssue['field'], message: string): boolean => {
      setIssue({ field, message });
      return false;
    };

    if (fullName.length < 2) return void localIssue('fullName', t('auth.errorFullName'));
    if (isBusiness && businessName.length < 2) {
      return void localIssue('businessName', t('auth.errorBusinessName'));
    }
    if (formData.password.length < MIN_PASSWORD_LENGTH) {
      return void localIssue('password', t('auth.passwordTooShort', { count: MIN_PASSWORD_LENGTH }));
    }
    if (!acceptedTerms) return void localIssue('terms', t('auth.errorTerms'));
    if (usePhone && !phone) return void localIssue('phone', phoneMessage() ?? t('auth.phoneProblemLetters'));
    if (!usePhone && emailRaw && !EMAIL_SHAPE.test(emailRaw)) {
      return void localIssue('email', t('auth.errorEmail'));
    }
    if (usePhone && emailRaw && !EMAIL_SHAPE.test(emailRaw)) {
      return void localIssue('email', t('auth.errorEmail'));
    }
    if (!usePhone && !emailRaw) return void localIssue('email', t('auth.errorNeedPhoneOrEmail'));

    setLoading(true);
    try {
      await register(
        {
          fullName,
          password: formData.password,
          role,
          businessName: isBusiness ? businessName : undefined,
          // The canonical number is sent, not the raw one, because the server
          // normalises anyway and this keeps the two from ever disagreeing.
          phone: usePhone && phone ? phone : undefined,
          email: !usePhone ? emailRaw : undefined,
        },
        true,
      );
      navigate(isBusiness ? '/dashboard' : '/', { replace: true });
    } catch (error) {
      setIssue(toFieldIssue(error));
    } finally {
      setLoading(false);
    }
  };

  const fieldError = (field: FieldIssue['field']) =>
    issue && issue.field === field ? (issue.message || t('auth.errorUnexpected')) : undefined;

  const roleOptions: Array<{ value: AccountRole; label: string; Icon: typeof UserRound }> = [
    { value: 'customer', label: t('auth.roleCustomer'), Icon: UserRound },
    { value: 'business_owner', label: t('auth.roleBusinessOwner'), Icon: Store },
  ];

  return (
    <div className="min-h-screen bg-navy-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <Logo to="/" ariaLabel={t('brand.homeLabel')} variant="light" size="md" className="inline-flex mb-8" />
          <h1 className="text-3xl font-bold text-navy-900">{t('auth.registerTitle')}</h1>
          <p className="mt-2 text-navy-500">{t('auth.registerSubtitle')}</p>
        </div>

        <Card className="p-6">
          {issue && !issue.field && (
            <div
              className="mb-4 p-3 bg-error-50 border border-error-200 rounded-button flex items-start gap-2 text-error-700 text-sm"
              role="alert"
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
              {issue.message || t('auth.errorUnexpected')}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <fieldset>
              <legend className="text-sm font-medium text-navy-700 mb-2">
                {t('auth.accountType')}
              </legend>
              <div className="grid grid-cols-2 gap-3">
                {roleOptions.map(({ value, label, Icon }) => {
                  const active = role === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRole(value)}
                      aria-pressed={active}
                      className={`flex flex-col items-center justify-center gap-1.5 rounded-button border-2 px-3 py-3 text-sm font-medium transition-colors ${
                        active
                          ? 'border-primary-500 bg-sky text-primary-700'
                          : 'border-navy-200 bg-white text-navy-600 hover:border-navy-300'
                      }`}
                    >
                      <Icon className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />
                      {label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <Input
              label={t('auth.fullName')}
              name="fullName"
              value={formData.fullName}
              onChange={(e) => setField('fullName', e.target.value)}
              autoComplete="name"
              required
              leftIcon={<User className="w-5 h-5 text-navy-400" />}
              error={fieldError('fullName')}
            />

            {isBusiness && (
              <Input
                label={t('auth.businessName')}
                name="businessName"
                value={formData.businessName}
                onChange={(e) => setField('businessName', e.target.value)}
                required
                leftIcon={<Store className="w-5 h-5 text-navy-400" />}
                error={fieldError('businessName')}
              />
            )}

            <Input
              label={`${t('auth.phone')} (${t('common.optional')})`}
              name="phone"
              type="tel"
              inputMode="tel"
              value={formData.phone}
              onChange={(e) => setField('phone', e.target.value)}
              placeholder="61 000 0000"
              autoComplete="tel"
              leftIcon={<Phone className="w-5 h-5 text-navy-400" />}
              error={fieldError('phone') ?? phoneMessage()}
              // The normalised form is shown as it is typed, so a person can
              // correct a mistyped digit instead of discovering it at login.
              helperText={phone ? t('auth.phoneNormalised', { number: phone }) : t('auth.phoneHint')}
            />

            <Input
              label={`${t('auth.email')} (${t('common.optional')})`}
              name="email"
              type="email"
              inputMode="email"
              value={formData.email}
              onChange={(e) => setField('email', e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              leftIcon={<Mail className="w-5 h-5 text-navy-400" />}
              error={fieldError('email')}
            />

            <p className="text-xs text-navy-500">{t('auth.phoneOrEmailHint')}</p>

            <div className="relative">
              <Input
                label={t('auth.password')}
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={formData.password}
                onChange={(e) => setField('password', e.target.value)}
                required
                autoComplete="new-password"
                leftIcon={<Lock className="w-5 h-5 text-navy-400" />}
                error={fieldError('password')}
              />
              <button
                type="button"
                onClick={() => setShowPassword((shown) => !shown)}
                className="absolute end-4 top-[38px] text-navy-400 hover:text-navy-600"
                aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff className="w-5 h-5" aria-hidden="true" /> : <Eye className="w-5 h-5" aria-hidden="true" />}
              </button>
            </div>

            <div>
              <div className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  id="terms"
                  checked={acceptedTerms}
                  onChange={(e) => {
                    setAcceptedTerms(e.target.checked);
                    setIssue(null);
                  }}
                  required
                  className="mt-1 w-4 h-4 accent-primary-500"
                />
                <label htmlFor="terms" className="text-navy-600">
                  {t('auth.agreeToPrefix')}{' '}
                  <Link to="/terms" className="text-primary-600 hover:text-primary-700">
                    {t('footer.termsOfService')}
                  </Link>{' '}
                  {t('auth.andWord')}{' '}
                  <Link to="/privacy" className="text-primary-600 hover:text-primary-700">
                    {t('footer.privacyPolicy')}
                  </Link>
                </label>
              </div>
              {fieldError('terms') && (
                <p className="mt-1.5 text-sm text-error-600" role="alert">
                  {fieldError('terms')}
                </p>
              )}
            </div>

            <Button type="submit" className="w-full" size="lg" loading={loading}>
              {t('auth.signUp')}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-navy-600">
            {t('auth.haveAccount')}{' '}
            <Link to="/login" className="text-primary-600 hover:text-primary-700 font-medium">
              {t('nav.signIn')}
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}