import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { productApi } from '../services/api';
import { ProductCard } from '../components/business/ProductCard';
import { BusinessCardSkeleton } from '../components/common/Skeleton';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Card } from '../components/common/Card';
import { Plus, Search, Edit, Trash2, Package } from 'lucide-react';
import { Link } from 'react-router-dom';

export function DashboardProductsPage() {
  const { currentBusiness } = useAuth();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    if (!currentBusiness) return;
    const fetchProducts = async () => {
      setLoading(true);
      try {
        const response = await productApi.listForBusiness(currentBusiness.business_id, {
          search: search || undefined,
          status: statusFilter || undefined,
          limit: 50,
        });
        setProducts(response.data.data);
      } catch (error) {
        console.error('Failed to fetch products:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchProducts();
  }, [currentBusiness, search, statusFilter]);

  const handleDelete = async (productId: number) => {
    if (!confirm('Are you sure you want to archive this product?')) return;
    try {
      await productApi.delete(currentBusiness!.business_id, productId);
      setProducts(products.filter(p => p.product_id !== productId));
    } catch (error) {
      alert('Failed to delete product');
    }
  };

  if (!currentBusiness) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-16">
          <Package className="w-16 h-16 text-navy-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-navy-900 mb-2">No Business Selected</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Products</h1>
          <p className="text-navy-500">Manage your product catalog</p>
        </div>
        <Link to="/dashboard/products/create">
          <Button>
            <Plus className="w-4 h-4 me-2" />
            Add Product
          </Button>
        </Link>
      </div>

      <Card>
        <div className="flex flex-col sm:flex-row gap-4 mb-4 p-4 border-b border-navy-200">
          <Input
            placeholder="Search products..."
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 p-4">
            {[...Array(8)].map((_, i) => <BusinessCardSkeleton key={i} />)}
          </div>
        ) : products.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 p-4">
            {products.map((product) => (
              <div key={product.product_id} className="relative group">
                <ProductCard
                  product={product}
                  showBusiness={false}
                />
                <div className="absolute top-2 end-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                  <button
                    onClick={() => window.location.href = `/dashboard/products/${product.product_id}/edit`}
                    className="p-2 bg-white rounded-button shadow-card hover:bg-navy-50 transition-colors"
                    aria-label="Edit product"
                  >
                    <Edit className="w-4 h-4 text-navy-600" />
                  </button>
                  <button
                    onClick={() => handleDelete(product.product_id)}
                    className="p-2 bg-white rounded-button shadow-card hover:bg-error-50 text-error-600 transition-colors"
                    aria-label="Delete product"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <Package className="w-16 h-16 text-navy-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-navy-900 mb-2">No products yet</h3>
            <p className="text-navy-500 mb-6">Start adding products to your catalog</p>
            <Link to="/dashboard/products/create">
              <Button>
                <Plus className="w-4 h-4 me-2" />
                Add Your First Product
              </Button>
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}