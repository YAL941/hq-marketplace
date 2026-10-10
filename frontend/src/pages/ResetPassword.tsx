import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Lock } from 'lucide-react';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { Input } from '../components/common/Input';
import { authApi } from '../services/api';

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!token) {
      setError(t('auth.resetInvalidLink'));
      return;
    }
    if (password.length < 8 || password.length > 128) {
      setError(t('auth.passwordHint'));
      return;
    }
    if (password !== confirmation) {
      setError(t('auth.passwordsDoNotMatch'));
      return;
    }
    setLoading(true);
    try {
      await authApi.confirmPasswordReset({ token, password });
      setDone(true);
    } catch {
      setError(t('auth.resetInvalidLink'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center bg-navy-50 px-4 py-12">
      <Card className="w-full max-w-md p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-navy-900">{t('auth.resetTitle')}</h1>
        <p className="mt-2 text-navy-600">{t('auth.resetBody')}</p>
        {done ? (
          <p className="mt-5 rounded-lg border border-success-500 bg-success-50 p-4 text-sm text-success-600" role="status">
            {t('auth.resetComplete')}
          </p>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-5">
            {error && <p className="text-sm text-error-700" role="alert">{error}</p>}
            <Input
              label={t('auth.password')}
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              leftIcon={<Lock className="h-5 w-5 text-navy-400" aria-hidden="true" />}
            />
            <Input
              label={t('auth.confirmPassword')}
              type="password"
              autoComplete="new-password"
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <Button type="submit" className="w-full" loading={loading}>{t('auth.updatePassword')}</Button>
          </form>
        )}
        <Link to="/login" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary-700">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /> {t('auth.backToSignIn')}
        </Link>
      </Card>
    </div>
  );
}
