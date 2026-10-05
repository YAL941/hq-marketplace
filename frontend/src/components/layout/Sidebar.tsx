import { HTMLAttributes, forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useLocation, useNavigate, NavLink } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingBag, Users, Package, Truck, Star, BarChart3, Settings, ChevronRight, LogOut,
} from 'lucide-react';
import { Logo } from '../branding/Logo';
import { SmartImage } from '../common/SmartImage';
import { useAuth } from '../../context/AuthContext';
import type { Id } from '../../types';
import { Avatar } from './Avatar';

// Labels are translation keys, not text: they have to resolve in the active
// language at render time, and a module-level string would be frozen in English.
//
// The hrefs are built from the business id rather than written out, because
// every business-scoped screen lives under `/dashboard/business/:businessId`. A
// link that left the id out would resolve to the dashboard index, which
// forwards to whichever business happens to be first — the wrong one whenever
// the account owns more than one.
const navigation = [
  { key: 'sidebar.overview', path: '', icon: LayoutDashboard },
  { key: 'sidebar.products', path: '/products', icon: Package },
  { key: 'sidebar.services', path: '/services', icon: Truck },
  { key: 'sidebar.orders', path: '/orders', icon: ShoppingBag },
  { key: 'sidebar.customers', path: '/customers', icon: Users },
  { key: 'sidebar.reviews', path: '/reviews', icon: Star },
  { key: 'sidebar.analytics', path: '/analytics', icon: BarChart3 },
];

const businessHome = (businessId: Id) => `/dashboard/business/${businessId}`;

interface SidebarProps extends HTMLAttributes<HTMLElement> {}

export const Sidebar = forwardRef<HTMLElement, SidebarProps>(
  ({ className, ...props }, ref) => {
    const { t } = useTranslation();
    const location = useLocation();
    const navigate = useNavigate();
    const { user, businesses, currentBusiness, currentBusinessLogo, logout, setCurrentBusiness } = useAuth();
    const [collapsed, setCollapsed] = useState(false);

    /**
     * Which business the links point at.
     *
     * The URL wins over the remembered choice. Opening a bookmarked link for
     * business B while the context still remembers A would otherwise render B's
     * screen under A's navigation, and every click would move back to A.
     */
    const pathBusinessId = location.pathname.match(/^\/dashboard\/business\/([^/]+)/)?.[1];
    const activeBusinessId = pathBusinessId ?? currentBusiness?.business_id;

    /**
     * Switching workspace.
     *
     * Two things have to happen together: the context remembers which business
     * the person is working in, and the URL has to change, because the business
     * id in the path is what every request is scoped by. Setting the context
     * alone would leave the old business's order screen on screen while the
     * sidebar claimed a different one.
     */
    const switchBusiness = (businessId: Id) => {
      const next = businesses.find((business) => business.business_id === businessId);
      if (!next || next.business_id === currentBusiness?.business_id) return;
      setCurrentBusiness(next);
      navigate(businessHome(next.business_id));
    };

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
            <Logo
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

          {/*
            The workspace picker. It only becomes a control when there is a
            choice to make: one business means there is nothing to switch to, so
            it stays a label. Collapsed, the card is replaced by a link to the
            business the person is already in, because a select has nowhere to
            put its options in 80 pixels.
          */}
          {currentBusiness && !collapsed && (
            <div className="px-4 py-3 border-b border-navy-100">
              <label
                htmlFor="sidebar-current-business"
                className="block text-xs font-medium text-navy-500 uppercase tracking-wide mb-1"
              >
                {businesses.length > 1 ? t('sidebar.switchBusiness') : t('sidebar.currentBusiness')}
              </label>
              <div className="flex items-center gap-3">
                {/* 32px here: the row has room for it, and it is the only place
                    the logo is shown at a size a person can recognise. */}
                <div className="w-8 h-8 rounded-sg bg-primary-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  <SmartImage
                    value={currentBusinessLogo}
                    width={32}
                    height={32}
                    className="w-8 h-8 object-cover"
                    fallback={<ShoppingBag className="w-4 h-4 text-primary-600" aria-hidden="true" />}
                  />
                </div>
                {businesses.length > 1 ? (
                  <select
                    id="sidebar-current-business"
                    value={currentBusiness.business_id}
                    onChange={(event) => switchBusiness(event.target.value)}
                    className="flex-1 min-w-0 rounded-button border border-navy-300 bg-white px-2 py-1.5 text-sm font-medium text-navy-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    {businesses.map((business) => (
                      <option key={business.business_id} value={business.business_id}>
                        {business.business_name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-navy-900 truncate">{currentBusiness.business_name}</p>
                    <p className="text-xs text-navy-500 truncate">{currentBusiness.role_name}</p>
                  </div>
                )}
              </div>
              {businesses.length > 1 && (
                <p className="mt-1.5 text-xs text-navy-500 truncate">
                  {t('sidebar.currentBusiness')}: {currentBusiness.business_name}
                </p>
              )}
            </div>
          )}

          {currentBusiness && collapsed && (
            <div className="px-3 py-3 border-b border-navy-100 flex justify-center">
              <NavLink
                to={businessHome(currentBusiness.business_id)}
                title={currentBusiness.business_name}
                aria-label={`${t('sidebar.currentBusiness')}: ${currentBusiness.business_name}`}
                className="w-10 h-10 rounded-sg bg-primary-100 flex items-center justify-center overflow-hidden"
              >
                <SmartImage
                  value={currentBusinessLogo}
                  width={40}
                  height={40}
                  className="w-10 h-10 object-cover"
                  fallback={<ShoppingBag className="w-4 h-4 text-primary-600" aria-hidden="true" />}
                />
              </NavLink>
            </div>
          )}

          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label={t('nav.dashboardNavigation')}>
            {activeBusinessId && navigation.map((item) => {
              const href = `${businessHome(activeBusinessId)}${item.path}`;
              const isActive =
                item.path === ''
                  ? location.pathname === href
                  : location.pathname.startsWith(href);
              const label = t(item.key);
              return (
                <NavLink
                  key={item.key}
                  to={href}
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
            <NavLink
              to="/dashboard/settings"
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-button text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-50 text-primary-600'
                  : 'text-navy-600 hover:bg-navy-50 hover:text-navy-900',
                collapsed && 'justify-center'
              )}
              title={collapsed ? t('sidebar.settings') : undefined}
              aria-current={location.pathname === '/dashboard/settings' ? 'page' : undefined}
            >
              <Settings className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
              {!collapsed && <span>{t('sidebar.settings')}</span>}
            </NavLink>
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
