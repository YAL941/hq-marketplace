import { lazy, Suspense, Component, ReactNode, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldX, RefreshCw } from 'lucide-react';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/useAuth';
import { MainLayout } from './components/layout/MainLayout';
import { Button } from './components/common/Button';
import { Card } from './components/common/Card';
import { HomePage } from './pages/Home';
import { ExplorePage } from './pages/Explore';
import { CategoryPage } from './pages/CategoryPage';
import { CategoriesPage } from './pages/Categories';
import { FavoritesPage } from './pages/Favorites';
import { FavoritesProvider } from './context/FavoritesContext';
import { ThemeProvider } from './context/ThemeContext';
import { BusinessProfilePage } from './pages/BusinessProfile';
import { LoginPage } from './pages/Login';
import { RegisterPage } from './pages/Register';
import './index.css';

const DashboardHomePage = lazy(() =>
  import('./pages/DashboardHome').then((module) => ({ default: module.DashboardHomePage })),
);
const DashboardProductsPage = lazy(() =>
  import('./pages/DashboardProducts').then((module) => ({ default: module.DashboardProductsPage })),
);
const DashboardServicesPage = lazy(() =>
  import('./pages/DashboardServices').then((module) => ({ default: module.DashboardServicesPage })),
);
const DashboardOrdersPage = lazy(() =>
  import('./pages/DashboardOrders').then((module) => ({ default: module.DashboardOrdersPage })),
);
const MyOrdersPage = lazy(() =>
  import('./pages/MyOrders').then((module) => ({ default: module.MyOrdersPage })),
);
const DashboardReviewsPage = lazy(() =>
  import('./pages/DashboardReviews').then((module) => ({ default: module.DashboardReviewsPage })),
);
const DashboardAnalyticsPage = lazy(() =>
  import('./pages/DashboardAnalytics').then((module) => ({ default: module.DashboardAnalyticsPage })),
);
const DashboardCustomersPage = lazy(() =>
  import('./pages/DashboardCustomers').then((module) => ({ default: module.DashboardCustomersPage })),
);
const DashboardSettingsPage = lazy(() =>
  import('./pages/DashboardSettings').then((module) => ({ default: module.DashboardSettingsPage })),
);
const ListYourBusinessPage = lazy(() =>
  import('./pages/ListYourBusiness').then((module) => ({ default: module.ListYourBusinessPage })),
);
const AdminBusinessesPage = lazy(() =>
  import('./pages/AdminBusinesses').then((module) => ({ default: module.AdminBusinessesPage })),
);
const ProductCreatePage = lazy(() =>
  import('./pages/ProductCreate').then((module) => ({ default: module.ProductCreatePage })),
);
const ProductEditPage = lazy(() =>
  import('./pages/ProductEdit').then((module) => ({ default: module.ProductEditPage })),
);
const ServiceCreatePage = lazy(() =>
  import('./pages/ServiceCreate').then((module) => ({ default: module.ServiceCreatePage })),
);
const ServiceEditPage = lazy(() =>
  import('./pages/ServiceEdit').then((module) => ({ default: module.ServiceEditPage })),
);
const OrderDetailPage = lazy(() =>
  import('./pages/OrderDetail').then((module) => ({ default: module.OrderDetailPage })),
);
const LocationManagePage = lazy(() =>
  import('./pages/LocationManage').then((module) => ({ default: module.LocationManagePage })),
);
const LegalPage = lazy(() =>
  import('./pages/legal/LegalPage').then((module) => ({ default: module.LegalPage })),
);
const ForgotPasswordPage = lazy(() =>
  import('./pages/ForgotPassword').then((module) => ({ default: module.ForgotPasswordPage })),
);
const ResetPasswordPage = lazy(() =>
  import('./pages/ResetPassword').then((module) => ({ default: module.ResetPasswordPage })),
);
const HowItWorksPage = lazy(() =>
  import('./pages/HowItWorks').then((module) => ({ default: module.HowItWorksPage })),
);
const ContactPage = lazy(() =>
  import('./pages/Contact').then((module) => ({ default: module.ContactPage })),
);

function RouteLoadingFallback() {
  return (
    <div className="min-h-[50vh] px-4 py-8 sm:px-6" role="status" aria-label="Loading page">
      <div className="mx-auto max-w-7xl animate-pulse space-y-5">
        <div className="h-8 w-1/3 rounded bg-navy-200" />
        <div className="h-4 w-2/3 rounded bg-navy-100" />
        <div className="h-40 rounded-card bg-navy-100" />
      </div>
    </div>
  );
}

/**
 * A failed dynamic import — a bad mobile network, or a deploy that
 * shipped an index.html newer than the chunks it references. Vite and
 * the browsers phrase it a few different ways, so the error name and
 * the message are both checked.
 */
function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'ChunkLoadError') return true;
  const message = error.message;
  return (
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('Importing a module script failed') ||
    message.includes('error loading dynamically imported module')
  );
}

/**
 * Catches a failed chunk download — a bad mobile network or a deploy
 * that shipped a stale index.html. Without this a lazy route that
 * cannot load leaves a blank screen with no way to recover; here the
 * boundary renders a friendly message plus a reload button.
 *
 * It is scoped to the Routes tree rather than wrapping the whole app
 * on purpose: an auth or layout failure is a different class of
 * problem and should not be swallowed by the same fallback.
 *
 * The boundary keys itself on the pathname, so navigating anywhere
 * resets it: one failed page never blocks the rest of the site, the
 * next route simply gets a fresh render.
 */
class RouteErrorBoundary extends Component<
  { children: ReactNode; locationKey: string },
  { hasError: boolean; isChunkError: boolean }
> {
  state = { hasError: false, isChunkError: false };

  static getDerivedStateFromError(error: Error): { hasError: boolean; isChunkError: boolean } {
    return { hasError: true, isChunkError: isChunkLoadError(error) };
  }

  componentDidCatch(error: Error): void {
    // Logged once, not per render — the boundary re-renders on its own
    // state. The details stay in the console; the person using the app
    // gets the friendly message instead.
    console.error('Route failed to render:', error);
  }

  componentDidUpdate(previous: { locationKey: string }): void {
    if (previous.locationKey !== this.props.locationKey && this.state.hasError) {
      this.setState({ hasError: false, isChunkError: false });
    }
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <RouteErrorFallback
        isChunkError={this.state.isChunkError}
        onRetry={() => this.setState({ hasError: false, isChunkError: false })}
      />
    );
  }
}

/**
 * The two faces of a route error. Only a chunk failure gets the
 * "download failed" copy and the reload button, because a reload is
 * the one thing that fixes a stale chunk. Anything else is a genuine
 * bug: the message stays generic, and the actions are "try again" and
 * "go home", never the raw error.
 */
function RouteErrorFallback({
  isChunkError,
  onRetry,
}: {
  isChunkError: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-navy-50 flex items-center justify-center px-4 py-16">
      <Card className="p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-full bg-error-50 text-error-600 flex items-center justify-center mx-auto mb-5">
          {isChunkError ? (
            <RefreshCw className="w-8 h-8" aria-hidden="true" />
          ) : (
            <ShieldX className="w-8 h-8" aria-hidden="true" />
          )}
        </div>
        {isChunkError ? (
          <>
            <h1 className="text-2xl font-bold text-navy-900 mb-2">
              {t('errors.chunkLoadTitle')}
            </h1>
            <p className="text-navy-500 mb-6">
              {t('errors.chunkLoadBody')}
            </p>
            <Button variant="primary" onClick={() => window.location.reload()}>
              {t('errors.reloadPage')}
            </Button>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-navy-900 mb-2">
              {t('errors.generic')}
            </h1>
            <p className="text-navy-500 mb-6">
              {t('errors.genericBody')}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button variant="primary" onClick={onRetry}>
                {t('common.retry')}
              </Button>
              <Link
                to="/"
                className="inline-flex items-center justify-center font-medium rounded-button transition-all duration-200 px-4 py-2 text-base border-2 border-navy-300 text-navy-700 hover:bg-navy-50"
              >
                {t('errors.goHome')}
              </Link>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/**
 * Vite fires `vite:preloadError` on the window when a dependency a
 * route needs fails to download — the same stale-deploy signature as a
 * chunk error, surfacing one navigation earlier. Reloading once fixes
 * it; the sessionStorage flag carries an expiry so a deploy that is
 * broken for everyone cannot reload in a loop.
 */
const PRELOAD_RELOAD_FLAG = 'hq_preload_reload_expires_at';
const PRELOAD_RELOAD_TTL_MS = 60_000;

function useVitePreloadReload(): void {
  useEffect(() => {
    const onPreloadError = (event: Event) => {
      event.preventDefault();
      const expiresAt = Number(sessionStorage.getItem(PRELOAD_RELOAD_FLAG));
      if (Number.isFinite(expiresAt) && Date.now() < expiresAt) return;
      sessionStorage.setItem(
        PRELOAD_RELOAD_FLAG,
        String(Date.now() + PRELOAD_RELOAD_TTL_MS),
      );
      window.location.reload();
    };
    window.addEventListener('vite:preloadError', onPreloadError);
    return () => window.removeEventListener('vite:preloadError', onPreloadError);
  }, []);
}

/**
 * The boundary sits inside the router so it can read the location and
 * reset itself on navigation, and inside Suspense so a chunk that is
 * still downloading shows the skeleton rather than nothing.
 */
function RoutesWithErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <RouteErrorBoundary locationKey={location.pathname}>
      {children}
    </RouteErrorBoundary>
  );
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function PlatformAdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, hasPlatformRole } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!hasPlatformRole('platform_admin')) {
    return (
      <div className="min-h-screen flex items-center justify-center py-12">
        <div className="max-w-md text-center">
          <ShieldX className="w-12 h-12 text-error-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-navy-900 mb-2">{t('admin.forbiddenTitle')}</h1>
          <p className="text-navy-500 mb-6">{t('admin.forbiddenBody')}</p>
          <Button variant="outline" onClick={() => navigate('/')}>
            {t('listYourBusiness.backHome')}
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function BusinessRoute({ children }: { children: React.ReactNode }) {
  const { businesses, isAuthenticated, isLoading } = useAuth();
  const { businessId } = useParams<{ businessId: string }>();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // The server checks membership on every business-scoped route, so this is the
  // same rule stated earlier: a business the account does not belong to is not
  // something to render, and a mistyped id in a pasted link is not an error
  // page either. It goes to the first business the account does own.
  if (businesses.length === 0) {
    return <Navigate to="/dashboard/settings" replace />;
  }

  if (!businesses.some((business) => business.business_id === businessId)) {
    return <Navigate to={`/dashboard/business/${businesses[0].business_id}`} replace />;
  }

  return <>{children}</>;
}

/**
 * `/dashboard` on its own has no business to act on, so it forwards to the
 * first one the account belongs to. The switcher in the sidebar is what moves
 * between businesses, and it navigates the same way.
 */
function DashboardIndex() {
  const { businesses, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (businesses.length === 0) return <Navigate to="/dashboard/settings" replace />;
  return <Navigate to={`/dashboard/business/${businesses[0].business_id}`} replace />;
}

function App() {
  useVitePreloadReload();

  return (
    <AuthProvider>
      <ThemeProvider>
        <BrowserRouter>
          <FavoritesProvider>
            <Suspense fallback={<RouteLoadingFallback />}>
              <RoutesWithErrorBoundary>
              <Routes>
          {/* Public Routes */}
          <Route path="/" element={<MainLayout><HomePage /></MainLayout>} />
          <Route path="/explore" element={<MainLayout><ExplorePage /></MainLayout>} />
          <Route path="/categories" element={<MainLayout><CategoriesPage /></MainLayout>} />
          <Route path="/favorites" element={<MainLayout><FavoritesPage /></MainLayout>} />
          <Route path="/categories/:category" element={<MainLayout><CategoryPage /></MainLayout>} />
          <Route path="/business/:businessSlug" element={<MainLayout><BusinessProfilePage /></MainLayout>} />
          <Route path="/how-it-works" element={<MainLayout><HowItWorksPage /></MainLayout>} />
          <Route path="/contact" element={<MainLayout><ContactPage /></MainLayout>} />
          <Route path="/login" element={<MainLayout><LoginPage /></MainLayout>} />
          <Route path="/register" element={<MainLayout><RegisterPage /></MainLayout>} />
          <Route
            path="/my-orders"
            element={
              <PrivateRoute>
                <MainLayout><MyOrdersPage /></MainLayout>
              </PrivateRoute>
            }
          />
          {/*
            Onboarding, not a dashboard screen: it creates the business itself, so
            it sits outside `/dashboard/business/:businessId`. The guard is the
            page's own — it redirects to the login screen and comes back here.
          */}
           <Route path="/list-your-business" element={<MainLayout><ListYourBusinessPage /></MainLayout>} />

           <Route
             path="/admin/businesses"
             element={
               <PlatformAdminRoute>
                 <MainLayout><AdminBusinessesPage /></MainLayout>
               </PlatformAdminRoute>
             }
           />

          {/* Linked from the auth screens, so they exist rather than falling
              through to the home page and looking broken. */}
          <Route path="/faq" element={<MainLayout><LegalPage doc="faq" /></MainLayout>} />
          <Route path="/privacy" element={<MainLayout><LegalPage doc="privacy" /></MainLayout>} />
          <Route path="/safety" element={<MainLayout><LegalPage doc="safety" /></MainLayout>} />
          <Route path="/terms" element={<MainLayout><LegalPage doc="terms" /></MainLayout>} />
          <Route path="/forgot-password" element={<MainLayout><ForgotPasswordPage /></MainLayout>} />
          <Route path="/reset-password" element={<MainLayout><ResetPasswordPage /></MainLayout>} />

          {/*
            Dashboard routes. The business id is part of the path because it is
            what the API resolves the workspace from, and a URL that carries it
            can be bookmarked and shared. `/dashboard` on its own forwards to
            the first business the account belongs to.
          */}
          <Route path="/dashboard" element={<DashboardIndex />} />
          <Route
            path="/dashboard/business/:businessId"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <DashboardHomePage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/business/:businessId/products"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <DashboardProductsPage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/business/:businessId/products/create"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <ProductCreatePage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/business/:businessId/products/:productId/edit"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <ProductEditPage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/business/:businessId/services"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <DashboardServicesPage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/business/:businessId/services/create"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <ServiceCreatePage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/business/:businessId/services/:serviceId/edit"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <ServiceEditPage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/business/:businessId/orders"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <DashboardOrdersPage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/business/:businessId/orders/:orderId"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <OrderDetailPage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/business/:businessId/customers"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <DashboardCustomersPage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/business/:businessId/reviews"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <DashboardReviewsPage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/business/:businessId/analytics"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <DashboardAnalyticsPage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/business/:businessId/locations"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <LocationManagePage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/settings"
            element={
              <PrivateRoute>
                <MainLayout withSidebar>
                  <DashboardSettingsPage />
                </MainLayout>
              </PrivateRoute>
            }
          />

          {/* 404 */}
          <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
              </RoutesWithErrorBoundary>
            </Suspense>
          </FavoritesProvider>
        </BrowserRouter>
      </ThemeProvider>
    </AuthProvider>
  );
}

export default App;