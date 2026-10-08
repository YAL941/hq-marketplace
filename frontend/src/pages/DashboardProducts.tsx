import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Package, Plus, Pencil, Search } from 'lucide-react';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { Badge } from '../components/common/Badge';
import { OffsetPagerView, StaffListLayout } from '../components/common/OffsetPager';
import { useOffsetPager } from '../components/common/useOffsetPager';
import { SmartImage } from '../components/common/SmartImage';
import { productApi } from '../services/api';
import { formatCurrency, formatDate } from '../lib/utils';
import type { CatalogueStatus, Id, Product } from '../types';

const PAGE_SIZE = 20;
const STATUSES: Array<CatalogueStatus | ''> = ['', 'draft', 'active', 'inactive', 'archived'];

/**
 * The owner's product list.
 *
 * The filter box maps to the server's `search` parameter. It is not `q`: the
 * staff list schema names it `search`, and sending `q` is silently dropped, so
 * the search would look broken rather than fail loudly.
 */
export function DashboardProductsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ businessId: Id }>();
  // The id is whatever the route carried, as a string: it is a bigint on the
  // server, so `Number(...)` here would corrupt anything past 2^53.
  const businessId = params.businessId ?? '';

  const [items, setItems] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CatalogueStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<Id | null>(null);
  const pager = useOffsetPager(PAGE_SIZE);

  /**
   * Re-reads the current page of products.
   *
   * This is also what makes a just-uploaded thumbnail appear: the edit screen is
   * a different route, so returning to the list unmounts this component and the
   * mount effect runs again. No full page reload is involved, and no cache has
   * to be busted — every upload is written to a fresh random filename, so the
   * image URL itself is new and cannot be a stale hit.
   */
  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(false);
    try {
      const res = await productApi.listForBusiness(businessId, {
        limit: PAGE_SIZE,
        offset: pager.offset,
        search: search.trim() || undefined,
        status: status || undefined,
      });
      setItems(res.data.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [businessId, pager.offset, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Any filter change starts again at the first page. */
  const onSearchChange = (value: string) => {
    pager.reset();
    setSearch(value);
  };

  const onStatusChange = (value: string) => {
    pager.reset();
    setStatus(value as CatalogueStatus | '');
  };

  const archive = async (product: Product) => {
    setBusyId(product.product_id);
    try {
      await productApi.archive(businessId, product.product_id);
      // The row survives as archived, so the page is reloaded rather than the
      // item being spliced out: a stale list would still be showing it.
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-navy-900">{t('product.title')}</h1>
        <Button onClick={() => navigate(`/dashboard/business/${businessId}/products/create`)}>
          <Plus className="w-4 h-4" aria-hidden="true" />
          {t('product.create')}
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <label htmlFor="product-search" className="sr-only">{t('product.search')}</label>
          <Search
            className="absolute start-4 top-1/2 -translate-y-1/2 w-5 h-5 text-navy-400"
            aria-hidden="true"
          />
          <input
            id="product-search"
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('product.search')}
            className="w-full ps-12 pe-4 py-2.5 rounded-button border border-navy-300 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
        <div>
          <label htmlFor="product-status-filter" className="sr-only">{t('product.status')}</label>
          <select
            id="product-status-filter"
            value={status}
            onChange={(e) => onStatusChange(e.target.value)}
            className="w-full sm:w-auto rounded-button border border-navy-300 px-3 py-2.5 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            {STATUSES.map((value) => (
              <option key={value || 'all'} value={value}>
                {value ? t(`status.${value}`) : t('product.allStatuses')}
              </option>
            ))}
          </select>
        </div>
      </div>

      <StaffListLayout
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        onRetry={() => void load()}
        empty={
          <EmptyState
            icon={<Package className="w-8 h-8" />}
            title={t('product.emptyTitle')}
            description={t('product.emptyBody')}
            action={
              <Button onClick={() => navigate(`/dashboard/business/${businessId}/products/create`)}>
                {t('product.create')}
              </Button>
            }
          />
        }
      >
        <div className="space-y-3">
          {items.map((product) => (
            <Card key={product.product_id} padding="none" className="p-4">
              <div className="flex flex-wrap items-center gap-4">
                {/*
                  The 56×56 box is fixed, and these intrinsic dimensions match it,
                  so the row does not resize when the photo arrives. `alt` is
                  empty because the product name sits beside it.
                */}
                <div className="w-14 h-14 rounded-card bg-navy-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                  <SmartImage
                    value={product.image_url}
                    width={56}
                    height={56}
                    className="w-full h-full object-cover"
                    fallback={<Package className="w-6 h-6 text-navy-400" aria-hidden="true" />}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-navy-900 truncate">{product.product_name}</h3>
                    <Badge variant={product.status === 'active' ? 'success' : 'default'} size="sm">
                      {t(`status.${product.status}`)}
                    </Badge>
                  </div>
                  <p className="text-sm text-navy-500 mt-0.5">
                    {product.sku ? `${t('product.sku')}: ${product.sku}` : t('product.noSku')}
                  </p>
                  <p className="text-xs text-navy-400 mt-0.5">
                    {t('product.addedOn', { date: formatDate(product.created_at) })}
                  </p>
                </div>

                <div className="text-end">
                  <p className="font-semibold text-navy-900">
                    {formatCurrency(product.price, product.currency)}
                  </p>
                  {product.is_stock_tracked && (
                    <p className="text-xs text-navy-500">
                      {t('product.stockCount', { count: product.stock_quantity })}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      navigate(`/dashboard/business/${businessId}/products/${product.product_id}/edit`)
                    }
                  >
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                    {t('common.edit')}
                  </Button>
                  {product.status !== 'archived' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busyId === product.product_id}
                      onClick={() => void archive(product)}
                    >
                      {t('common.archive')}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>

        <OffsetPagerView
          pager={pager}
          returned={items.length}
          pageSize={PAGE_SIZE}
          disabled={loading}
        />
      </StaffListLayout>

      <p className="mt-4 text-xs text-navy-400">
        <Link to={`/dashboard/business/${businessId}/services`} className="hover:text-navy-600">
          {t('product.servicesInstead')}
        </Link>
      </p>
    </div>
  );
}