import { ClipboardList, LayoutDashboard, MoreHorizontal, Package, ShoppingBag, Star, Warehouse } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { dashboardNavigationHref } from './dashboardNavigation';
import { useAuth } from '../../context/useAuth';

export function MobileOwnerBottomNav() {
  const { t } = useTranslation();
  const location = useLocation();
  const { currentBusiness } = useAuth();
  if (!currentBusiness) return null;

  const businessId = currentBusiness.business_id;
  const items = [
    { path: '', label: t('sidebar.overview'), Icon: LayoutDashboard },
    { path: '/orders', label: t('sidebar.orders'), Icon: ShoppingBag },
    { path: '/products', label: t('sidebar.products'), Icon: Package },
    { path: '/inventory', label: t('sidebar.inventory'), Icon: ClipboardList },
    { path: '/wholesale', label: t('sidebar.wholesale'), Icon: Warehouse },
    { path: '/reviews', label: t('sidebar.reviews'), Icon: Star },
    { path: '/dashboard/settings', label: t('sidebar.settings'), Icon: MoreHorizontal },
  ];

  return (
    <nav
      aria-label={t('nav.dashboardNavigation')}
      className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-7 border-t border-navy-200 bg-white/95 shadow-[0_-4px_20px_rgba(11,42,74,0.08)] backdrop-blur-lg md:hidden"
    >
      {items.map(({ path, label, Icon }) => {
        const to = dashboardNavigationHref(path, businessId);
        const active = path === '/dashboard/settings'
          ? location.pathname === path
          : path === ''
            ? location.pathname === `/dashboard/business/${businessId}`
            : location.pathname === to || location.pathname.startsWith(`${to}/`);

        return (
          <Link
            key={path || 'overview'}
            to={to}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-medium transition-colors focus-visible:outline-none sm:text-[11px]',
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
        );
      })}
    </nav>
  );
}
