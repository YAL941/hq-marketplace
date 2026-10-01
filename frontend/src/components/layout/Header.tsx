import { HeaderHTMLAttributes, forwardRef, useState } from 'react';
import { cn } from '../lib/utils';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Menu, X, Search, User, ShoppingBag, Heart, MessageSquare, LogIn, LogOut, LayoutDashboard, ChevronDown } from 'lucide-react';
import { Button } from '../common/Button';
import { SearchBar } from '../common/SearchBar';
import { Badge } from '../common/Badge';
import { Avatar } from './Avatar';

interface HeaderProps extends HeaderHTMLAttributes<HTMLHeaderElement> {}

export const Header = forwardRef<HTMLHeaderElement, HeaderProps>(
  ({ className, ...props }, ref) => {
    const location = useLocation();
    const { user, isAuthenticated, logout, businesses, currentBusiness, setCurrentBusiness } = useAuth();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const [businessMenuOpen, setBusinessMenuOpen] = useState(false);

    const handleSearch = (query: string) => {
      if (query.trim()) {
        navigate(`/explore?search=${encodeURIComponent(query)}`);
      }
    };

    const isDashboard = location.pathname.startsWith('/dashboard') || location.pathname.startsWith('/business/');
    const isPublic = !isDashboard;

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
              <Link to="/" className="flex items-center gap-2" aria-label="HQ Marketplace Home">
                <div className="w-9 h-9 rounded-xl bg-primary-600 flex items-center justify-center">
                  <ShoppingBag className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold text-navy-900 hidden sm:block">HQ Marketplace</span>
              </Link>

              {isPublic && (
                <nav className="hidden md:flex items-center gap-6" aria-label="Main navigation">
                  <Link to="/explore" className={cn('text-sm font-medium transition-colors', location.pathname === '/explore' ? 'text-primary-600' : 'text-navy-600 hover:text-navy-900')}>
                    Explore
                  </Link>
                  <Link to="/categories" className={cn('text-sm font-medium transition-colors', location.pathname === '/categories' ? 'text-primary-600' : 'text-navy-600 hover:text-navy-900')}>
                    Categories
                  </Link>
                  <Link to="/favorites" className={cn('text-sm font-medium transition-colors', location.pathname === '/favorites' ? 'text-primary-600' : 'text-navy-600 hover:text-navy-900')}>
                    Favorites
                  </Link>
                </nav>
              )}

              {isDashboard && (
                <nav className="hidden md:flex items-center gap-4" aria-label="Dashboard navigation">
                  <Link to="/dashboard" className={cn('text-sm font-medium transition-colors', location.pathname === '/dashboard' ? 'text-primary-600' : 'text-navy-600 hover:text-navy-900')}>
                    <LayoutDashboard className="w-4 h-4 inline mr-1" /> Dashboard
                  </Link>
                  {currentBusiness && (
                    <div className="relative">
                      <button
                        onClick={() => setBusinessMenuOpen(!businessMenuOpen)}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-navy-700 hover:text-navy-900 rounded-button hover:bg-navy-100 transition-colors"
                      >
                        <ShoppingBag className="w-4 h-4" />
                        {currentBusiness.business_name}
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      {businessMenuOpen && (
                        <div className="absolute right-0 mt-2 w-56 bg-white rounded-card shadow-card border border-navy-200 py-1 z-10">
                          {businesses.map((biz) => (
                            <button
                              key={biz.business_id}
                              onClick={() => setCurrentBusiness(biz)}
                              className={cn('w-full px-4 py-2 text-left text-sm transition-colors', currentBusiness.business_id === biz.business_id ? 'bg-primary-50 text-primary-600' : 'text-navy-700 hover:bg-navy-50')}
                            >
                              {biz.business_name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </nav>
              )}
            </div>

            <div className="flex-1 max-w-xl mx-8 hidden lg:block">
              <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                onSearch={handleSearch}
                placeholder="Search businesses, services, products..."
              />
            </div>

            <div className="flex items-center gap-3">
              {isPublic && (
                <>
                  <Link to="/login" className="hidden sm:block px-4 py-2 text-sm font-medium text-navy-700 hover:text-navy-900 transition-colors">
                    Sign In
                  </Link>
                  <Link to="/register" className="hidden sm:block">
                    <Button size="sm">Get Started</Button>
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
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-card shadow-card border border-navy-200 py-1 z-10">
                      <div className="px-4 py-2 border-b border-navy-100">
                        <p className="text-sm font-medium text-navy-900">{user?.full_name}</p>
                        <p className="text-xs text-navy-500">{user?.email}</p>
                      </div>
                      <Link to="/profile" className="block px-4 py-2 text-sm text-navy-700 hover:bg-navy-50">
                        <User className="w-4 h-4 inline mr-2" /> Profile
                      </Link>
                      {currentBusiness && (
                        <Link to="/dashboard" className="block px-4 py-2 text-sm text-navy-700 hover:bg-navy-50">
                          <LayoutDashboard className="w-4 h-4 inline mr-2" /> Dashboard
                        </Link>
                      )}
                      <hr className="my-1 border-navy-100" />
                      <button
                        onClick={logout}
                        className="w-full text-left px-4 py-2 text-sm text-error-600 hover:bg-error-50 flex items-center gap-2"
                      >
                        <LogOut className="w-4 h-4" /> Sign Out
                      </button>
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 rounded-button hover:bg-navy-100 text-navy-600"
                aria-label="Toggle menu"
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-navy-100 animate-slide-down">
            <nav className="flex flex-col gap-2">
              <Link to="/explore" className="px-3 py-2 text-navy-700 hover:bg-navy-50 rounded-button">Explore</Link>
              <Link to="/categories" className="px-3 py-2 text-navy-700 hover:bg-navy-50 rounded-button">Categories</Link>
              <Link to="/favorites" className="px-3 py-2 text-navy-700 hover:bg-navy-50 rounded-button">Favorites</Link>
              {isAuthenticated ? (
                <>
                  {currentBusiness && (
                    <Link to="/dashboard" className="px-3 py-2 text-navy-700 hover:bg-navy-50 rounded-button flex items-center gap-2">
                      <LayoutDashboard className="w-4 h-4" /> Dashboard
                    </Link>
                  )}
                  <button onClick={logout} className="px-3 py-2 text-error-600 hover:bg-error-50 rounded-button flex items-center gap-2 w-full text-left">
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                </>
              ) : (
                <>
                  <Link to="/login" className="px-3 py-2 text-navy-700 hover:bg-navy-50 rounded-button">Sign In</Link>
                  <Link to="/register" className="px-3 py-2 text-primary-600 hover:bg-primary-50 rounded-button font-medium">Get Started</Link>
                </>
              )}
            </nav>
          </div>
        )}
    </header>
  }
);

Header.displayName = 'Header';