import { Heart, Home, Package, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { useAuth } from '../../context/useAuth';

export function MobileBottomNav() {
  const { t } = useTranslation();
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const ordersPath = isAuthenticated ? '/orders' : '/login?next=%2Forders';
  const items = [
    { to: '/', label: t('nav.home'), Icon: Home, active: location.pathname === '/' },
    {
      to: '/explore',
      label: t('nav.explore'),
      Icon: Search,
      active:
        location.pathname === '/explore' ||
        location.pathname.startsWith('/categories') ||
        location.pathname.startsWith('/business/'),
    },
    {
      to: '/favorites',
      label: t('nav.favorites'),
      Icon: Heart,
      active: location.pathname === '/favorites',
    },
    {
      to: ordersPath,
      label: t('customerOrders.title'),
      Icon: Package,
      active: location.pathname.startsWith('/orders'),
    },
  ];

  return (
    <nav
      aria-label={t('nav.mainNavigation')}
      className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-navy-200 bg-white/95 shadow-[0_-4px_20px_rgba(11,42,74,0.08)] backdrop-blur-lg md:hidden"
    >
      {items.map(({ to, label, Icon, active }) => (
        <Link
          key={label}
          to={to}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium transition-colors focus-visible:outline-none',
            active ? 'text-primary-700' : 'text-navy-500 hover:text-navy-800',
          )}
        >
          <Icon
            className={cn('h-5 w-5', active && 'fill-primary-100')}
            strokeWidth={active ? 2.4 : 1.9}
            aria-hidden="true"
          />
          <span className="max-w-full truncate">{label}</span>
        </Link>
      ))}
    </nav>
  );
}
