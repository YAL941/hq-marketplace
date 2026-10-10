import { HTMLAttributes, forwardRef, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useLocation, useNavigate, NavLink } from 'react-router-dom';
import {
  ShoppingBag, ChevronRight, LogOut,
} from 'lucide-react';
import { SmartImage } from '../common/SmartImage';
import { useAuth } from '../../context/useAuth';
import type { Id } from '../../types';
import { Avatar } from './Avatar';
import { businessDashboardPath, dashboardNavigation } from './dashboardNavigation';
import { orderApi } from '../../services/api';
import type { BusinessInboxCounts } from '../../types';

// Labels are translation keys, not text: they have to resolve in the active
// language at render time, and a module-level string would be frozen in English.
//
// The hrefs are built from the business id rather than written out, because
// every business-scoped screen lives under `/dashboard/business/:businessId`. A
// link that left the id out would resolve to the dashboard index, which
// forwards to whichever business happens to be first — the wrong one whenever
// the account owns more than one.
interface SidebarProps extends HTMLAttributes<HTMLElement> {}

export const Sidebar = forwardRef<HTMLElement, SidebarProps>(
  ({ className, ...props }, ref) => {
    const { t } = useTranslation();
    const location = useLocation();
    const navigate = useNavigate();
    const { user, businesses, currentBusiness, currentBusinessLogo, logout, setCurrentBusiness } = useAuth();
    const [collapsed, setCollapsed] = useState(false);
    const [inboxCounts, setInboxCounts] = useState<BusinessInboxCounts | null>(null);

    /**
     * Which business the links point at.
     *
     * The URL wins over the remembered choice. Opening a bookmarked link for
     * business B while the context still remembers A would otherwise render B's
     * screen under A's navigation, and every click would move back to A.
     */
    const pathBusinessId = location.pathname.match(/^\/dashboard\/business\/([^/]+)/)?.[1];
    const activeBusinessId = pathBusinessId ?? currentBusiness?.business_id;

    const loadInboxCounts = useCallback(async () => {
      if (!activeBusinessId) {
        setInboxCounts(null);
        return;
      }
      try {
        const response = await orderApi.getBusinessInboxCounts(activeBusinessId);
        setInboxCounts(response.data.data);
      } catch (error) {
        setInboxCounts(null);
        console.error('Failed to load business inbox counts:', error);
      }
    }, [activeBusinessId]);

    useEffect(() => {
      void loadInboxCounts();
      const interval = window.setInterval(() => void loadInboxCounts(), 30_000);
      return () => window.clearInterval(interval);
    }, [loadInboxCounts]);

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
      navigate(businessDashboardPath(next.business_id));
    };

    return (
      <aside
        ref={ref}
        className={cn(
          'dashboard-sidebar fixed top-16 bottom-0 start-0 z-40 hidden border-e border-navy-200 bg-white transition-all duration-300 md:block',
          collapsed ? 'w-20' : 'w-56',
          className
        )}
        {...props}
      >
        <div className="flex flex-col h-full">
          <div className={cn('flex h-10 items-center justify-end px-4', collapsed && 'justify-center')}>
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="rounded-button p-1.5 text-navy-500 transition-colors hover:bg-navy-100 hover:text-navy-900"
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
                to={businessDashboardPath(currentBusiness.business_id)}
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

          <nav className="dashboard-sidebar-nav min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-label={t('nav.dashboardNavigation')}>
            {dashboardNavigation.map((group) => (
              <div key={group.heading ?? 'overview'} className="space-y-1">
                {group.heading && !collapsed && (
                  <h2 className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-navy-500">
                    {t(group.heading)}
                  </h2>
                )}
                {group.items.map((item) => {
                  const globalPath = item.path === '/dashboard/settings';
                  const href = globalPath
                    ? item.path
                    : `${businessDashboardPath(activeBusinessId ?? currentBusiness?.business_id ?? '')}${item.path}`;
                  const isActive =
                    globalPath
                      ? location.pathname === href
                      : item.path === ''
                      ? location.pathname === href
                      : location.pathname.startsWith(href);
                  const label = t(item.key);
                  const count = item.path === '/orders'
                    ? inboxCounts?.pending_orders ?? 0
                    : item.path === '/reviews'
                    ? inboxCounts?.pending_reviews ?? 0
                    : 0;
                  const badgeLabel = item.path === '/orders'
                    ? t('sidebar.pendingOrdersBadge', { count })
                    : t('sidebar.pendingReviewsBadge', { count });
                  return (
                    <NavLink
                      key={item.key}
                      to={href}
                      className={({ isActive: active }) => cn(
                        'dashboard-nav-link relative flex items-center gap-3 rounded-xl border-s-4 px-3 py-2.5 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                        active
                          ? 'border-s-primary-600 bg-primary-50 text-primary-700 shadow-sm'
                          : 'border-s-transparent text-navy-600 hover:bg-navy-50 hover:text-navy-900',
                        collapsed && 'justify-center'
                      )}
                      title={collapsed ? (count > 0 ? `${label} (${count})` : label) : undefined}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <item.icon className="w-5 h-5 flex-shrink-0 opacity-80" aria-hidden="true" />
                      {!collapsed && <span>{label}</span>}
                      {count > 0 && (
                        <span
                          aria-label={badgeLabel}
                          className={cn(
                            'ms-auto inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white',
                            collapsed && 'absolute end-1 top-1 min-w-4 px-1 text-[10px]'
                          )}
                        >
                          {count > 99 ? '99+' : count}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            ))}
          </nav>

          {!collapsed && (
            <div className="p-4 border-t border-navy-200">
              <div className="flex items-center gap-3 px-3 py-2">
                <Avatar name={user?.full_name || 'User'} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-navy-900 truncate">{user?.full_name}</p>
                  <p className="text-xs text-navy-500 truncate">{user?.email ?? user?.phone ?? '—'}</p>
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
