import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { serviceApi } from '../services/api';
import { ServiceCard } from '../components/business/ServiceCard';
import { BusinessCardSkeleton } from '../components/common/Skeleton';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Card } from '../components/common/Card';
import { Plus, Search, Edit, Trash2, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';

export function DashboardServicesPage() {
  const { currentBusiness } = useAuth();
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    if (!currentBusiness) return;
    const fetchServices = async () => {
      setLoading(true);
      try {
        const response = await serviceApi.listForBusiness(currentBusiness.business_id, {
          search: search || undefined,
          status: statusFilter || undefined,
          limit: 50,
        });
        setServices(response.data.data);
      } catch (error) {
        console.error('Failed to fetch services:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchServices();
  }, [currentBusiness, search, statusFilter]);

  const handleDelete = async (_serviceId: number) => {
    if (!confirm('Are you sure you want to archive this service?')) return;
    try {
      // Note: delete endpoint not implemented in backend yet
      alert('Delete functionality coming soon');
    } catch (error) {
      alert('Failed to delete service');
    }
  };

  if (!currentBusiness) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-16">
          <Truck className="w-16 h-16 text-navy-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-navy-900 mb-2">No Business Selected</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Services</h1>
          <p className="text-navy-500">Manage your service offerings</p>
        </div>
        <Link to="/dashboard/services/create">
          <Button>
            <Plus className="w-4 h-4 me-2" />
            Add Service
          </Button>
        </Link>
      </div>

      <Card>
        <div className="flex flex-col sm:flex-row gap-4 mb-4 p-4 border-b border-navy-200">
          <Input
            placeholder="Search services..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 max-w-md"
            leftIcon={<Search className="w-5 h-5 text-navy-400" />}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-navy-300 rounded-button text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 w-full sm:w-48"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="inactive">Inactive</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 p-4">
            {[...Array(6)].map((_, i) => <BusinessCardSkeleton key={i} />)}
          </div>
        ) : services.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 p-4">
            {services.map((service) => (
              <div key={service.service_id} className="relative group">
                <ServiceCard
                  service={service}
                  showBusiness={false}
                />
                <div className="absolute top-2 end-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                  <button
                    onClick={() => window.location.href = `/dashboard/services/${service.service_id}/edit`}
                    className="p-2 bg-white rounded-button shadow-card hover:bg-navy-50 transition-colors"
                    aria-label="Edit service"
                  >
                    <Edit className="w-4 h-4 text-navy-600" />
                  </button>
                  <button
                    onClick={() => handleDelete(service.service_id)}
                    className="p-2 bg-white rounded-button shadow-card hover:bg-error-50 text-error-600 transition-colors"
                    aria-label="Delete service"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <Truck className="w-16 h-16 text-navy-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-navy-900 mb-2">No services yet</h3>
            <p className="text-navy-500 mb-6">Start adding services to your catalog</p>
            <Link to="/dashboard/services/create">
              <Button>
                <Plus className="w-4 h-4 me-2" />
                Add Your First Service
              </Button>
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}