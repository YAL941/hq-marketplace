import { CSSProperties, HTMLAttributes, forwardRef, useEffect, useState } from 'react';
import { cn } from '../../lib/utils';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { Footer } from './Footer';
import { Sidebar } from './Sidebar';
import { MobileBottomNav } from './MobileBottomNav';
import { MobileOwnerBottomNav } from './MobileOwnerBottomNav';
import { useAuth } from '../../context/useAuth';

interface MainLayoutProps extends HTMLAttributes<HTMLDivElement> {
  withSidebar?: boolean;
}

export const MainLayout = forwardRef<HTMLDivElement, MainLayoutProps>(
  ({ className, withSidebar = false, children, ...props }, ref) => {
    const { isAuthenticated, currentBusiness } = useAuth();
    const location = useLocation();
    const [sidebarWidth, setSidebarWidth] = useState(() => {
      if (typeof window === 'undefined') return 224;
      const savedWidth = Number(window.localStorage.getItem('dashboard-sidebar-width'));
      return Number.isFinite(savedWidth) && savedWidth >= 200 && savedWidth <= 400 ? savedWidth : 224;
    });
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const showSidebar = withSidebar && isAuthenticated && currentBusiness;
    const dashboardRoute =
      location.pathname.startsWith('/dashboard') ||
      location.pathname.startsWith('/admin');
    const authenticationRoute = [
      '/login',
      '/register',
      '/verify-email',
      '/forgot-password',
      '/reset-password',
    ].includes(location.pathname);
    const showMobileBottomNav = !dashboardRoute && !authenticationRoute;
    const showMobileOwnerBottomNav = dashboardRoute && !!showSidebar;

    const effectiveSidebarWidth = sidebarCollapsed ? 80 : sidebarWidth;

    useEffect(() => {
      window.localStorage.setItem('dashboard-sidebar-width', String(sidebarWidth));
    }, [sidebarWidth]);

    return (
      <div
        ref={ref}
        className={cn(
          'min-h-screen bg-navy-50 flex flex-col',
          showMobileBottomNav && 'main-layout--mobile-tabs',
          showMobileOwnerBottomNav && 'main-layout--mobile-owner-tabs',
          className,
        )}
        {...props}
      >
        <Header />
        <div className="flex-1 flex">
          {showSidebar && (
            <Sidebar
              width={sidebarWidth}
              collapsed={sidebarCollapsed}
              onWidthChange={(width) => setSidebarWidth(Math.min(400, Math.max(200, width)))}
              onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
            />
          )}
          <div
            className={cn(
              'flex-1 min-w-0 flex flex-col transition-all duration-200',
              location.pathname === '/' ? 'min-w-0' : '',
              showSidebar && 'dashboard-layout-content',
            )}
            style={{
              minHeight: 'calc(100vh - 4rem)',
              '--dashboard-sidebar-width': `${effectiveSidebarWidth}px`,
            } as CSSProperties}
          >
            <main className="flex-1">
              <Outlet />
              {children}
            </main>
          </div>
        </div>
        <Footer />
        {showMobileBottomNav && <MobileBottomNav />}
        {showMobileOwnerBottomNav && <MobileOwnerBottomNav />}
      </div>
    );
  }
);

MainLayout.displayName = 'MainLayout';