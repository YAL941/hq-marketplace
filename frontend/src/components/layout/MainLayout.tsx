import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { Footer } from './Footer';
import { Sidebar } from './Sidebar';
import { BusinessStatusBanner } from '../business/BusinessStatusBanner';
import { useAuth } from '../../context/AuthContext';
import type { Id } from '../../types';

interface MainLayoutProps extends HTMLAttributes<HTMLDivElement> {
  withSidebar?: boolean;
}

export const MainLayout = forwardRef<HTMLDivElement, MainLayoutProps>(
  ({ className, withSidebar = false, children, ...props }, ref) => {
    const { isAuthenticated, currentBusiness } = useAuth();
    const location = useLocation();
    const showSidebar = withSidebar && isAuthenticated && currentBusiness;

    /**
     * The business the banner describes.
     *
     * Read from the path rather than from the remembered selection, for the same
     * reason the sidebar does: opening a bookmarked link for another business
     * would otherwise put one business's status above another business's screen.
     * `/dashboard/settings` carries no id in its path, so it falls back to the
     * selection, which is what that screen edits.
     */
    const pathBusinessId = location.pathname.match(/^\/dashboard\/business\/([^/]+)/)?.[1];
    const bannerBusinessId: Id | '' = showSidebar ? (pathBusinessId ?? currentBusiness?.business_id ?? '') : '';

    return (
      <div ref={ref} className={cn('min-h-screen bg-navy-50 flex flex-col', className)} {...props}>
        <Header />
        <div className="flex-1 flex">
          {showSidebar && <Sidebar />}
          <div
            className={cn(
              'flex-1 flex flex-col transition-all duration-300',
              showSidebar ? 'lg:ms-64' : ''
            )}
            style={{ minHeight: 'calc(100vh - 4rem)' }}
          >
            {/*
              Inside the scrolling column rather than above it, so the banner
              travels with the content instead of staying pinned while the
              sidebar scrolls beside it.
            */}
            {bannerBusinessId && <BusinessStatusBanner businessId={bannerBusinessId} />}
            <main className="flex-1">
              <Outlet />
              {children}
            </main>
          </div>
        </div>
        <Footer />
      </div>
    );
  }
);

MainLayout.displayName = 'MainLayout';