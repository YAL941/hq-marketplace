import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, Mail } from 'lucide-react';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { Input } from '../components/common/Input';
import { Logo } from '../components/branding/Logo';
import { authApi, toFieldIssue } from '../services/api';

export function VerifyEmailPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const businessId = searchParams.get('businessId');
  const loginNext = businessId
    ? `/login?next=${encodeURIComponent(`/list-your-business?complete=${businessId}`)}`
    : '/login';

  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [code, setCode] = useState('');
  const [verified, setVerified] = useState(false);
  const [resendNotice, setResendNotice] = useState(false);
  const [issue, setIssue] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const initialSendFailed = searchParams.get('sent') === '0';

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    setIssue('');
    setResendNotice(false);
    setLoading(true);
    try {
      await authApi.verifyEmail({ email: email.trim(), code: code.trim() });
      setVerified(true);
    } catch (error) {
      const fieldIssue = toFieldIssue(error);
      setIssue(fieldIssue.message?.toLowerCase().includes('verification code is invalid')
        ? t('auth.verificationInvalidCode')
        : fieldIssue.message || t('auth.errorUnexpected'));
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setIssue('');
    setResendNotice(false);
    setResending(true);
    try {
      await authApi.resendEmailVerification(email.trim());
      setResendNotice(true);
    } catch (error) {
      const fieldIssue = toFieldIssue(error);
      setIssue(fieldIssue.message || t('auth.errorUnexpected'));
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-navy-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <Logo to="/" ariaLabel={t('brand.homeLabel')} variant="light" size="md" intro className="inline-flex mb-8" />
          <h1 className="text-3xl font-bold text-navy-900">{t('auth.verifyEmailTitle')}</h1>
          <p className="mt-2 text-navy-500">{t('auth.verifyEmailBody')}</p>
        </div>

        <Card className="p-6">
          {initialSendFailed && !verified && (
            <div className="mb-4 rounded-button border border-warning-600/20 bg-warning-50 p-3 text-sm text-navy-700" role="status">
              {t('auth.verificationInitialSendFailed')}
            </div>
          )}
          {issue && (
            <div className="mb-4 flex items-start gap-2 rounded-button border border-error-200 bg-error-50 p-3 text-sm text-error-700" role="alert">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
              {issue}
            </div>
          )}
          {resendNotice && (
            <div className="mb-4 rounded-button border border-success-600/20 bg-success-50 p-3 text-sm text-success-700" role="status">
              {t('auth.verificationResendSent')}
            </div>
          )}
          {verified ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-success-700" role="status">{t('auth.verificationComplete')}</p>
              <Link to={loginNext} className="inline-flex min-h-11 w-full items-center justify-center rounded-button bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700">
                {t('auth.backToSignIn')}
              </Link>
            </div>
          ) : (
            <>
              <form onSubmit={verify} className="space-y-5" noValidate>
                <Input
                  label={t('auth.email')}
                  name="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  leftIcon={<Mail className="h-5 w-5 text-navy-400" />}
                />
                <Input
                  label={t('auth.verificationCode')}
                  name="code"
                  type="text"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                />
                <Button type="submit" className="w-full" size="lg" loading={loading}>
                  {t('auth.verifyEmail')}
                </Button>
              </form>
              <Button
                type="button"
                variant="outline"
                className="mt-3 w-full"
                onClick={() => void resend()}
                loading={resending}
                disabled={!email.trim() || loading}
              >
                {t('auth.resendVerificationCode')}
              </Button>
            </>
          )}
          {!verified && (
            <p className="mt-6 text-center text-sm text-navy-600">
              <Link to={loginNext} className="font-medium text-primary-600 hover:text-primary-700">
                {t('auth.backToSignIn')}
              </Link>
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
