import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, AtSign, Lock, AlertCircle } from 'lucide-react';
import { Button } from '../components/common/Button';
import { Logo } from '../components/branding/Logo';
import { Input } from '../components/common/Input';
import { Card } from '../components/common/Card';
import { useAuth } from '../context/useAuth';
import { toFieldIssue, type FieldIssue } from '../services/api';

/**
 * The sign-in form.
 *
 * One identifier field rather than two. The server reads a single
 * `identifier` as either a phone number or an email address, and splitting it
 * into a phone tab and an email tab would only make the caller choose between
 * two things they may not know yet.
 */
export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();

  const [formData, setFormData] = useState({ identifier: '', password: '' });
  const [remember, setRemember] = useState(
    () => localStorage.getItem('hq_remember') === '1',
  );
  const [showPassword, setShowPassword] = useState(false);
  const [issue, setIssue] = useState<FieldIssue | null>(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setIssue(null);
  };

  /**
   * The server's wording is specific ("Invalid email or password", "Account is
   * not active") and is written for a person, so it is shown as-is. The
   * translated strings are only the fallbacks for when it said nothing useful.
   */
  const messageFor = (issue: FieldIssue): string => {
    if (issue.message) return issue.message;
    switch (issue.status) {
      case 400:
        return t('auth.errorBadRequest');
      case 401:
        return t('auth.errorInvalidCredentials');
      case 429:
        return t('auth.errorTooManyAttempts');
      default:
        return t('auth.errorUnexpected');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIssue(null);

    const identifier = formData.identifier.trim();
    if (!identifier || !formData.password) {
      setIssue({
        field: !identifier ? 'identifier' : 'password',
        message: t('auth.errorMissingFields'),
      });
      return;
    }

    setLoading(true);
    try {
      const { role } = await login(identifier, formData.password, remember);
      // A business owner has somewhere to work; a customer does not, and the
      // directory is the point of the account.
      const next = searchParams.get('next');
      const destination = next?.startsWith('/') && !next.startsWith('//')
        ? next
        : role === 'courier' ? '/courier' : role === 'business_owner' ? '/dashboard' : '/';
      navigate(destination, { replace: true });
    } catch (error) {
      setIssue(toFieldIssue(error));
    } finally {
      setLoading(false);
    }
  };

  const fieldError = (field: FieldIssue['field']) =>
    issue && issue.field === field ? messageFor(issue) : undefined;

  return (
    <div className="min-h-screen bg-navy-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <Logo to="/" ariaLabel={t('brand.homeLabel')} variant="light" size="md" className="inline-flex mb-8" />
          <h1 className="text-3xl font-bold text-navy-900">{t('auth.signInTitle')}</h1>
          <p className="mt-2 text-navy-500">{t('auth.signInSubtitle')}</p>
        </div>

        <Card className="p-6">
          {issue && !issue.field && (
            <div
              className="mb-4 p-3 bg-error-50 border border-error-200 rounded-button flex items-start gap-2 text-error-700 text-sm"
              role="alert"
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
              {messageFor(issue)}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <Input
              label={t('auth.identifier')}
              name="identifier"
              value={formData.identifier}
              onChange={handleChange}
              placeholder={t('auth.identifierPlaceholder')}
              autoComplete="username"
              required
              leftIcon={<AtSign className="w-5 h-5 text-navy-400" />}
              error={fieldError('identifier')}
            />

            <div className="relative">
              <Input
                label={t('auth.password')}
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={formData.password}
                onChange={handleChange}
                autoComplete="current-password"
                required
                leftIcon={<Lock className="w-5 h-5 text-navy-400" />}
                error={fieldError('password')}
              />
              {/* `end-*` rather than `right-*`, so the button lands on the left
                  edge of the input in Arabic instead of covering the text. */}
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

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label htmlFor="remember" className="flex items-center gap-2 text-sm text-navy-600 cursor-pointer">
                <input
                  id="remember"
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="w-4 h-4 rounded accent-primary-500"
                />
                {t('auth.rememberMe')}
              </label>

              <Link
                to="/forgot-password"
                className="text-sm text-primary-600 hover:text-primary-700"
              >
                {t('auth.forgotPassword')}
              </Link>
            </div>

            <Button type="submit" className="w-full" size="lg" loading={loading}>
              {t('auth.signIn')}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-navy-600">
            {t('auth.noAccount')}{' '}
            <Link to="/register" className="text-primary-600 hover:text-primary-700 font-medium">
              {t('nav.signUp')}
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}