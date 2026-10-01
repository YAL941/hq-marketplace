import { HTMLAttributes, forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useLocation, NavLink } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingBag, Users, Package, Truck, Star, BarChart3, Settings, ChevronRight, LogOut,
} from 'lucide-react';
import { BrandMark } from '../branding/BrandMark';
import { useAuth } from '../../context/AuthContext';
import { Avatar } from './Avatar';

// Labels are translation keys, not text: they have to resolve in the active
// language at render time, and a module-level string would be frozen in English.
const navigation = [
  { key: 'sidebar.overview', href: '/dashboard', icon: LayoutDashboard },
  { key: 'sidebar.products', href: '/dashboard/products', icon: Package },
  { key: 'sidebar.services', href: '/dashboard/services', icon: Truck },
  { key: 'sidebar.orders', href: '/dashboard/orders', icon: ShoppingBag },
  { key: 'sidebar.customers', href: '/dashboard/customers', icon: Users },
  { key: 'sidebar.reviews', href: '/dashboard/reviews', icon: Star },
  { key: 'sidebar.analytics', href: '/dashboard/analytics', icon: BarChart3 },
  { key: 'sidebar.settings', href: '/dashboard/settings', icon: Settings },
];

interface SidebarProps extends HTMLAttributes<HTMLElement> {}

export const Sidebar = forwardRef<HTMLElement, SidebarProps>(
  ({ className, ...props }, ref) => {
    const { t } = useTranslation();
    const location = useLocation();
    const { user, businesses, currentBusiness, logout } = useAuth();
    const [collapsed, setCollapsed] = useState(false);

    return (
      <aside
        ref={ref}
        className={cn(
          // start-0 and border-e keep the sidebar on the reading edge in both
          // directions instead of being pinned to the physical left.
          'fixed inset-y-0 start-0 z-40 bg-white border-e border-navy-200 transition-all duration-300',
          collapsed ? 'w-20' : 'w-64',
          className
        )}
        {...props}
      >
        <div className="flex flex-col h-full">
          <div className={cn('flex items-center justify-between h-16 px-4 border-b border-navy-200', collapsed && 'justify-center')}>
            <BrandMark
                to="/dashboard"
                ariaLabel={t('brand.dashboardLabel')}
                variant="light"
                size="sm"
                className={cn('min-w-0', collapsed && '[&>span:last-child]:hidden')}
              />
            <button
              onClick={() => setCollapsed(!collapsed)}
              className={cn('p-1.5 rounded-button hover:bg-navy-100 transition-colors', collapsed && 'ms-auto')}
              aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
              aria-expanded={!collapsed}
            >
              <ChevronRight
                className={cn(
                  'w-5 h-5 text-navy-500 transition-transform',
                  // The chevron points at the side the drawer collapses toward,
                  // which flips with the writing direction.
                  collapsed ? 'rotate-180' : ''
                )}
              />
            </button>
          </div>

          {currentBusiness && !collapsed && (
            <div className="px-4 py-3 border-b border-navy-100">
              <p className="text-xs font-medium text-navy-500 uppercase tracking-wide mb-1">
                {t('sidebar.currentBusiness')}
              </p>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-sg bg-primary-100 flex items-center justify-center flex-shrink-0">
                  <ShoppingBag className="w-4 h-4 text-primary-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-navy-900 truncate">{currentBusiness.business_name}</p>
                  <p className="text-xs text-navy-500 capitalize">{currentBusiness.role_key.replace('business_', '')}</p>
                </div>
              </div>
            </div>
          )}

          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label={t('nav.dashboardNavigation')}>
            {navigation.map((item) => {
              const isActive = location.pathname === item.href || location.pathname.startsWith(item.href + '/');
              const label = t(item.key);
              return (
                <NavLink
                  key={item.key}
                  to={item.href}
                  className={({ isActive: active }) => cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-button text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary-50 text-primary-600'
                      : 'text-navy-600 hover:bg-navy-50 hover:text-navy-900',
                    collapsed && 'justify-center'
                  )}
                  title={collapsed ? label : undefined}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
                  {!collapsed && <span>{label}</span>}
                </NavLink>
              );
            })}
          </nav>

          {!collapsed && (
            <div className="p-4 border-t border-navy-200">
              <div className="flex items-center gap-3 px-3 py-2">
                <Avatar name={user?.full_name || 'User'} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-navy-900 truncate">{user?.full_name}</p>
                  <p className="text-xs text-navy-500 truncate">{user?.email}</p>
                </div>
              </div>
              <div className="mt-3 space-y-1">
                {businesses.length > 1 && (
                  <button className="w-full flex items-center gap-3 px-3 py-2 text-sm text-navy-600 hover:bg-navy-50 hover:text-navy-900 rounded-button transition-colors">
                    <Users className="w-5 h-5" />
                    {t('sidebar.switchBusiness')}
                  </button>
                )}
                <button
                  onClick={logout}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-error-600 hover:bg-error-50 rounded-button transition-colors"
                >
                  <LogOut className="w-5 h-5" />
                  {t('nav.signOut')}
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    );
  }
);

Sidebar.displayName = 'Sidebar';
