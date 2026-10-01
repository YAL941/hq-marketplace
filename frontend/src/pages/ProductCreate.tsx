import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { productApi } from '../services/api';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Card } from '../components/common/Card';
import { ErrorState } from '../components/common/ErrorState';
import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

export function ProductCreatePage() {
  const { currentBusiness } = useAuth();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    productName: '',
    categoryId: '',
    description: '',
    price: '',
    currency: 'USD',
    sku: '',
    imageUrl: '',
    stockQuantity: '',
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
      await productApi.create(currentBusiness.business_id, {
        ...formData,
        categoryId: formData.categoryId ? parseInt(formData.categoryId) : null,
        price: parseFloat(formData.price),
        stockQuantity: formData.stockQuantity ? parseInt(formData.stockQuantity) : 0,
      });
      navigate('/dashboard/products');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to create product');
    } finally {
      setLoading(false);
    }
  };

  if (!currentBusiness) {
    return <ErrorState message="No business selected" />;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link to="/dashboard/products" className="inline-flex items-center gap-2 text-navy-600 hover:text-navy-900 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Products
        </Link>
        <h1 className="text-2xl font-bold text-navy-900">Add Product</h1>
        <p className="text-navy-500">Create a new product for {currentBusiness.business_name}</p>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && <ErrorState message={error} />}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <Input
              label="Product Name"
              value={formData.productName}
              onChange={(e) => setFormData({ ...formData, productName: e.target.value })}
              placeholder="Enter product name"
              required
            />
            <Input
              label="Price"
              type="number"
              step="0.01"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              placeholder="0.00"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <Input
              label="Category ID"
              type="number"
              value={formData.categoryId}
              onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
              placeholder="Optional"
            />
            <Input
              label="Currency"
              value={formData.currency}
              onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
              placeholder="USD"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <Input
              label="SKU"
              value={formData.sku}
              onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
              placeholder="Optional"
            />
            <Input
              label="Stock Quantity"
              type="number"
              value={formData.stockQuantity}
              onChange={(e) => setFormData({ ...formData, stockQuantity: e.target.value })}
              placeholder="0"
            />
          </div>

          <Input
            label="Image URL"
            type="url"
            value={formData.imageUrl}
            onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
            placeholder="https://example.com/image.jpg"
          />

          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Describe your product..."
              rows={4}
              className="w-full px-4 py-2.5 rounded-button border border-navy-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Status</label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              className="w-full px-4 py-2.5 border border-navy-300 rounded-button focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-6 border-t border-navy-200">
            <Link to="/dashboard/products">
              <Button variant="outline" type="button">Cancel</Button>
            </Link>
            <Button type="submit" loading={loading}>Create Product</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}