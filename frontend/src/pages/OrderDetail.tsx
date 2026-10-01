import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { orderApi } from '../services/api';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import type { BadgeVariant } from '../components/common/Badge';
import { ErrorState } from '../components/common/ErrorState';
import { ArrowLeft, Package, Truck, User, MapPin } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { cn, formatCurrency, formatRelativeTime } from '../lib/utils';

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

export function OrderDetailPage() {
  const { currentBusiness } = useAuth();
  const { orderId } = useParams<{ orderId: string }>();
  const [orderData, setOrderData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    if (!currentBusiness || !orderId) return;
    const fetchOrder = async () => {
      try {
        const res = await orderApi.getForBusiness(currentBusiness.business_id, parseInt(orderId));
        setOrderData(res.data.data);
      } catch (err) {
        setError('Failed to load order');
      } finally {
        setLoading(false);
      }
    };
    fetchOrder();
  }, [currentBusiness, orderId]);

  const handleStatusUpdate = async (newStatus: string) => {
    if (!currentBusiness || !orderId) return;
    setUpdatingStatus(true);
    try {
      await orderApi.updateStatus(currentBusiness.business_id, parseInt(orderId), newStatus);
      const res = await orderApi.getForBusiness(currentBusiness.business_id, parseInt(orderId));
      setOrderData(res.data.data);
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Failed to update status');
    } finally {
      setUpdatingStatus(false);
    }
  };

  if (!currentBusiness) return <ErrorState message="No business selected" />;
  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent" /></div>;
  if (error || !orderData) return <ErrorState message={error || 'Order not found'} />;

  const { order, items } = orderData;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link to="/dashboard/orders" className="inline-flex items-center gap-2 text-navy-600 hover:text-navy-900 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Orders
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-navy-900">Order {order.order_number}</h1>
            <p className="text-navy-500">{formatRelativeTime(order.created_at)}</p>
          </div>
          <Badge variant={statusColors[order.order_status] || 'default'} size="lg">
            {order.order_status.replace('_', ' ')}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <h3 className="text-lg font-semibold text-navy-900 mb-4">Order Items</h3>
            <div className="space-y-3">
              {items.map((item: any) => (
                <div key={item.order_item_id} className="flex items-center justify-between p-3 bg-navy-50 rounded-button">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-sg bg-primary-100 flex items-center justify-center">
                      {item.item_type === 'product' ? <Package className="w-5 h-5 text-primary-600" /> : <Truck className="w-5 h-5 text-success-600" />}
                    </div>
                    <div>
                      <p className="font-medium text-navy-900">{item.item_name}</p>
                      <p className="text-sm text-navy-500">Qty: {item.quantity} x {formatCurrency(item.unit_price, order.currency)}</p>
                    </div>
                  </div>
                  <p className="font-semibold text-navy-900">{formatCurrency(item.total_price, order.currency)}</p>
                </div>
              ))}
            </div>
          </Card>

          {order.customer_note && (
            <Card>
              <h3 className="text-lg font-semibold text-navy-900 mb-2">Customer Note</h3>
              <p className="text-navy-700">{order.customer_note}</p>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <h3 className="text-lg font-semibold text-navy-900 mb-4">Order Summary</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-navy-500">Subtotal</span><span className="text-navy-900">{formatCurrency(order.subtotal, order.currency)}</span></div>
              <div className="flex justify-between"><span className="text-navy-500">Delivery Fee</span><span className="text-navy-900">{formatCurrency(order.delivery_fee, order.currency)}</span></div>
              {parseFloat(order.discount_amount) > 0 && (
                <div className="flex justify-between"><span className="text-navy-500">Discount</span><span className="text-navy-900">-{formatCurrency(order.discount_amount, order.currency)}</span></div>
              )}
              <div className="flex justify-between"><span className="text-navy-500">Tax</span><span className="text-navy-900">{formatCurrency(order.tax_amount, order.currency)}</span></div>
              <div className="flex justify-between pt-2 border-t border-navy-200 font-semibold"><span>Total</span><span className="text-navy-900">{formatCurrency(order.total_amount, order.currency)}</span></div>
            </dl>
          </Card>

          <Card>
            <h3 className="text-lg font-semibold text-navy-900 mb-4">Customer Info</h3>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center"><User className="w-5 h-5 text-primary-600" /></div>
              <div><p className="font-medium text-navy-900">Customer #{order.customer_id}</p></div>
            </div>
            {order.delivery_address && (
              <div className="flex items-start gap-2 text-sm text-navy-600"><MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>{order.delivery_address}</span></div>
            )}
          </Card>

          <Card>
            <h3 className="text-lg font-semibold text-navy-900 mb-4">Update Status</h3>
            <div className="flex flex-wrap gap-2">
              {['confirmed', 'in_progress', 'ready', 'out_for_delivery', 'completed', 'cancelled', 'rejected'].map((status) => (
                <button
                  key={status}
                  onClick={() => handleStatusUpdate(status)}
                  disabled={updatingStatus || order.order_status === status}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-button transition-colors',
                    order.order_status === status
                      ? 'bg-primary-600 text-white'
                      : 'bg-navy-100 text-navy-700 hover:bg-navy-200 disabled:opacity-50'
                  )}
                >
                  {status.replace('_', ' ')}
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}