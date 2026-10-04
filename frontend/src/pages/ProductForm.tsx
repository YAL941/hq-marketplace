import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Image as ImageIcon, Package } from 'lucide-react';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { ImageUpload } from '../components/common/ImageUpload';
import { Toast, useToasts } from '../components/common/Toast';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { Skeleton } from '../components/common/Skeleton';
import { productApi, toFieldIssue, type FieldIssue } from '../services/api';
import type { CatalogueStatus, Id, Product, ProductInput } from '../types';

const STATUSES: CatalogueStatus[] = ['draft', 'active', 'inactive', 'archived'];

interface FormState {
  productName: string;
  description: string;
  price: string;
  currency: string;
  sku: string;
  imageUrl: string;
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
  const params = useParams<{ businessId: Id; productId: Id }>();
  // The id stays the string the route carried: it is a bigint on the server, so
  // turning it into a number would corrupt anything past 2^53. An empty string
  // is what "this route has no :productId" becomes.
  const productId = params.productId ?? '';
  const isEdit = productId !== '';
  const businessId = params.businessId ?? '';

  const [form, setForm] = useState<FormState>({
    productName: '',
    description: '',
    price: '',
    currency: 'USD',
    sku: '',
    imageUrl: '',
    stockQuantity: '',
    status: 'draft',
  });
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [issue, setIssue] = useState<FieldIssue | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  /**
   * The row as the server last confirmed it.
   *
   * Kept beside the form rather than inside it because an upload writes the
   * column on its own: once it has, the form's copy of `imageUrl` is stale, and
   * a Save that sent it would put the previous value back. Both are written
   * together by `applyStoredUrl`.
   */
  const [product, setProduct] = useState<Product | null>(null);
  /**
   * Whether the person typed a link rather than uploading.
   *
   * `imageUrl` goes into the PATCH only while this is true. An upload has
   * already written it, so sending the form's value again would be a redundant
   * write of data the server has — and, one request later, a revert.
   */
  const [linkEdited, setLinkEdited] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  /** Set after a create, to offer the move to the edit page. */
  const [createdProductId, setCreatedProductId] = useState<Id | null>(null);
  const { toasts, show: showToast, dismiss } = useToasts();

  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadFailed(false);
      try {
        const res = await productApi.getForBusiness(businessId, productId);
        if (cancelled) return;
        const p: Product = res.data.data;
        setProduct(p);
        setForm({
          productName: p.product_name,
          description: p.description ?? '',
          price: p.price,
          currency: p.currency,
          sku: p.sku ?? '',
          imageUrl: p.image_url ?? '',
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

  const setLink = (value: string) => {
    set('imageUrl', value);
    setLinkEdited(true);
  };

  /**
   * Adopts an image value the server has just written.
   *
   * The upload route answers with the updated product, so the new column value
   * is known and there is nothing to re-fetch. Both copies are updated together:
   * the form is what a later Save would send, the row is what the rest of the
   * screen reads, and updating one alone is how a stale value comes back.
   */
  const applyStoredUrl = (value: string | null) => {
    setForm((prev) => ({ ...prev, imageUrl: value ?? '' }));
    setProduct((prev) => (prev ? { ...prev, image_url: value } : prev));
    setLinkEdited(false);
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
    // Only judged when it was typed here. A stored `/uploads/...` path is not a
    // URL `new URL` accepts, and failing the form over a value the person never
    // entered would be a fault in the check, not in the form.
    if (linkEdited && form.imageUrl.trim() !== '') {
      try {
        new URL(form.imageUrl.trim());
      } catch {
        return { field: 'imageUrl', message: t('product.errorImageUrl') };
      }
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
      const payload: ProductInput = {
        productName: form.productName.trim(),
        description: form.description.trim() || null,
        price: Number(form.price),
        currency: form.currency.toUpperCase(),
        sku: form.sku.trim() || null,
        stockQuantity: form.stockQuantity.trim() === '' ? undefined : Number(form.stockQuantity),
        status: form.status,
      };

      // The upload route owns this column. Sending it again from the form would
      // duplicate a write the server already made, and would revert the image if
      // this copy were ever behind.
      if (linkEdited) payload.imageUrl = form.imageUrl.trim() || null;

      if (isEdit) {
        const res = await productApi.update(businessId, productId, payload);
        const updated = res.data.data;
        // The response is the whole row, so the image column comes back
        // authoritative and both copies are realigned to it.
        setProduct(updated);
        setForm((prev) => ({ ...prev, imageUrl: updated.image_url ?? '' }));
        setLinkEdited(false);
        navigate(`/dashboard/business/${businessId}/products`);
      } else {
        const res = await productApi.create(businessId, payload);
        const created = res.data.data;
        setProduct(created);
        setForm((prev) => ({ ...prev, imageUrl: created.image_url ?? '' }));
        setLinkEdited(false);
        // The row now exists, which is what the upload route needs, so the next
        // screen can offer to go and use it instead of leaving the person to
        // find the row in the list themselves.
        setCreatedProductId(created.product_id);
      }
    } catch (error) {
      const failure = toFieldIssue(error);
      const message =
        failure.status === 403
          ? t('errors.forbidden')
          : failure.status === 429
            ? t('errors.rateLimited')
            : failure.message || t('common.saveFailed');
      setIssue({ ...failure, message });
      showToast(message, 'error');
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
            <Button variant="outline" onClick={() => navigate(`/dashboard/business/${businessId}/products`)}>
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
        onClick={() => navigate(`/dashboard/business/${businessId}/products`)}
        className="inline-flex items-center gap-1 text-sm text-navy-500 hover:text-navy-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
        {t('product.backToList')}
      </button>

      <h1 className="text-2xl font-bold text-navy-900 mb-6">
        {isEdit ? t('product.editTitle') : t('product.createTitle')}
      </h1>

      {/* Shown instead of the form once a create has landed. The upload route is
          addressed by product id, so the photo can only be added on the edit
          screen — the row has to exist first. */}
      {createdProductId && (
        <Card className="p-6 max-w-2xl">
          <p className="font-semibold text-success-700">{t('product.createdTitle')}</p>
          <p className="text-sm text-navy-600 mt-1 mb-4">{t('product.createdBody')}</p>
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() =>
                navigate(`/dashboard/business/${businessId}/products/${createdProductId}/edit`)
              }
            >
              <ImageIcon className="w-4 h-4" aria-hidden="true" />
              {t('product.addPhoto')}
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate(`/dashboard/business/${businessId}/products`)}
            >
              {t('product.backToList')}
            </Button>
          </div>
        </Card>
      )}

      <Card className={`p-6 max-w-2xl ${createdProductId ? 'hidden' : ''}`}>
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

            {/* The upload route is `/business/:businessId/products/:productId/image`, so a
                product that has not been created yet has no id to address it
                with. Rather than hide the control — which reads as a missing
                feature — it is shown disabled and says why. */}
            <div>
              <span className="block text-sm font-medium text-navy-700 mb-1.5">
                {t('product.imageUrl')}
              </span>
              <ImageUpload
                kind="product"
                businessId={businessId}
                productId={productId}
                shape="square"
                // The server-confirmed column wins whenever the link is not being
                // typed into, so what is previewed is what is actually stored
                // rather than a form copy that could be one request behind.
                value={linkEdited ? form.imageUrl : (product?.image_url ?? form.imageUrl)}
                onChange={applyStoredUrl}
                // Save is held while an upload is in flight, and this widget is
                // held while Save is: both write the same column, and whichever
                // landed second would otherwise win without saying so.
                disabled={saving || !isEdit}
                hint={isEdit ? undefined : t('product.imageSaveFirst')}
                onBusyChange={setMediaBusy}
                onNotify={(kind, message) => showToast(message, kind)}
              />
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-navy-500 hover:text-navy-700">
                  {t('product.imageLinkOption')}
                </summary>
                <div className="mt-2">
                  <Input
                    label={t('product.imageUrl')}
                    type="url"
                    value={form.imageUrl}
                    onChange={(e) => setLink(e.target.value)}
                    placeholder="https://example.com/product.jpg"
                    error={fieldError('imageUrl')}
                  />
                </div>
              </details>
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
              <Button type="submit" loading={saving} disabled={mediaBusy}>
                {isEdit ? t('common.save') : t('product.create')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate(`/dashboard/business/${businessId}/products`)}
                disabled={saving || mediaBusy}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        )}
      </Card>

      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onRemove={() => dismiss(toast.id)} />
      ))}
    </div>
  );
}