import { useAuth } from '../context/AuthContext';
import { Card } from '../components/common/Card';
import { cn, formatCurrency } from '../lib/utils';
import { DollarSign, ShoppingBag, Users, Star, TrendingUp, BarChart3, Activity } from 'lucide-react';

export function DashboardAnalyticsPage() {
  const { currentBusiness } = useAuth();

  if (!currentBusiness) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-16">
          <h1 className="text-2xl font-bold text-navy-900 mb-2">No Business Selected</h1>
        </div>
      </div>
    );
  }

  // Mock analytics data - in real app, this would come from an analytics API
  const analyticsData = {
    revenue: { current: 125430, previous: 112300, trend: 11.7 },
    orders: { current: 342, previous: 298, trend: 14.8 },
    customers: { current: 1205, previous: 1080, trend: 11.6 },
    rating: { current: 4.7, previous: 4.5, trend: 4.4 },
    conversion: { current: 3.2, previous: 2.8, trend: 14.3 },
    avgOrderValue: { current: 366.75, previous: 376.84, trend: -2.7 },
  };

  const statsCards = [
    { label: 'Total Revenue', value: formatCurrency(analyticsData.revenue.current), trend: `${analyticsData.revenue.trend > 0 ? '+' : ''}${analyticsData.revenue.trend}%`, trendUp: analyticsData.revenue.trend > 0, icon: DollarSign, color: 'bg-success-100 text-success-600' },
    { label: 'Total Orders', value: analyticsData.orders.current.toLocaleString(), trend: `${analyticsData.orders.trend > 0 ? '+' : ''}${analyticsData.orders.trend}%`, trendUp: analyticsData.orders.trend > 0, icon: ShoppingBag, color: 'bg-primary-100 text-primary-600' },
    { label: 'Total Customers', value: analyticsData.customers.current.toLocaleString(), trend: `${analyticsData.customers.trend > 0 ? '+' : ''}${analyticsData.customers.trend}%`, trendUp: analyticsData.customers.trend > 0, icon: Users, color: 'bg-purple-100 text-purple-600' },
    { label: 'Average Rating', value: analyticsData.rating.current.toFixed(1), trend: `${analyticsData.rating.trend > 0 ? '+' : ''}${analyticsData.rating.trend}%`, trendUp: analyticsData.rating.trend > 0, icon: Star, color: 'bg-warning-100 text-warning-600' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Analytics</h1>
        <p className="text-navy-500">Track your business performance and growth</p>
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
            <div className="mt-2 flex items-center gap-1">
              <TrendingUp className={cn('w-3 h-3', stat.trendUp ? 'text-success-600' : 'text-error-600')} />
              <span className={cn('text-xs font-medium', stat.trendUp ? 'text-success-600' : 'text-error-600')}>
                {stat.trend} vs last period
              </span>
            </div>
          </Card>
        ))}
      </div>

      {/* Charts Placeholder */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h3 className="text-lg font-semibold text-navy-900 mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary-600" />
            Revenue Overview
          </h3>
          <div className="h-64 flex items-center justify-center">
            <div className="text-center text-navy-500">
              <Activity className="w-12 h-12 mx-auto mb-4 text-navy-300" />
              <p>Revenue chart coming soon</p>
              <p className="text-sm">Connect to analytics API for real data</p>
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="text-lg font-semibold text-navy-900 mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-success-600" />
            Order Trends
          </h3>
          <div className="h-64 flex items-center justify-center">
            <div className="text-center text-navy-500">
              <Activity className="w-12 h-12 mx-auto mb-4 text-navy-300" />
              <p>Order trends chart coming soon</p>
              <p className="text-sm">Connect to analytics API for real data</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Top Products & Services */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h3 className="text-lg font-semibold text-navy-900 mb-4">Top Products</h3>
          <div className="space-y-3">
            {[
              { name: 'Premium Coffee Beans', orders: 142, revenue: 4260 },
              { name: 'Organic Green Tea', orders: 98, revenue: 1960 },
              { name: 'Artisan Bread', orders: 87, revenue: 2610 },
              { name: 'Fresh Pastries', orders: 76, revenue: 2280 },
              { name: 'Specialty Sandwiches', orders: 65, revenue: 3250 },
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-navy-100 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center text-sm font-medium">
                    {i + 1}
                  </span>
                  <span className="font-medium text-navy-900">{item.name}</span>
                </div>
                <div className="text-end">
                  <p className="font-semibold text-navy-900">{formatCurrency(item.revenue)}</p>
                  <p className="text-xs text-navy-500">{item.orders} orders</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h3 className="text-lg font-semibold text-navy-900 mb-4">Customer Growth</h3>
          <div className="space-y-3">
            {[
              { month: 'Jan', customers: 120 },
              { month: 'Feb', customers: 145 },
              { month: 'Mar', customers: 180 },
              { month: 'Apr', customers: 210 },
              { month: 'May', customers: 245 },
              { month: 'Jun', customers: 290 },
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-navy-100 last:border-0">
                <span className="text-navy-600">{item.month}</span>
                <div className="flex items-center gap-3">
                  <div className="w-32 h-4 bg-primary-100 rounded-full overflow-hidden">
                    <div className="h-full bg-primary-600 rounded-full" style={{ width: `${(item.customers / 290) * 100}%` }} />
                  </div>
                  <span className="font-medium text-navy-900 w-16 text-end">{item.customers}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}