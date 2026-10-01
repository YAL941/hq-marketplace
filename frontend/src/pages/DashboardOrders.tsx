import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { orderApi } from '../services/api';
import { Badge } from '../components/common/Badge';
import type { BadgeVariant } from '../components/common/Badge';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { Input } from '../components/common/Input';
import { formatCurrency, formatRelativeTime } from '../lib/utils';
import { Search, ChevronLeft, ChevronRight, Eye, Package, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';

const statusColors: Record<string, BadgeVariant> = {
  pending: 'warning',
  confirmed: 'info',
  in_progress: 'info',
  ready: 'info',
  out_for_delivery: 'info',
  completed: 'success',
  cancelled: 'error',
  rejected: 'error',
  refunded: 'warning',
};

export function DashboardOrdersPage() {
  const { currentBusiness } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const limit = 10;

  useEffect(() => {
    if (!currentBusiness) return;
    const fetchOrders = async () => {
      setLoading(true);
      try {
        const response = await orderApi.listForBusiness(currentBusiness.business_id, {
          orderStatus: statusFilter || undefined,
          limit,
          offset: (page - 1) * limit,
        });
        setOrders(response.data.data);
      } catch (error) {
        console.error('Failed to fetch orders:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchOrders();
  }, [currentBusiness, statusFilter, page]);

  if (!currentBusiness) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-16">
          <h1 className="text-2xl font-bold text-navy-900 mb-2">No Business Selected</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Orders</h1>
          <p className="text-navy-500">Manage and track customer orders</p>
        </div>
      </div>

      <Card>
        <div className="flex flex-col sm:flex-row gap-4 mb-4 p-4 border-b border-navy-200">
          <Input
            placeholder="Search orders..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 max-w-md"
            leftIcon={<Search className="w-5 h-5 text-navy-400" />}
          />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-navy-300 rounded-button text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 w-full sm:w-48"
          >
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="in_progress">In Progress</option>
            <option value="ready">Ready</option>
            <option value="out_for_delivery">Out for Delivery</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        {loading ? (
          <div className="space-y-3 p-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="animate-pulse flex items-center justify-between p-3 bg-navy-50 rounded-button">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-sg bg-navy-200" />
                  <div className="space-y-1">
                    <div className="h-4 bg-navy-200 rounded w-32" />
                    <div className="h-3 bg-navy-200 rounded w-24" />
                  </div>
                </div>
                <div className="w-24 h-8 bg-navy-200 rounded" />
              </div>
            ))}
          </div>
        ) : orders.length > 0 ? (
          <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-start text-sm text-navy-500 border-b border-navy-200">
                  <th className="pb-3 font-medium text-navy-700">Order</th>
                  <th className="pb-3 font-medium text-navy-700">Customer</th>
                  <th className="pb-3 font-medium text-navy-700">Items</th>
                  <th className="pb-3 font-medium text-navy-700">Total</th>
                  <th className="pb-3 font-medium text-navy-700">Status</th>
                  <th className="pb-3 font-medium text-navy-700">Date</th>
                  <th className="pb-3 font-medium text-navy-700 text-end">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {orders.map((order) => (
                  <tr key={order.order_id} className="hover:bg-navy-50">
                    <td className="py-4">
                      <Link to={`/dashboard/orders/${order.order_id}`} className="font-medium text-primary-600 hover:text-primary-700">
                        {order.order_number}
                      </Link>
                    </td>
                    <td className="py-4 text-navy-900">Customer #{order.customer_id}</td>
                    <td className="py-4">
                      <div className="flex items-center gap-1">
                        {order.items?.map((item: any) => (
                          <Badge key={item.order_item_id} variant="default" size="sm" className="text-xs">
                            {item.item_type === 'product' ? <Package className="w-3 h-3 me-1" /> : <Truck className="w-3 h-3 me-1" />}
                            {item.item_name}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="py-4 font-semibold text-navy-900">{formatCurrency(order.total_amount, order.currency)}</td>
                    <td className="py-4">
                      <Badge variant={statusColors[order.order_status] || 'default'} size="sm">
                        {order.order_status.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="py-4 text-navy-500 text-sm">{formatRelativeTime(order.created_at)}</td>
                    <td className="py-4 text-end">
                      <Link
                        to={`/dashboard/orders/${order.order_id}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-primary-600 hover:text-primary-700 font-medium"
                      >
                        <Eye className="w-4 h-4" />
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-navy-500">
              Showing {((page - 1) * limit) + 1} to {Math.min(page * limit, orders.length)} of {orders.length} orders
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2 border border-navy-300 rounded-button hover:bg-navy-50 disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={orders.length < limit}
                className="p-2 border border-navy-300 rounded-button hover:bg-navy-50 disabled:opacity-50"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            icon={<Package className="w-8 h-8" />}
            title="No orders yet"
            description="Orders placed by customers will appear here."
          />
        )}
      </Card>
    </div>
  );
}