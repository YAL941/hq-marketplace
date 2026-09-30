import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { serviceApi } from '../../services/api';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Card } from '../components/common/Card';
import { ErrorState } from '../components/common/ErrorState';
import { ArrowLeft, Truck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

export function ServiceCreatePage() {
  const { currentBusiness } = useAuth();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    serviceName: '',
    serviceCategoryId: '',
    locationId: '',
    description: '',
    price: '',
    currency: 'USD',
    durationMinutes: '',
    capacity: '',
    isBookable: true,
    status: 'draft',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBusiness) return;
    setLoading(true);
    setError(null);
    try {
      await serviceApi.create(currentBusiness.business_id, {
        ...formData,
        serviceCategoryId: formData.serviceCategoryId ? parseInt(formData.serviceCategoryId) : null,
        locationId: formData.locationId ? parseInt(formData.locationId) : null,
        price: parseFloat(formData.price),
        durationMinutes: formData.durationMinutes ? parseInt(formData.durationMinutes) : null,
        capacity: formData.capacity ? parseInt(formData.capacity) : null,
      });
      navigate('/dashboard/services');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to create service');
    } finally {
      setLoading(false);
    }
  };

  if (!currentBusiness) return <ErrorState message="No business selected" />;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link to="/dashboard/services" className="inline-flex items-center gap-2 text-navy-600 hover:text-navy-900 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Services
        </Link>
        <h1 className="text-2xl font-bold text-navy-900">Add Service</h1>
        <p className="text-navy-500">Create a new service for {currentBusiness.business_name}</p>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && <ErrorState message={error} />}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <Input label="Service Name" value={formData.serviceName} onChange={(e) => setFormData({ ...formData, serviceName: e.target.value })} placeholder="Enter service name" required />
            <Input label="Price" type="number" step="0.01" value={formData.price} onChange={(e) => setFormData({ ...formData, price: e.target.value })} placeholder="0.00" required />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <Input label="Category ID" type="number" value={formData.serviceCategoryId} onChange={(e) => setFormData({ ...formData, serviceCategoryId: e.target.value })} placeholder="Optional" />
            <Input label="Location ID" type="number" value={formData.locationId} onChange={(e) => setFormData({ ...formData, locationId: e.target.value })} placeholder="Optional" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <Input label="Duration (minutes)" type="number" value={formData.durationMinutes} onChange={(e) => setFormData({ ...formData, durationMinutes: e.target.value })} placeholder="e.g. 60" />
            <Input label="Capacity" type="number" value={formData.capacity} onChange={(e) => setFormData({ ...formData, capacity: e.target.value })} placeholder="Max people" />
          </div>

          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Description</label>
            <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Describe your service..." rows={4} className="w-full px-4 py-2.5 rounded-button border border-navy-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1.5">Currency</label>
              <select value={formData.currency} onChange={(e) => setFormData({ ...formData, currency: e.target.value })} className="w-full px-4 py-2.5 border border-navy-300 rounded-button focus:outline-none focus:ring-2 focus:ring-primary-500">
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="SOS">SOS</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1.5">Status</label>
              <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })} className="w-full px-4 py-2.5 border border-navy-300 rounded-button focus:outline-none focus:ring-2 focus:ring-primary-500">
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="isBookable" checked={formData.isBookable} onChange={(e) => setFormData({ ...formData, isBookable: e.target.checked })} className="w-4 h-4 text-primary-600 border-navy-300 rounded focus:ring-primary-500" />
            <label htmlFor="isBookable" className="text-sm text-navy-700">Allow booking</label>
          </div>

          <div className="flex justify-end gap-3 pt-6 border-t border-navy-200">
            <Link to="/dashboard/services"><Button variant="outline" type="button">Cancel</Button></Link>
            <Button type="submit" loading={loading}>Create Service</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}