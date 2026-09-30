import { DivHTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/utils';
import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { Footer } from './Footer';
import { Sidebar } from './Sidebar';
import { useAuth } from '../../context/AuthContext';

interface MainLayoutProps extends DivHTMLAttributes<HTMLDivElement> {
  withSidebar?: boolean;
}

export const MainLayout = forwardRef<HTMLDivElement, MainLayoutProps>(
  ({ className, withSidebar = false, children, ...props }, ref) => {
    const { isAuthenticated, currentBusiness } = useAuth();
    const showSidebar = withSidebar && isAuthenticated && currentBusiness;

    return (
      <div ref={ref} className={cn('min-h-screen bg-navy-50 flex flex-col', className)} {...props}>
        <Header />
        <div className="flex-1 flex">
          {showSidebar && <Sidebar />}
          <main
            className={cn(
              'flex-1 transition-all duration-300',
              showSidebar ? 'lg:ml-64' : ''
            )}
            style={{ minHeight: 'calc(100vh - 4rem)' }}
          >
            <Outlet />
            {children}
          </main>
        </div>
        <Footer />
      </div>
    );
  }
);

MainLayout.displayName = 'MainLayout';