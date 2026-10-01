import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { businessApi, productApi, serviceApi, orderApi, reviewApi } from '../../services/api';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { Card } from '../components/common/Card';
import { Skeleton } from '../components/common/Skeleton';
import { cn, formatCurrency, formatRelativeTime } from '../../lib/utils';
import { ShoppingBag, Package, Truck, Users, DollarSign, TrendingUp, Star, Clock, AlertCircle, CheckCircle, XCircle, Package as PackageIcon, Truck as TruckIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

export function DashboardHomePage() {
  const { currentBusiness, refreshUser } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [recentProducts, setRecentProducts] = useState<any[]>([]);
  const [recentServices, setRecentServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentBusiness) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        const [statsRes, ordersRes, prodRes, servRes] = await Promise.all([
          businessApi.getStatistics(currentBusiness.business_id),
          orderApi.listForBusiness(currentBusiness.business_id, { limit: 5 }),
          productApi.listForBusiness(currentBusiness.business_id, { limit: 5, status: 'active' }),
          serviceApi.listForBusiness(currentBusiness.business_id, { limit: 5, status: 'active' }),
        ]);
        setStats(statsRes.data.data);
        setRecentOrders(ordersRes.data.data);
        setRecentProducts(prodRes.data.data);
        setRecentServices(servRes.data.data);
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [currentBusiness]);

  if (!currentBusiness) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-16">
          <ShoppingBag className="w-16 h-16 text-navy-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-navy-900 mb-2">No Business Selected</h1>
          <p className="text-navy-500 mb-6">Select a business from the sidebar to view its dashboard</p>
          <Link to="/businesses/register">
            <Button>Register a Business</Button>
          </Link>
        </div>
      </div>
    );
  }

  const statsCards = [
    { label: 'Total Orders', value: stats?.total_orders || 0, icon: ShoppingBag, color: 'bg-primary-100 text-primary-600', trend: '+12%' },
    { label: 'Revenue', value: formatCurrency(stats?.total_revenue || 0), icon: DollarSign, color: 'bg-success-100 text-success-600', trend: '+8%' },
    { label: 'Customers', value: stats?.total_customers || 0, icon: Users, color: 'bg-purple-100 text-purple-600', trend: '+5%' },
    { label: 'Rating', value: stats?.average_rating?.toFixed(1) || '—', icon: Star, color: 'bg-warning-100 text-warning-600', trend: stats?.average_rating ? '+0.1' : '—' },
  ];

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => <Skeleton key={i} variant="rectangular" className="h-24" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton variant="rectangular" className="h-80" />
          <Skeleton variant="rectangular" className="h-80" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">{currentBusiness.business_name}</h1>
          <p className="text-navy-500">Welcome back! Here's what's happening with your business.</p>
        </div>
        <div className="flex gap-3">
          <Link to="/dashboard/products">
            <Button>Manage Products</Button>
          </Link>
          <Link to="/dashboard/orders">
            <Button variant="outline">View Orders</Button>
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {statsCards.map((stat) => (
          <Card key={stat.label} className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-navy-500">{stat.label}</p>
                <p className="text-2xl font-bold text-navy-900 mt-1">{stat.value}</p>
              </div>
              <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center', stat.color)}>
                <stat.icon className="w-6 h-6" />
              </div>
            </div>
            <p className="text-xs text-success-600 mt-2 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> {stat.trend} vs last month
            </p>
          </Card>
        ))}
      </div>

      {/* Quick Actions & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick Actions */}
        <Card>
          <h3 className="text-lg font-semibold text-navy-900 mb-4">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-3">
            <Link to="/dashboard/products" className={cn('p-4 rounded-button border transition-colors text-center', 'hover:bg-navy-50')}>
              <PackageIcon className="w-8 h-8 text-primary-600 mx-auto mb-2" />
              <p className="text-sm font-medium text-navy-900">Add Product</p>
            </Link>
            <Link to="/dashboard/services" className={cn('p-4 rounded-button border transition-colors text-center', 'hover:bg-navy-50')}>
              <TruckIcon className="w-8 h-8 text-success-600 mx-auto mb-2" />
              <p className="text-sm font-medium text-navy-900">Add Service</p>
            </Link>
            <Link to="/dashboard/orders" className={cn('p-4 rounded-button border transition-colors text-center', 'hover:bg-navy-50')}>
              <ShoppingBag className="w-8 h-8 text-warning-600 mx-auto mb-2" />
              <p className="text-sm font-medium text-navy-900">View Orders</p>
            </Link>
            <Link to="/dashboard/analytics" className={cn('p-4 rounded-button border transition-colors text-center', 'hover:bg-navy-50')}>
              <TrendingUp className="w-8 h-8 text-purple-600 mx-auto mb-2" />
              <p className="text-sm font-medium text-navy-900">Analytics</p>
            </Link>
          </div>
        </Card>

        {/* Recent Orders */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-navy-900">Recent Orders</h3>
            <Link to="/dashboard/orders" className="text-sm text-primary-600 hover:text-primary-700">View All</Link>
          </div>
          {recentOrders.length > 0 ? (
            <div className="space-y-3">
              {recentOrders.map((order) => (
                <div key={order.order_id} className="flex items-center justify-between p-3 bg-navy-50 rounded-button">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
                      <ShoppingBag className="w-5 h-5 text-primary-600" />
                    </div>
                    <div>
                      <p className="font-medium text-navy-900">{order.order_number}</p>
                      <p className="text-xs text-navy-500">{formatRelativeTime(order.created_at)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-navy-900">{formatCurrency(order.total_amount, order.currency)}</p>
                    <Badge
                      variant={
                        order.order_status === 'completed' ? 'success' :
                        order.order_status === 'cancelled' ? 'error' :
                        order.order_status === 'pending' ? 'warning' : 'info'
                      }
                      size="sm"
                    >
                      {order.order_status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-navy-500">
              <ShoppingBag className="w-12 h-12 mx-auto mb-2 text-navy-300" />
              <p>No orders yet</p>
            </div>
          )}
        </Card>
      </div>

      {/* Recent Products & Services */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-navy-900">Recent Products</h3>
            <Link to="/dashboard/products" className="text-sm text-primary-600 hover:text-primary-700">View All</Link>
          </div>
          <div className="space-y-3">
            {recentProducts.slice(0, 5).map((product) => (
              <div key={product.product_id} className="flex items-center justify-between p-3 bg-navy-50 rounded-button">
                <div className="flex items-center gap-3">
                  {product.image_url ? (
                    <img src={product.image_url} alt="" className="w-10 h-10 rounded-lg object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
                      <PackageIcon className="w-5 h-5 text-primary-600" />
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-navy-900 truncate max-w-[200px]">{product.product_name}</p>
                    <p className="text-sm text-primary-600 font-semibold">{formatCurrency(product.price, product.currency)}</p>
                  </div>
                </div>
                <Badge
                  variant={product.status === 'active' ? 'success' : 'default'}
                  size="sm"
                >
                  {product.status}
                </Badge>
              </div>
            ))}
            {recentProducts.length === 0 && (
              <div className="text-center py-8 text-navy-500">
                <PackageIcon className="w-12 h-12 mx-auto mb-2 text-navy-300" />
                <p>No products yet</p>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-navy-900">Recent Services</h3>
            <Link to="/dashboard/services" className="text-sm text-primary-600 hover:text-primary-700">View All</Link>
          </div>
          <div className="space-y-3">
            {recentServices.slice(0, 5).map((service) => (
              <div key={service.service_id} className="flex items-center justify-between p-3 bg-navy-50 rounded-button">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-success-100 flex items-center justify-center">
                    <TruckIcon className="w-5 h-5 text-success-600" />
                  </div>
                  <div>
                    <p className="font-medium text-navy-900 truncate max-w-[200px]">{service.service_name}</p>
                    <p className="text-sm text-success-600 font-semibold">{formatCurrency(service.price, service.currency)}</p>
                  </div>
                </div>
                <Badge
                  variant={service.status === 'active' ? 'success' : 'default'}
                  size="sm"
                >
                  {service.status}
                </Badge>
              </div>
            ))}
            {recentServices.length === 0 && (
              <div className="text-center py-8 text-navy-500">
                <TruckIcon className="w-12 h-12 mx-auto mb-2 text-navy-300" />
                <p>No services yet</p>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}