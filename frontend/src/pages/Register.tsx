import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock, User, Phone, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Card } from '../components/common/Card';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import { ShoppingBag } from 'lucide-react';

export function RegisterPage() {
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
      setError('Passwords do not match');
      return;
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters');
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
      setError(err.response?.data?.error?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-navy-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <Link to="/" className="inline-flex items-center gap-2 mb-8">
            <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center">
              <ShoppingBag className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-navy-900">HQ Marketplace</span>
          </Link>
          <h2 className="text-3xl font-bold text-navy-900">Create your account</h2>
          <p className="mt-2 text-navy-500">Join thousands of businesses and customers</p>
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
              label="Full Name"
              name="fullName"
              value={formData.fullName}
              onChange={handleChange}
              placeholder="John Doe"
              required
              autoComplete="name"
              leftIcon={<User className="w-5 h-5 text-navy-400" />}
            />

            <Input
              label="Email"
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
              label="Phone (optional)"
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
                label="Password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
                required
                autoComplete="new-password"
                leftIcon={<Lock className="w-5 h-5 text-navy-400" />}
                helperText="At least 8 characters"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-[38px] text-navy-400 hover:text-navy-600"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>

            <Input
              label="Confirm Password"
              name="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="••••••••"
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
                I agree to the <Link to="/terms" className="text-primary-600 hover:text-primary-700">Terms of Service</Link> and <Link to="/privacy" className="text-primary-600 hover:text-primary-700">Privacy Policy</Link>
              </label>
            </div>

            <Button type="submit" className="w-full" size="lg" loading={loading}>
              Create Account
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-navy-600">
            Already have an account?{' '}
            <Link to="/login" className="text-primary-600 hover:text-primary-700 font-medium">
              Sign in
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}