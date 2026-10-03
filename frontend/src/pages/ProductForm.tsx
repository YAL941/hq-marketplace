import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Package } from 'lucide-react';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { Skeleton } from '../components/common/Skeleton';
import { productApi, toFieldIssue, type FieldIssue } from '../services/api';
import type { CatalogueStatus, Product } from '../types';

const STATUSES: CatalogueStatus[] = ['draft', 'active', 'inactive', 'archived'];

interface FormState {
  productName: string;
  description: string;
  price: string;
  currency: string;
  sku: string;
  stockQuantity: string;
  status: CatalogueStatus;
}

/**
 * One form for both creating and editing a product.
 *
 * The route decides which by whether `:productId` is present, so the two screens
 * cannot drift apart in what they validate or what they send. Everything here is
 * validated before the request as well as by the server: the point is to say
 * which field is wrong, not merely that something is.
 */
export function ProductFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ businessId: string; productId: string }>();
  const productId = params.productId;
  const isEdit = productId !== undefined;
  const businessId = Number(params.businessId);

  const [form, setForm] = useState<FormState>({
    productName: '',
    description: '',
    price: '',
    currency: 'USD',
    sku: '',
    stockQuantity: '',
    status: 'draft',
  });
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [issue, setIssue] = useState<FieldIssue | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadFailed(false);
      try {
        const res = await productApi.getForBusiness(businessId, Number(productId));
        if (cancelled) return;
        const p: Product = res.data.data;
        setForm({
          productName: p.product_name,
          description: p.description ?? '',
          price: p.price,
          currency: p.currency,
          sku: p.sku ?? '',
          stockQuantity: p.is_stock_tracked ? String(p.stock_quantity) : '',
          status: p.status,
        });
      } catch {
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [businessId, productId, isEdit]);

  const set = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setIssue(null);
  };

  const fieldError = (field: FieldIssue['field']) =>
    issue && issue.field === field ? issue.message || t('common.saveFailed') : undefined;

  /**
   * Price and stock are sent as numbers because the server's schema is
   * `z.number()`; sending the raw string would be a 400 on a form that looks
   * correct. `Number('')` is 0, which is why an empty box is checked first.
   */
  const validate = (): FieldIssue | null => {
    if (form.productName.trim().length < 2) {
      return { field: 'productName', message: t('product.errorName') };
    }
    if (form.price.trim() === '') {
      return { field: 'price', message: t('product.errorPriceRequired') };
    }
    const price = Number(form.price);
    if (!Number.isFinite(price) || price < 0) {
      return { field: 'price', message: t('product.errorPrice') };
    }
    if (!/^[A-Z]{3}$/.test(form.currency)) {
      return { field: 'currency', message: t('product.errorCurrency') };
    }
    if (form.stockQuantity.trim() !== '') {
      const stock = Number(form.stockQuantity);
      if (!Number.isInteger(stock) || stock < 0) {
        return { field: 'stockQuantity', message: t('product.errorStock') };
      }
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validate();
    if (invalid) {
      setIssue(invalid);
      return;
    }

    setSaving(true);
    setIssue(null);
    try {
      // Empty optional fields are sent as null rather than '', because the
      // schema is `nullish` and an empty string fails a length rule on some
      // columns.
      const payload = {
        productName: form.productName.trim(),
        description: form.description.trim() || null,
        price: Number(form.price),
        currency: form.currency.toUpperCase(),
        sku: form.sku.trim() || null,
        stockQuantity: form.stockQuantity.trim() === '' ? undefined : Number(form.stockQuantity),
        status: form.status,
      };

      if (isEdit) {
        await productApi.update(businessId, Number(productId), payload);
      } else {
        await productApi.create(businessId, payload);
      }
      navigate('/dashboard/products');
    } catch (error) {
      setIssue(toFieldIssue(error));
    } finally {
      setSaving(false);
    }
  };

  if (loadFailed) {
    return (
      <div className="py-16">
        <EmptyState
          icon={<Package className="w-8 h-8" />}
          title={t('common.loadFailed')}
          action={
            <Button variant="outline" onClick={() => navigate('/dashboard/products')}>
              {t('product.backToList')}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate('/dashboard/products')}
        className="inline-flex items-center gap-1 text-sm text-navy-500 hover:text-navy-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
        {t('product.backToList')}
      </button>

      <h1 className="text-2xl font-bold text-navy-900 mb-6">
        {isEdit ? t('product.editTitle') : t('product.createTitle')}
      </h1>

      <Card className="p-6 max-w-2xl">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} variant="rectangular" height={44} />
            ))}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {issue && !issue.field && (
              <p className="p-3 bg-error-50 border border-error-200 rounded-button text-error-700 text-sm" role="alert">
                {issue.message || t('common.saveFailed')}
              </p>
            )}

            <Input
              label={t('product.name')}
              value={form.productName}
              onChange={(e) => set('productName', e.target.value)}
              required
              maxLength={200}
              error={fieldError('productName')}
            />

            <div>
              <label htmlFor="product-description" className="block text-sm font-medium text-navy-700 mb-1.5">
                {t('product.description')}
              </label>
              <textarea
                id="product-description"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                rows={4}
                maxLength={5000}
                className="w-full rounded-button border border-navy-300 px-4 py-2.5 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label={t('product.price')}
                value={form.price}
                onChange={(e) => set('price', e.target.value)}
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                required
                error={fieldError('price')}
              />
              <Input
                label={t('product.currency')}
                value={form.currency}
                onChange={(e) => set('currency', e.target.value.toUpperCase())}
                maxLength={3}
                required
                helperText={t('product.currencyHint')}
                error={fieldError('currency')}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label={t('product.sku')}
                value={form.sku}
                onChange={(e) => set('sku', e.target.value)}
                maxLength={64}
                error={fieldError('sku')}
              />
              <Input
                label={t('product.stock')}
                value={form.stockQuantity}
                onChange={(e) => set('stockQuantity', e.target.value)}
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                error={fieldError('stockQuantity')}
              />
            </div>

            <div>
              <label htmlFor="product-status" className="block text-sm font-medium text-navy-700 mb-1.5">
                {t('product.status')}
              </label>
              <select
                id="product-status"
                value={form.status}
                onChange={(e) => set('status', e.target.value)}
                className="w-full rounded-button border border-navy-300 px-3 py-2.5 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`status.${status}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <Button type="submit" loading={saving}>
                {isEdit ? t('common.save') : t('product.create')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('/dashboard/products')}
                disabled={saving}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}