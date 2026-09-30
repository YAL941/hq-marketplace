import { AsideHTMLAttributes, forwardRef, useState } from 'react';
import { cn } from '../lib/utils';
import { Link, useLocation, NavLink } from 'react-router-dom';
import { LayoutDashboard, ShoppingBag, Users, Package, Truck, Star, MessageSquare, BarChart3, Settings, ChevronRight, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Avatar } from './Avatar';
import { Button } from '../common/Button';

const navigation = [
  { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Products', href: '/dashboard/products', icon: Package },
  { name: 'Services', href: '/dashboard/services', icon: Truck },
  { name: 'Orders', href: '/dashboard/orders', icon: ShoppingBag },
  { name: 'Customers', href: '/dashboard/customers', icon: Users },
  { name: 'Reviews', href: '/dashboard/reviews', icon: Star },
  { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3 },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings },
];

interface SidebarProps extends AsideHTMLAttributes<HTMLAsideElement> {}

export const Sidebar = forwardRef<HTMLAsideElement, SidebarProps>(
  ({ className, ...props }, ref) => {
    const location = useLocation();
    const { user, businesses, currentBusiness, setCurrentBusiness, logout } = useAuth();
    const [collapsed, setCollapsed] = useState(false);

    return (
      <aside
        ref={ref}
        className={cn(
          'fixed inset-y-0 left-0 z-40 bg-white border-r border-navy-200 transition-all duration-300',
          collapsed ? 'w-20' : 'w-64',
          className
        )}
        {...props}
      >
        <div className="flex flex-col h-full">
          <div className={cn('flex items-center justify-between h-16 px-4 border-b border-navy-200', collapsed && 'justify-center')}>
            <Link to="/dashboard" className="flex items-center gap-2" aria-label="HQ Marketplace Dashboard">
              <div className="w-9 h-9 rounded-xl bg-primary-600 flex items-center justify-center flex-shrink-0">
                <ShoppingBag className="w-5 h-5 text-white" />
              </div>
              {!collapsed && <span className="text-xl font-bold text-navy-900">HQ Business</span>}
            </Link>
            <button
              onClick={() => setCollapsed(!collapsed)}
              className={cn('p-1.5 rounded-button hover:bg-navy-100 transition-colors', collapsed && 'ml-auto')}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <ChevronRight className={cn('w-5 h-5 text-navy-500 transition-transform', collapsed && 'rotate-180')} />
            </button>
          </div>

          {currentBusiness && !collapsed && (
            <div className="px-4 py-3 border-b border-navy-100">
              <p className="text-xs font-medium text-navy-500 uppercase tracking-wide mb-1">Current Business</p>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
                  <ShoppingBag className="w-4 h-4 text-primary-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-navy-900 truncate">{currentBusiness.business_name}</p>
                  <p className="text-xs text-navy-500 capitalize">{currentBusiness.role_key.replace('business_', '')}</p>
                </div>
              </div>
            </div>
          )}

          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Dashboard navigation">
            {navigation.map((item) => {
              const isActive = location.pathname === item.href || location.pathname.startsWith(item.href + '/');
              return (
                <NavLink
                  key={item.name}
                  to={item.href}
                  className={({ isActive: active }) => cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-button text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary-50 text-primary-600'
                      : 'text-navy-600 hover:bg-navy-50 hover:text-navy-900',
                    collapsed && 'justify-center'
                  )}
                  title={collapsed ? item.name : undefined}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
                  {!collapsed && <span>{item.name}</span>}
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
                    Switch Business
                  </button>
                )}
                <button
                  onClick={logout}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-error-600 hover:bg-error-50 rounded-button transition-colors"
                >
                  <LogOut className="w-5 h-5" />
                  Sign Out
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