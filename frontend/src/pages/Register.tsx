import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock, User, Phone, AlertCircle } from 'lucide-react';
import { BrandMark } from '../components/branding/BrandMark';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Card } from '../components/common/Card';
import { useAuth } from '../context/AuthContext';

const MIN_PASSWORD_LENGTH = 8;

export function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { register } = useAuth();
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError(t('auth.passwordsDoNotMatch'));
      return;
    }

    if (formData.password.length < MIN_PASSWORD_LENGTH) {
      setError(t('auth.passwordTooShort', { count: MIN_PASSWORD_LENGTH }));
      return;
    }

    setLoading(true);
    try {
      await register({
        email: formData.email,
        password: formData.password,
        fullName: formData.fullName,
        phone: formData.phone || undefined,
      });
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || t('auth.registrationFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-navy-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <BrandMark to="/" ariaLabel={t('brand.homeLabel')} variant="light" size="md" className="inline-flex mb-8" />
          <h2 className="text-3xl font-bold text-navy-900">{t('auth.registerTitle')}</h2>
          <p className="mt-2 text-navy-500">{t('auth.registerSubtitle')}</p>
        </div>

        <Card className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-error-50 border border-error-200 rounded-button flex items-center gap-2 text-error-700 text-sm" role="alert">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <Input
              label={t('auth.fullName')}
              name="fullName"
              value={formData.fullName}
              onChange={handleChange}
              autoComplete="name"
              required
              leftIcon={<User className="w-5 h-5 text-navy-400" />}
            />

            <Input
              label={t('auth.email')}
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="you@example.com"
              required
              autoComplete="email"
              leftIcon={<Mail className="w-5 h-5 text-navy-400" />}
            />

            <Input
              label={`${t('auth.phone')} (${t('common.optional')})`}
              name="phone"
              type="tel"
              value={formData.phone}
              onChange={handleChange}
              placeholder="+252 61 234 5678"
              autoComplete="tel"
              leftIcon={<Phone className="w-5 h-5 text-navy-400" />}
            />

            <div className="relative">
              <Input
                label={t('auth.password')}
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={formData.password}
                onChange={handleChange}
                required
                autoComplete="new-password"
                leftIcon={<Lock className="w-5 h-5 text-navy-400" />}
                helperText={t('auth.passwordHint')}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute end-4 top-[38px] text-navy-400 hover:text-navy-600"
                aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>

            <Input
              label={t('auth.confirmPassword')}
              name="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              value={formData.confirmPassword}
              onChange={handleChange}
              required
              autoComplete="new-password"
              leftIcon={<Lock className="w-5 h-5 text-navy-400" />}
            />

            <div className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                id="terms"
                required
                className="mt-1 w-4 h-4 text-primary-600 border-navy-300 rounded focus:ring-primary-500"
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

            <Button type="submit" className="w-full" size="lg" loading={loading}>
              {t('auth.signUp')}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-navy-600">
            {t('auth.haveAccount')}{' '}
            <Link to="/login" className="text-primary-600 hover:text-primary-700 font-medium">
              {t('nav.signIn')}
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
