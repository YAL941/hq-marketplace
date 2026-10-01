import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { productApi } from '../services/api';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Card } from '../components/common/Card';
import { ErrorState } from '../components/common/ErrorState';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams, useNavigate } from 'react-router-dom';

export function ProductEditPage() {
  const { currentBusiness } = useAuth();
  const { productId } = useParams<{ productId: string }>();
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentBusiness || !productId) return;
    const fetchProduct = async () => {
      try {
        const res = await productApi.getForBusiness(currentBusiness.business_id, parseInt(productId));
        const p = res.data.data;
        setFormData({
          productName: p.product_name,
          categoryId: p.category_id?.toString() || '',
          description: p.description || '',
          price: p.price,
          currency: p.currency,
          sku: p.sku || '',
          imageUrl: p.image_url || '',
          stockQuantity: p.stock_quantity?.toString() || '',
          status: p.status,
        });
      } catch (err) {
        setError('Failed to load product');
      } finally {
        setLoading(false);
      }
    };
    fetchProduct();
  }, [currentBusiness, productId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBusiness) return;
    setSaving(true);
    setError(null);
    try {
      await productApi.update(currentBusiness.business_id, parseInt(productId!), {
        ...formData,
        categoryId: formData.categoryId ? parseInt(formData.categoryId) : null,
        price: parseFloat(formData.price),
        stockQuantity: formData.stockQuantity ? parseInt(formData.stockQuantity) : 0,
      });
      navigate('/dashboard/products');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to update product');
    } finally {
      setSaving(false);
    }
  };

  if (!currentBusiness) return <ErrorState message="No business selected" />;
  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent" /></div>;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link to="/dashboard/products" className="inline-flex items-center gap-2 text-navy-600 hover:text-navy-900 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Products
        </Link>
        <h1 className="text-2xl font-bold text-navy-900">Edit Product</h1>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && <ErrorState message={error} />}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <Input label="Product Name" value={formData.productName} onChange={(e) => setFormData({ ...formData, productName: e.target.value })} required />
            <Input label="Price" type="number" step="0.01" value={formData.price} onChange={(e) => setFormData({ ...formData, price: e.target.value })} required />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <Input label="Category ID" type="number" value={formData.categoryId} onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })} />
            <Input label="Currency" value={formData.currency} onChange={(e) => setFormData({ ...formData, currency: e.target.value })} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <Input label="SKU" value={formData.sku} onChange={(e) => setFormData({ ...formData, sku: e.target.value })} />
            <Input label="Stock Quantity" type="number" value={formData.stockQuantity} onChange={(e) => setFormData({ ...formData, stockQuantity: e.target.value })} />
          </div>

          <Input label="Image URL" type="url" value={formData.imageUrl} onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })} />

          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Description</label>
            <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={4} className="w-full px-4 py-2.5 rounded-button border border-navy-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none" />
          </div>

          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Status</label>
            <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })} className="w-full px-4 py-2.5 border border-navy-300 rounded-button focus:outline-none focus:ring-2 focus:ring-primary-500">
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-6 border-t border-navy-200">
            <Link to="/dashboard/products"><Button variant="outline" type="button">Cancel</Button></Link>
            <Button type="submit" loading={saving}>Save Changes</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}