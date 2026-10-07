import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldX } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { MainLayout } from './components/layout/MainLayout';
import { Button } from './components/common/Button';
import { HomePage } from './pages/Home';
import { ExplorePage } from './pages/Explore';
import { CategoryPage } from './pages/CategoryPage';
import { CategoriesPage } from './pages/Categories';
import { FavoritesPage } from './pages/Favorites';
import { FavoritesProvider } from './context/FavoritesContext';
import { BusinessProfilePage } from './pages/BusinessProfile';
import { LoginPage } from './pages/Login';
import { RegisterPage } from './pages/Register';
import { DashboardHomePage } from './pages/DashboardHome';
import { DashboardProductsPage } from './pages/DashboardProducts';
import { DashboardServicesPage } from './pages/DashboardServices';
import { DashboardOrdersPage } from './pages/DashboardOrders';
import { DashboardReviewsPage } from './pages/DashboardReviews';
import { DashboardAnalyticsPage } from './pages/DashboardAnalytics';
import { DashboardCustomersPage } from './pages/DashboardCustomers';
import { DashboardSettingsPage } from './pages/DashboardSettings';
import { ListYourBusinessPage } from './pages/ListYourBusiness';
import { AdminBusinessesPage } from './pages/AdminBusinesses';
import { ProductCreatePage } from './pages/ProductCreate';
import { ProductEditPage } from './pages/ProductEdit';
import { ServiceCreatePage } from './pages/ServiceCreate';
import { ServiceEditPage } from './pages/ServiceEdit';
import { OrderDetailPage } from './pages/OrderDetail';
import { LocationManagePage } from './pages/LocationManage';
import { ComingSoonPage } from './pages/ComingSoon';
import { LegalPage } from './pages/legal/LegalPage';
import './index.css';

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
  return (
    <AuthProvider>
      <BrowserRouter>
        <FavoritesProvider>
          <Routes>
          {/* Public Routes */}
          <Route path="/" element={<MainLayout><HomePage /></MainLayout>} />
          <Route path="/explore" element={<MainLayout><ExplorePage /></MainLayout>} />
          <Route path="/categories" element={<MainLayout><CategoriesPage /></MainLayout>} />
          <Route path="/favorites" element={<MainLayout><FavoritesPage /></MainLayout>} />
          <Route path="/categories/:category" element={<MainLayout><CategoryPage /></MainLayout>} />
          <Route path="/business/:businessSlug" element={<MainLayout><BusinessProfilePage /></MainLayout>} />
          <Route path="/login" element={<MainLayout><LoginPage /></MainLayout>} />
          <Route path="/register" element={<MainLayout><RegisterPage /></MainLayout>} />
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
          <Route path="/forgot-password" element={<MainLayout><ComingSoonPage /></MainLayout>} />

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
        </FavoritesProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;