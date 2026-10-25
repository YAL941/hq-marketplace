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
      return savedWidth === 0 || (Number.isFinite(savedWidth) && savedWidth >= 200 && savedWidth <= 400)
        ? savedWidth
        : 224;
    });
    const [lastExpandedSidebarWidth, setLastExpandedSidebarWidth] = useState(() => {
      if (typeof window === 'undefined') return 224;
      const savedWidth = Number(window.localStorage.getItem('dashboard-sidebar-width'));
      const savedExpandedWidth = Number(window.localStorage.getItem('dashboard-sidebar-last-width'));
      if (Number.isFinite(savedExpandedWidth) && savedExpandedWidth >= 200 && savedExpandedWidth <= 400) {
        return savedExpandedWidth;
      }
      return Number.isFinite(savedWidth) && savedWidth >= 200 && savedWidth <= 400 ? savedWidth : 224;
    });
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

    useEffect(() => {
      window.localStorage.setItem('dashboard-sidebar-width', String(sidebarWidth));
      if (sidebarWidth >= 200) {
        window.localStorage.setItem('dashboard-sidebar-last-width', String(sidebarWidth));
      }
    }, [sidebarWidth]);

    const updateSidebarWidth = (requestedWidth: number) => {
      const nextWidth = requestedWidth < 200 ? 0 : Math.min(400, requestedWidth);
      setSidebarWidth(nextWidth);
      if (nextWidth >= 200) setLastExpandedSidebarWidth(nextWidth);
    };

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
              onWidthChange={updateSidebarWidth}
              onRestore={() => updateSidebarWidth(lastExpandedSidebarWidth)}
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
              '--dashboard-sidebar-width': `${sidebarWidth}px`,
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