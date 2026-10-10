import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Mail } from 'lucide-react';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { Input } from '../components/common/Input';
import { authApi } from '../services/api';

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(false);
    try {
      await authApi.requestPasswordReset(email.trim());
      setSent(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center bg-navy-50 px-4 py-12">
      <Card className="w-full max-w-md p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-navy-900">{t('auth.resetRequestTitle')}</h1>
        <p className="mt-2 leading-7 text-navy-600">{t('auth.resetRequestBody')}</p>
        {sent ? (
          <p className="mt-5 rounded-lg border border-success-500 bg-success-50 p-4 text-sm text-success-600" role="status">
            {t('auth.resetRequestSent')}
          </p>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-5">
            {error && <p className="text-sm text-error-700" role="alert">{t('auth.errorUnexpected')}</p>}
            <Input
              label={t('auth.email')}
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              leftIcon={<Mail className="h-5 w-5 text-navy-400" aria-hidden="true" />}
            />
            <Button type="submit" className="w-full" loading={loading}>{t('auth.sendResetLink')}</Button>
          </form>
        )}
        <Link to="/login" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary-700">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /> {t('auth.backToSignIn')}
        </Link>
      </Card>
    </div>
  );
}
