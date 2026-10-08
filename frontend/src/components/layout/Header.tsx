import { HTMLAttributes, forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/useAuth';
import { Menu, X, ShoppingBag, LayoutDashboard, ChevronDown, Store, Shield } from 'lucide-react';
import { Logo } from '../branding/Logo';
import { Button } from '../common/Button';
import { SearchBar } from '../common/SearchBar';
import { SmartImage } from '../common/SmartImage';
import { Avatar } from './Avatar';
import { LanguageSwitcher } from './LanguageSwitcher';

interface HeaderProps extends HTMLAttributes<HTMLElement> {}

export const Header = forwardRef<HTMLElement, HeaderProps>(
  ({ className, ...props }, ref) => {
    const { t } = useTranslation();
    const location = useLocation();
    const navigate = useNavigate();
    const { user, isAuthenticated, logout, businesses, currentBusiness, currentBusinessLogo, setCurrentBusiness, hasPlatformRole } = useAuth();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const [businessMenuOpen, setBusinessMenuOpen] = useState(false);

    const handleSearch = (query: string) => {
      if (query.trim()) {
        navigate(`/explore?search=${encodeURIComponent(query)}`);
      }
    };

    const isDashboard = location.pathname.startsWith('/dashboard') || location.pathname.startsWith('/business/') || location.pathname.startsWith('/admin');
    const isPublic = !isDashboard;
    const isLoginPage = location.pathname === '/login';

    return (
      <header
        ref={ref}
        className={cn(
          'sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-navy-200',
          'transition-shadow duration-200',
          className
        )}
        {...props}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-8">
              <div className="hidden sm:block">
                <Logo to="/" ariaLabel={t('brand.homeLabel')} variant="light" size="sm" />
              </div>
              <div className="sm:hidden">
                <Logo to="/" ariaLabel={t('brand.homeLabel')} variant="light" size="sm" className="[&>span:last-child]:hidden" />
              </div>

              {isPublic && !isLoginPage && (
                <nav className="hidden md:flex items-center gap-6" aria-label={t('nav.mainNavigation')}>
                  <Link to="/explore" className={cn('text-sm font-medium transition-colors', location.pathname === '/explore' ? 'text-primary-600' : 'text-navy-600 hover:text-navy-900')}>
                    {t('nav.explore')}
                  </Link>
                  <Link to="/categories" className={cn('text-sm font-medium transition-colors', location.pathname === '/categories' ? 'text-primary-600' : 'text-navy-600 hover:text-navy-900')}>
                    {t('nav.categories')}
                  </Link>
                  <Link to="/favorites" className={cn('text-sm font-medium transition-colors', location.pathname === '/favorites' ? 'text-primary-600' : 'text-navy-600 hover:text-navy-900')}>
                    {t('nav.favorites')}
                  </Link>
                </nav>
              )}

              {isDashboard && (
                <nav className="hidden md:flex items-center gap-4" aria-label={t('nav.dashboardNavigation')}>
                  <Link to="/dashboard" className={cn('text-sm font-medium transition-colors', location.pathname === '/dashboard' ? 'text-primary-600' : 'text-navy-600 hover:text-navy-900')}>
                    <LayoutDashboard className="w-4 h-4 inline me-1" /> {t('nav.dashboard')}
                  </Link>
                  {currentBusiness && (
                    <div className="relative">
                      <button
                        onClick={() => setBusinessMenuOpen(!businessMenuOpen)}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-navy-700 hover:text-navy-900 rounded-button hover:bg-navy-100 transition-colors"
                      >
                        <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center">
                    {/*
                      24px, at the small end of the range the design uses for
                      chrome. It sits next to the business name, so `alt` is empty
                      and the ShoppingBag icon stands in until there is a logo.
                      Lazy here: the header is sticky and this changes with the
                      business, but it is never the reason a visitor stayed.
                    */}
                    <SmartImage
                      value={currentBusinessLogo}
                      width={24}
                      height={24}
                      className="w-6 h-6 rounded-sg object-cover"
                      fallback={<ShoppingBag className="w-4 h-4 text-navy-500" aria-hidden="true" />}
                    />
                  </div>
                  {currentBusiness.business_name}
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      {businessMenuOpen && (
                        <div className="absolute end-0 mt-2 w-56 bg-white rounded-card shadow-card border border-navy-200 py-1 z-10">
                          {businesses.map((biz) => (
                            <button
                              key={biz.business_id}
                              onClick={() => setCurrentBusiness(biz)}
                              className={cn('w-full px-4 py-2 text-start text-sm transition-colors', currentBusiness.business_id === biz.business_id ? 'bg-primary-50 text-primary-600' : 'text-navy-700 hover:bg-navy-50')}
                            >
                              {biz.business_name}
                            </button>
                          ))}
                        </div>
                      )}
                       </div>
                     )}

                     {hasPlatformRole('platform_admin') && (
                       <Link to="/admin/businesses" className={cn('flex items-center text-sm font-medium transition-colors', location.pathname.startsWith('/admin') ? 'text-primary-600' : 'text-navy-600 hover:text-navy-900')}>
                         <Shield className="w-4 h-4 inline me-1" /> {t('nav.admin')}
                       </Link>
                     )}
                 </nav>
              )}
            </div>

            {!isLoginPage && (
              <div className="flex-1 max-w-xl mx-8 hidden lg:block">
                <SearchBar
                  value={searchQuery}
                  onChange={setSearchQuery}
                  onSearch={handleSearch}
                  placeholder={t('search.placeholder')}
                />
              </div>
            )}

            {!isLoginPage && (
              <div className="flex items-center gap-3">
              {isPublic && (
                <>
                  <Link to="/login" className="hidden sm:block px-4 py-2 text-sm font-medium text-navy-700 hover:text-navy-900 transition-colors">
                    {t('nav.signIn')}
                  </Link>
                  <Link to="/register" className="hidden sm:block">
                    <Button size="sm">{t('nav.getStarted')}</Button>
                  </Link>
                </>
              )}

              {isAuthenticated && (
                <div className="relative">
                  <button
                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-button hover:bg-navy-100 transition-colors"
                  >
                    <Avatar name={user?.full_name || 'User'} size="sm" />
                    <span className="hidden sm:block text-sm font-medium text-navy-700">{user?.full_name}</span>
                    <ChevronDown className="w-4 h-4 text-navy-500" />
                  </button>
                  {userMenuOpen && (
                    <div className="absolute end-0 mt-2 w-48 bg-white rounded-card shadow-card border border-navy-200 py-1 z-10">
                      <div className="px-4 py-2 border-b border-navy-100">
                        <p className="text-sm font-medium text-navy-900">{user?.full_name}</p>
                        <p className="text-xs text-navy-500">{user?.email ?? user?.phone ?? '—'}</p>
                      </div>
                      {/*
                        The profile page does not exist yet, so the
                        menu item stays hidden rather than linking to
                        a route that falls through to the home page.
                        It comes back when the page does.
                      */}
                      {/*
                        Listing a business is offered to every signed-in account,
                        not only to owners: an account that registered as a
                        customer may decide to list a business later, and the
                        server lets it, giving that account its first membership.
                      */}
                      <Link to="/list-your-business" className="block px-4 py-2 text-sm text-navy-700 hover:bg-navy-50">
                        <Store className="w-4 h-4 inline me-2" /> {t('nav.listYourBusiness')}
                      </Link>
                      {currentBusiness && (
                        <Link to="/dashboard" className="block px-4 py-2 text-sm text-navy-700 hover:bg-navy-50">
                          <LayoutDashboard className="w-4 h-4 inline me-2" /> {t('nav.dashboard')}
                        </Link>
                      )}
                      <hr className="my-1 border-navy-100" />
                      <button
                        onClick={logout}
                        className="w-full text-start px-4 py-2 text-sm text-error-600 hover:bg-error-50 flex items-center gap-2"
                      >
                        {t('nav.signOut')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <LanguageSwitcher />

              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 rounded-button hover:bg-navy-100 text-navy-600"
                aria-label={t('nav.toggleMenu')}
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
              </div>
            )}
          </div>
        </div>

        {!isLoginPage && mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-navy-100 animate-slide-down">
            <div className="px-4 sm:px-6 mb-3 lg:hidden">
              <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                onSearch={handleSearch}
                placeholder={t('search.placeholder')}
              />
            </div>
            <nav className="flex flex-col gap-2 px-4 sm:px-6">
              <Link to="/explore" className="px-3 py-2 text-navy-700 hover:bg-navy-50 rounded-button">{t('nav.explore')}</Link>
              <Link to="/categories" className="px-3 py-2 text-navy-700 hover:bg-navy-50 rounded-button">{t('nav.categories')}</Link>
              <Link to="/favorites" className="px-3 py-2 text-navy-700 hover:bg-navy-50 rounded-button">{t('nav.favorites')}</Link>
              <Link to="/faq" className="px-3 py-2 text-navy-700 hover:bg-navy-50 rounded-button">{t('footer.faq')}</Link>
              {isAuthenticated ? (
                <>
                  <Link to="/list-your-business" className="px-3 py-2 text-navy-700 hover:bg-navy-50 rounded-button flex items-center gap-2">
                    <Store className="w-4 h-4" /> {t('nav.listYourBusiness')}
                  </Link>
                   {currentBusiness && (
                     <Link to="/dashboard" className="px-3 py-2 text-navy-700 hover:bg-navy-50 rounded-button flex items-center gap-2">
                       <LayoutDashboard className="w-4 h-4" /> {t('nav.dashboard')}
                     </Link>
                   )}
                   {hasPlatformRole('platform_admin') && (
                     <Link to="/admin/businesses" className="px-3 py-2 text-navy-700 hover:bg-navy-50 rounded-button flex items-center gap-2">
                       <Shield className="w-4 h-4" /> {t('nav.admin')}
                     </Link>
                   )}
                   <button onClick={logout} className="px-3 py-2 text-start text-error-600 hover:bg-error-50 rounded-button w-full">
                     {t('nav.signOut')}
                   </button>
                </>
              ) : (
                <>
                  <Link to="/login" className="px-3 py-2 text-navy-700 hover:bg-navy-50 rounded-button">{t('nav.signIn')}</Link>
                  <Link to="/register" className="px-3 py-2 text-primary-600 hover:bg-primary-50 rounded-button font-medium">{t('nav.getStarted')}</Link>
                </>
              )}
            </nav>
            {/* The popover variant would be clipped by the drawer's own
                overflow, so the mobile list is rendered inline instead. */}
            <div className="px-4 sm:px-6 pt-2">
              <LanguageSwitcher variant="inline" />
            </div>
          </div>
        )}
      </header>
    );
  }
);

Header.displayName = 'Header';
