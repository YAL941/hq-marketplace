import { HTMLAttributes, forwardRef, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/useAuth';
import { Menu, X, LayoutDashboard, ChevronDown, Store, Shield, Sun, Moon, Check, Package } from 'lucide-react';
import { Logo } from '../branding/Logo';
import { Button } from '../common/Button';
import { SearchBar } from '../common/SearchBar';
import { SmartImage } from '../common/SmartImage';
import { Avatar } from './Avatar';
import { LanguageSwitcher } from './LanguageSwitcher';
import { useTheme } from '../../context/useTheme';
import { businessDashboardPath, dashboardNavigation } from './dashboardNavigation';

interface HeaderProps extends HTMLAttributes<HTMLElement> {}

export const Header = forwardRef<HTMLElement, HeaderProps>(
  ({ className, ...props }, ref) => {
    const { t } = useTranslation();
    const location = useLocation();
    const navigate = useNavigate();
    const { theme, setTheme } = useTheme();
    const { user, isAuthenticated, logout, businesses, currentBusiness, currentBusinessLogo, setCurrentBusiness, hasPlatformRole } = useAuth();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const [businessMenuOpen, setBusinessMenuOpen] = useState(false);
    const businessMenuRef = useRef<HTMLDivElement>(null);
    const isHomePage = location.pathname === '/';
    const [overHomeHero, setOverHomeHero] = useState(location.pathname === '/');
    const homeHeroVisible = isHomePage && overHomeHero;

    useEffect(() => {
      setUserMenuOpen(false);
      setBusinessMenuOpen(false);
      setMobileMenuOpen(false);
    }, [location.pathname, location.search, location.hash]);

    useEffect(() => {
      const closeMenus = () => {
        setUserMenuOpen(false);
        setBusinessMenuOpen(false);
        setMobileMenuOpen(false);
      };
      window.addEventListener('scroll', closeMenus, { passive: true });
      return () => window.removeEventListener('scroll', closeMenus);
    }, []);

    useEffect(() => {
      if (!businessMenuOpen) return;
      const closeOnOutsideClick = (event: MouseEvent) => {
        if (!businessMenuRef.current?.contains(event.target as Node)) setBusinessMenuOpen(false);
      };
      const closeOnEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') setBusinessMenuOpen(false);
      };
      document.addEventListener('mousedown', closeOnOutsideClick);
      document.addEventListener('keydown', closeOnEscape);
      return () => {
        document.removeEventListener('mousedown', closeOnOutsideClick);
        document.removeEventListener('keydown', closeOnEscape);
      };
    }, [businessMenuOpen]);

    useEffect(() => {
      if (!isHomePage) {
        setOverHomeHero(false);
        return;
      }

      const hero = document.querySelector<HTMLElement>('[data-home-hero]');
      if (!hero) {
        setOverHomeHero(false);
        return;
      }

      const observer = new IntersectionObserver(
        ([entry]) => setOverHomeHero(entry.isIntersecting),
        { rootMargin: '-64px 0px 0px 0px', threshold: 0 },
      );
      observer.observe(hero);
      return () => observer.disconnect();
    }, [isHomePage]);

    const handleSearch = (query: string) => {
      if (query.trim()) {
        navigate(`/explore?search=${encodeURIComponent(query)}`);
      }
    };

    const selectBusiness = (business: typeof businesses[number]) => {
      setCurrentBusiness(business);
      setBusinessMenuOpen(false);
      setMobileMenuOpen(false);
      const currentBusinessPath = location.pathname.match(/^\/dashboard\/business\/[^/]+(.*)$/);
      const nextPath = `/dashboard/business/${business.business_id}${currentBusinessPath?.[1] ?? ''}`;
      navigate({ pathname: nextPath, search: location.search, hash: location.hash });
    };

    const dashboardPath = currentBusiness
      ? businessDashboardPath(currentBusiness.business_id)
      : '/dashboard';
    const isDashboard = location.pathname.startsWith('/dashboard') || location.pathname.startsWith('/business/') || location.pathname.startsWith('/admin');
    const isPublic = !isDashboard;
    const isLoginPage = location.pathname === '/login';

    return (
      <header
        ref={ref}
        className={cn(
          'sticky top-0 z-50 border-b transition-[background-color,border-color,color] duration-200',
          isHomePage ? '-mb-16' : '',
          homeHeroVisible
            ? 'border-white/10 bg-[#0B3A78] text-white shadow-sm'
            : 'border-navy-200 bg-white text-navy-900 shadow-sm',
          className
        )}
        {...props}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-8">
              <div className="hidden sm:block">
                <Logo to="/" ariaLabel={t('brand.homeLabel')} variant={homeHeroVisible ? 'dark' : 'light'} size="sm" />
              </div>
              <div className="sm:hidden">
                <Logo to="/" ariaLabel={t('brand.homeLabel')} variant={homeHeroVisible ? 'dark' : 'light'} size="sm" className="[&>span:last-child]:hidden" />
              </div>

              {isPublic && !isLoginPage && (
                <nav className="hidden md:flex items-center gap-6" aria-label={t('nav.mainNavigation')}>
                  <Link to="/explore" className={cn('text-sm font-medium transition-colors', homeHeroVisible ? 'text-white hover:text-gold-300' : 'text-navy-600 hover:text-navy-900')}>
                    {t('nav.explore')}
                  </Link>
                  <Link to="/categories" className={cn('text-sm font-medium transition-colors', homeHeroVisible ? 'text-white hover:text-gold-300' : 'text-navy-600 hover:text-navy-900')}>
                    {t('nav.categories')}
                  </Link>
                  <Link to="/how-it-works" className={cn('text-sm font-medium transition-colors', homeHeroVisible ? 'text-white hover:text-gold-300' : 'text-navy-600 hover:text-navy-900')}>
                    {t('nav.howItWorks')}
                  </Link>
                  <Link to="/favorites" className={cn('text-sm font-medium transition-colors', homeHeroVisible ? 'text-white hover:text-gold-300' : 'text-navy-600 hover:text-navy-900')}>
                    {t('nav.favorites')}
                  </Link>
                </nav>
              )}

              {isDashboard && (
                <nav className="hidden md:flex items-center gap-4" aria-label={t('nav.dashboardNavigation')}>
                  <Link
                    to={dashboardPath}
                    aria-current={location.pathname.startsWith('/dashboard/business/') ? 'page' : undefined}
                    className={cn(
                      'dashboard-header-link inline-flex min-h-10 items-center gap-2 rounded-button px-3 text-sm font-semibold transition-colors',
                      location.pathname.startsWith('/dashboard/business/')
                        ? 'bg-primary-50 text-primary-700'
                        : 'text-navy-600 hover:bg-navy-50 hover:text-navy-900'
                    )}
                  >
                    <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                    {t('nav.dashboard')}
                  </Link>
                  {currentBusiness && (
                    <div ref={businessMenuRef} className="relative">
                      {businesses.length > 1 ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setBusinessMenuOpen((open) => !open)}
                            aria-expanded={businessMenuOpen}
                            aria-haspopup="menu"
                            aria-label={`${t('sidebar.switchBusiness')}: ${currentBusiness.business_name}`}
                            className="flex min-h-10 max-w-60 items-center gap-2 rounded-button border border-navy-200 px-3 text-sm font-medium text-navy-700 transition-colors hover:bg-navy-50 hover:text-navy-900"
                          >
                            <SmartImage
                              value={currentBusinessLogo}
                              width={24}
                              height={24}
                              className="h-6 w-6 rounded-sg object-cover"
                              fallback={<Store className="h-4 w-4 text-primary-600" aria-hidden="true" />}
                            />
                            <span className="max-w-40 truncate">{currentBusiness.business_name}</span>
                            <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', businessMenuOpen && 'rotate-180')} aria-hidden="true" />
                          </button>
                          {businessMenuOpen && (
                            <div role="group" aria-label={t('sidebar.switchBusiness')} className="absolute start-0 mt-2 w-64 rounded-card border border-navy-200 bg-white py-1 shadow-card z-20">
                              <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-navy-500">
                                {t('sidebar.switchBusiness')}
                              </p>
                              {businesses.map((business) => (
                                <button
                                  key={business.business_id}
                                  type="button"
                                  onClick={() => selectBusiness(business)}
                                  aria-pressed={currentBusiness.business_id === business.business_id}
                                  className={cn(
                                    'dashboard-business-option flex w-full items-center justify-between gap-3 px-3 py-2.5 text-start text-sm transition-colors',
                                    currentBusiness.business_id === business.business_id
                                      ? 'bg-primary-50 font-medium text-primary-700'
                                      : 'text-navy-700 hover:bg-navy-50'
                                  )}
                                >
                                  <span className="truncate">{business.business_name}</span>
                                  {currentBusiness.business_id === business.business_id && (
                                    <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <div
                          role="group"
                          aria-label={`${t('sidebar.currentBusiness')}: ${currentBusiness.business_name}`}
                          className="dashboard-business-current flex min-h-10 max-w-60 items-center gap-2 rounded-button bg-navy-50 px-3 text-sm font-medium text-navy-700"
                        >
                          <SmartImage
                            value={currentBusinessLogo}
                            width={24}
                            height={24}
                            className="h-6 w-6 rounded-sg object-cover"
                            fallback={<Store className="h-4 w-4 text-primary-600" aria-hidden="true" />}
                          />
                          <span className="max-w-40 truncate">{currentBusiness.business_name}</span>
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
              {isPublic && !isAuthenticated && (
                <>
                  <Link to="/login" className={cn('hidden sm:block px-4 py-2 text-sm font-medium transition-colors', homeHeroVisible ? 'text-white hover:text-gold-300' : 'text-navy-700 hover:text-navy-900')}>
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
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 rounded-button transition-colors',
                      homeHeroVisible ? 'text-white hover:bg-white/15' : 'text-navy-700 hover:bg-navy-100',
                    )}
                  >
                    <Avatar name={user?.full_name || 'User'} size="sm" />
                    <span className={cn('hidden sm:block text-sm font-medium', homeHeroVisible ? 'text-white' : 'text-navy-700')}>
                      {user?.full_name}
                    </span>
                    <ChevronDown className={cn('w-4 h-4', homeHeroVisible ? 'text-white/80' : 'text-navy-500')} />
                  </button>
                  {userMenuOpen && (
                    <div className="absolute end-0 mt-2 w-56 bg-white rounded-card shadow-card border border-navy-200 py-1 z-10">
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
                      <Link
                        to="/my-orders"
                        onClick={() => setUserMenuOpen(false)}
                        className="block px-4 py-2 text-sm text-navy-700 hover:bg-navy-50"
                      >
                        <Package className="w-4 h-4 inline me-2" /> {t('customerOrders.title')}
                      </Link>
                      {currentBusiness && (
                        <Link to="/dashboard" className="block px-4 py-2 text-sm text-navy-700 hover:bg-navy-50">
                          <LayoutDashboard className="w-4 h-4 inline me-2" /> {t('nav.dashboard')}
                        </Link>
                      )}
                      {hasPlatformRole('platform_admin') && (
                        <Link
                          to="/admin/businesses"
                          onClick={() => setUserMenuOpen(false)}
                          className="block px-4 py-2 text-sm text-navy-700 hover:bg-navy-50"
                        >
                          <Shield className="w-4 h-4 inline me-2" /> {t('nav.admin')}
                        </Link>
                      )}
                      <div className="border-t border-navy-100 px-3 py-2">
                        <LanguageSwitcher variant="account" />
                        <button
                          type="button"
                          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                          aria-label={t(theme === 'light' ? 'appearance.switchToDark' : 'appearance.switchToLight')}
                          className="mt-2 flex min-h-10 w-full items-center gap-2 rounded-button px-3 py-2 text-sm text-navy-700 transition-colors hover:bg-navy-50"
                        >
                          {theme === 'light'
                            ? <Sun className="h-4 w-4" aria-hidden="true" />
                            : <Moon className="h-4 w-4" aria-hidden="true" />}
                          <span>{theme === 'light' ? 'Light' : 'Dark'}</span>
                        </button>
                      </div>
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

              {!isAuthenticated && (
                <LanguageSwitcher
                  className={homeHeroVisible ? '[&>button]:text-white [&>button:hover]:bg-white/15' : ''}
                />
              )}

              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className={cn('md:hidden p-2 rounded-button transition-colors', homeHeroVisible ? 'text-white hover:bg-white/15' : 'text-navy-600 hover:bg-navy-100')}
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
          <div className="md:hidden py-4 border-t border-navy-100 bg-white text-navy-900 shadow-card animate-slide-down">
            <div className="px-4 sm:px-6 mb-3 lg:hidden">
              <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                onSearch={handleSearch}
                placeholder={t('search.placeholder')}
              />
            </div>
            {isDashboard ? (
              <nav className="flex flex-col gap-1 px-4 sm:px-6" aria-label={t('nav.dashboardNavigation')}>
                {isAuthenticated && (
                  <Link
                    to="/my-orders"
                    onClick={() => setMobileMenuOpen(false)}
                    aria-current={location.pathname.startsWith('/my-orders') ? 'page' : undefined}
                    className={cn(
                      'flex min-h-10 items-center gap-3 rounded-button px-3 py-2 text-sm transition-colors',
                      location.pathname.startsWith('/my-orders')
                        ? 'bg-primary-50 font-semibold text-primary-700'
                        : 'text-navy-700 hover:bg-navy-50'
                    )}
                  >
                    <Package className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {t('customerOrders.title')}
                  </Link>
                )}
                {dashboardNavigation.map((group) => (
                  <div key={group.heading ?? 'overview'} className="space-y-0.5">
                    {group.heading && (
                      <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-navy-500">
                        {t(group.heading)}
                      </p>
                    )}
                    {group.items.map((item) => {
                      const globalPath = item.path === '/dashboard/settings';
                      const href = globalPath
                        ? item.path
                        : `${businessDashboardPath(currentBusiness?.business_id ?? '')}${item.path}`;
                      const active = globalPath
                        ? location.pathname === href
                        : location.pathname === href || location.pathname.startsWith(`${href}/`);
                      return (
                        <Link
                          key={item.key}
                          to={href}
                          onClick={() => setMobileMenuOpen(false)}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex min-h-10 items-center gap-3 rounded-button px-3 py-2 text-sm transition-colors',
                            active
                              ? 'bg-primary-50 font-semibold text-primary-700'
                              : 'text-navy-700 hover:bg-navy-50'
                          )}
                        >
                          <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                          {t(item.key)}
                        </Link>
                      );
                    })}
                  </div>
                ))}
                {currentBusiness && businesses.length > 1 && (
                  <div className="space-y-0.5">
                    <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-navy-500">
                      {t('sidebar.switchBusiness')}
                    </p>
                    {businesses.map((business) => (
                      <button
                        key={business.business_id}
                        type="button"
                        onClick={() => selectBusiness(business)}
                        aria-pressed={currentBusiness.business_id === business.business_id}
                        className={cn(
                          'dashboard-business-option flex w-full items-center justify-between rounded-button px-3 py-2 text-start text-sm',
                          currentBusiness.business_id === business.business_id
                            ? 'bg-primary-50 font-medium text-primary-700'
                            : 'text-navy-700 hover:bg-navy-50'
                        )}
                      >
                        <span className="truncate">{business.business_name}</span>
                        {currentBusiness.business_id === business.business_id && <Check className="h-4 w-4" aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                )}
                {hasPlatformRole('platform_admin') && (
                  <Link
                    to="/admin/businesses"
                    onClick={() => setMobileMenuOpen(false)}
                    className="rounded-button px-3 py-2 text-navy-700 hover:bg-navy-50"
                  >
                    <Shield className="me-2 inline h-4 w-4" aria-hidden="true" />
                    {t('nav.admin')}
                  </Link>
                )}
              </nav>
            ) : (
            <nav className="flex flex-col gap-2 px-4 sm:px-6">
              <Link to="/explore" className="px-3 py-2 text-navy-700 hover:bg-navy-50 rounded-button">{t('nav.explore')}</Link>
              <Link to="/categories" className="px-3 py-2 text-navy-700 hover:bg-navy-50 rounded-button">{t('nav.categories')}</Link>
              <Link to="/how-it-works" className="px-3 py-2 text-navy-700 hover:bg-navy-50 rounded-button">{t('nav.howItWorks')}</Link>
              <Link to="/favorites" className="px-3 py-2 text-navy-700 hover:bg-navy-50 rounded-button">{t('nav.favorites')}</Link>
              <Link to="/faq" className="px-3 py-2 text-navy-700 hover:bg-navy-50 rounded-button">{t('footer.faq')}</Link>
              {isAuthenticated ? (
                <>
                  <Link to="/my-orders" className="px-3 py-2 text-navy-700 hover:bg-navy-50 rounded-button flex items-center gap-2">
                    <Package className="w-4 h-4" aria-hidden="true" /> {t('customerOrders.title')}
                  </Link>
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
            )}
            {/* The popover variant would be clipped by the drawer's own
                overflow, so the mobile list is rendered inline instead. */}
            {!isAuthenticated && (
              <div className="px-4 sm:px-6 pt-2">
                <LanguageSwitcher variant="inline" />
              </div>
            )}
          </div>
        )}
      </header>
    );
  }
);

Header.displayName = 'Header';
