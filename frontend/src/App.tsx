import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { MainLayout } from './components/layout/MainLayout';
import { HomePage } from './pages/Home';
import { ExplorePage } from './pages/Explore';
import { CategoryPage } from './pages/CategoryPage';
import { BusinessProfilePage } from './pages/BusinessProfile';
import { LoginPage } from './pages/Login';
import { RegisterPage } from './pages/Register';
import { DashboardHomePage } from './pages/DashboardHome';
import { DashboardProductsPage } from './pages/DashboardProducts';
import { DashboardServicesPage } from './pages/DashboardServices';
import { DashboardOrdersPage } from './pages/DashboardOrders';
import { DashboardReviewsPage } from './pages/DashboardReviews';
import { DashboardAnalyticsPage } from './pages/DashboardAnalytics';
import { DashboardSettingsPage } from './pages/DashboardSettings';
import { ProductCreatePage } from './pages/ProductCreate';
import { ProductEditPage } from './pages/ProductEdit';
import { ServiceCreatePage } from './pages/ServiceCreate';
import { ServiceEditPage } from './pages/ServiceEdit';
import { OrderDetailPage } from './pages/OrderDetail';
import { LocationManagePage } from './pages/LocationManage';
import { ComingSoonPage } from './pages/ComingSoon';
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

function BusinessRoute({ children }: { children: React.ReactNode }) {
  const { currentBusiness, isAuthenticated, isLoading } = useAuth();

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

  if (!currentBusiness) {
    return <Navigate to="/dashboard/settings" replace />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<MainLayout><HomePage /></MainLayout>} />
          <Route path="/explore" element={<MainLayout><ExplorePage /></MainLayout>} />
          <Route path="/categories" element={<MainLayout><ExplorePage /></MainLayout>} />
          <Route path="/categories/:category" element={<MainLayout><CategoryPage /></MainLayout>} />
          <Route path="/business/:businessSlug" element={<MainLayout><BusinessProfilePage /></MainLayout>} />
          <Route path="/login" element={<MainLayout><LoginPage /></MainLayout>} />
          <Route path="/register" element={<MainLayout><RegisterPage /></MainLayout>} />

          {/* Linked from the auth screens, so they exist rather than falling
              through to the home page and looking broken. */}
          <Route path="/terms" element={<MainLayout><ComingSoonPage /></MainLayout>} />
          <Route path="/privacy" element={<MainLayout><ComingSoonPage /></MainLayout>} />
          <Route path="/forgot-password" element={<MainLayout><ComingSoonPage /></MainLayout>} />

          {/* Dashboard Routes - require auth + business */}
          <Route
            path="/dashboard"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <DashboardHomePage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/products"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <DashboardProductsPage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/products/create"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <ProductCreatePage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/products/:productId/edit"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <ProductEditPage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/services"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <DashboardServicesPage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/services/create"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <ServiceCreatePage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/services/:serviceId/edit"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <ServiceEditPage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/orders"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <DashboardOrdersPage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/orders/:orderId"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <OrderDetailPage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/reviews"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <DashboardReviewsPage />
                </MainLayout>
              </BusinessRoute>
            }
          />
          <Route
            path="/dashboard/analytics"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <DashboardAnalyticsPage />
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
          <Route
            path="/dashboard/locations"
            element={
              <BusinessRoute>
                <MainLayout withSidebar>
                  <LocationManagePage />
                </MainLayout>
              </BusinessRoute>
            }
          />

          {/* 404 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;