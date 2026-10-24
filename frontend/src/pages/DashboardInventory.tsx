import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowDownToLine, ArrowLeftRight, Boxes, ClipboardList,
  Package, PackagePlus, Search, Warehouse,
} from 'lucide-react';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { Input } from '../components/common/Input';
import { Skeleton } from '../components/common/Skeleton';
import { inventoryApi, locationApi, toFieldIssue } from '../services/api';
import type {
  Id, InventoryDashboardData, InventoryProduct, Location,
  StockMovement, StockMovementQuery, StockMovementType, StockRestockRequest,
} from '../types';
import { formatDateTime } from '../lib/utils';

const PAGE_SIZE = 25;
const EMPTY_DASHBOARD: InventoryDashboardData = {
  summary: { active_products: 0, total_units: 0, low_stock_products: 0, out_of_stock_products: 0 },
  products: { rows: [], total: 0 },
  recentMovements: [],
  restockRequests: [],
  canManageInventory: false,
};

type View = 'stock' | 'movements' | 'sales';
type ActionMode = 'movement' | 'restock' | null;
type WritableMovement = 'purchase' | 'return' | 'adjustment_in' | 'adjustment_out';

interface SalesRow {
  product_id: Id;
  product_name: string;
  sku: string | null;
  location_id: Id | null;
  location_name: string | null;
  units_sold: number;
  units_restored: number;
  units_returned: number;
  net_consumption: number;
  sales_amount: string;
}

export function DashboardInventoryPage() {
  const { t } = useTranslation();
  const { businessId = '' } = useParams<{ businessId: Id }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedProductId = searchParams.get('productId') ?? '';
  const [dashboard, setDashboard] = useState(EMPTY_DASHBOARD);
  const [locations, setLocations] = useState<Location[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [salesRows, setSalesRows] = useState<SalesRow[]>([]);
  const [salesTotal, setSalesTotal] = useState(0);
  const [view, setView] = useState<View>('stock');
  const [search, setSearch] = useState('');
  const [stockStatus, setStockStatus] = useState<'all' | 'low' | 'out' | 'in_stock'>('all');
  const [movementType, setMovementType] = useState<StockMovementType | ''>('');
  const [locationId, setLocationId] = useState('');
  const [offset, setOffset] = useState(0);
  const [movementTotal, setMovementTotal] = useState(0);
  const [salesOffset, setSalesOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [viewLoading, setViewLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionMode, setActionMode] = useState<ActionMode>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [issue, setIssue] = useState('');
  const [movementDraft, setMovementDraft] = useState({
    productId: linkedProductId,
    locationId: '',
    movementType: 'purchase' as WritableMovement,
    quantity: '1',
    note: '',
    idempotencyKey: '',
  });
  const [restockDraft, setRestockDraft] = useState({
    productId: linkedProductId,
    locationId: '',
    requestedQuantity: '1',
    note: '',
  });

  const loadDashboard = useCallback(async (silent = false) => {
    if (!businessId) return;
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const [inventoryResponse, locationResponse] = await Promise.all([
        inventoryApi.dashboard(businessId, {
          limit: PAGE_SIZE,
          offset,
          search: search.trim() || undefined,
          stockStatus,
          locationId: locationId || undefined,
          productId: linkedProductId || undefined,
        }),
        locationApi.listForBusiness(businessId),
      ]);
      setDashboard(inventoryResponse.data.data);
      setLocations(locationResponse.data.data.filter((location) => location.is_active));
    } catch (requestError) {
      if (!silent) setError(toFieldIssue(requestError).message || t('inventory.loadError'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [businessId, linkedProductId, locationId, offset, search, stockStatus, t]);

  const loadMovements = useCallback(async () => {
    if (!businessId) return;
    setViewLoading(true);
    setError('');
    try {
      const params: StockMovementQuery = {
        limit: PAGE_SIZE,
        offset,
        locationId: locationId || undefined,
        movementType: movementType || undefined,
      };
      const response = await inventoryApi.movements(businessId, params);
      setMovements(response.data.data);
      setMovementTotal(Number(response.data.meta?.total ?? response.data.data.length));
    } catch (requestError) {
      setError(toFieldIssue(requestError).message || t('inventory.loadError'));
    } finally {
      setViewLoading(false);
    }
  }, [businessId, locationId, movementType, offset, t]);

  const loadSales = useCallback(async () => {
    if (!businessId) return;
    setViewLoading(true);
    setError('');
    try {
      const response = await inventoryApi.report(businessId, 'sales', {
        limit: PAGE_SIZE,
        offset: salesOffset,
        locationId: locationId || undefined,
      });
      setSalesRows(response.data.data as unknown as SalesRow[]);
      setSalesTotal(Number(response.data.meta?.total ?? response.data.data.length));
    } catch (requestError) {
      setError(toFieldIssue(requestError).message || t('inventory.loadError'));
    } finally {
      setViewLoading(false);
    }
  }, [businessId, locationId, salesOffset, t]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (view === 'movements') void loadMovements();
    if (view === 'sales') void loadSales();
  }, [loadMovements, loadSales, view]);

  const productsById = useMemo(
    () => new Map(dashboard.products.rows.map((product) => [product.product_id, product])),
    [dashboard.products.rows],
  );

  const resetPaging = (update: () => void) => {
    setOffset(0);
    setSalesOffset(0);
    update();
  };

  const openAction = (mode: Exclude<ActionMode, null>, product?: InventoryProduct) => {
    const id = product?.product_id ?? linkedProductId;
    const selectedLocation = locationId || product?.location_id || locations[0]?.location_id || '';
    if (mode === 'movement') {
      setMovementDraft({
        productId: id, locationId: selectedLocation, movementType: 'purchase', quantity: '1', note: '',
        idempotencyKey: crypto.randomUUID(),
      });
    } else {
      setRestockDraft({ productId: id, locationId: selectedLocation, requestedQuantity: '1', note: '' });
    }
    setIssue('');
    setActionMode(mode);
  };

  const submitMovement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIssue('');
    const quantity = Number(movementDraft.quantity);
    if (!movementDraft.productId || !Number.isInteger(quantity) || quantity <= 0) {
      setIssue(t('inventory.invalidQuantity'));
      return;
    }
    if (movementDraft.movementType === 'adjustment_out'
      && !window.confirm(t('inventory.confirmAdjustmentOut'))) return;
    setBusy(true);
    try {
      await inventoryApi.createMovement(businessId, {
        productId: Number(movementDraft.productId),
        ...(movementDraft.locationId ? { locationId: Number(movementDraft.locationId) } : {}),
        movementType: movementDraft.movementType,
        quantity,
        ...(movementDraft.movementType === 'return' ? { idempotencyKey: movementDraft.idempotencyKey } : {}),
        note: movementDraft.note.trim() || null,
      });
      setActionMode(null);
      await loadDashboard();
      if (view === 'movements') await loadMovements();
    } catch (requestError) {
      setIssue(toFieldIssue(requestError).message || t('inventory.saveError'));
    } finally {
      setBusy(false);
    }
  };

  const submitRestock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIssue('');
    const requestedQuantity = Number(restockDraft.requestedQuantity);
    if (!restockDraft.productId || !Number.isInteger(requestedQuantity) || requestedQuantity <= 0) {
      setIssue(t('inventory.invalidQuantity'));
      return;
    }
    setBusy(true);
    try {
      await inventoryApi.createRestockRequest(businessId, {
        productId: Number(restockDraft.productId),
        ...(restockDraft.locationId ? { locationId: Number(restockDraft.locationId) } : {}),
        requestedQuantity,
        note: restockDraft.note.trim() || null,
      });
      setActionMode(null);
      await loadDashboard();
    } catch (requestError) {
      setIssue(toFieldIssue(requestError).message || t('inventory.saveError'));
    } finally {
      setBusy(false);
    }
  };

  const updateRestock = async (request: StockRestockRequest, status: 'acknowledged' | 'fulfilled' | 'cancelled') => {
    if (status === 'cancelled' && !window.confirm(t('inventory.confirmCancelRestock'))) return;
    setBusy(true);
    setError('');
    try {
      await inventoryApi.updateRestockRequest(businessId, request.restock_request_id, status);
      await loadDashboard(true);
    } catch (requestError) {
      setError(toFieldIssue(requestError).message || t('inventory.saveError'));
    } finally {
      setBusy(false);
    }
  };

  const downloadReport = async (report: 'stock' | 'low-stock' | 'movements' | 'sales') => {
    setDownloading(true);
    setError('');
    try {
      const response = await inventoryApi.downloadReport(businessId, report, {
        ...(locationId ? { locationId } : {}),
        ...(view === 'movements' && movementType ? { movementType } : {}),
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `hq-stock-${report}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(toFieldIssue(requestError).message || t('inventory.downloadError'));
    } finally {
      setDownloading(false);
    }
  };

  const changeView = (next: View) => {
    setView(next);
    setOffset(0);
    setSalesOffset(0);
    setError('');
  };

  const selectStockStatus = (value: 'all' | 'low' | 'out' | 'in_stock') =>
    resetPaging(() => setStockStatus(value));

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">{t('inventory.title')}</h1>
          <p className="mt-1 text-sm text-navy-600">{t('inventory.subtitle')}</p>
        </div>
        {dashboard.canManageInventory && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => openAction('movement')}>
              <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
              {t('inventory.recordMovement')}
            </Button>
            <Button type="button" onClick={() => openAction('restock')}>
              <PackagePlus className="h-4 w-4" aria-hidden="true" />
              {t('inventory.requestRestock')}
            </Button>
          </div>
        )}
      </header>

      {error && <p role="alert" className="rounded-button border border-error-200 bg-error-50 p-3 text-sm text-error-700">{error}</p>}

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label={t('inventory.summary')}>
        <Metric icon={<Package className="h-5 w-5" aria-hidden="true" />} label={t('inventory.activeProducts')} value={dashboard.summary.active_products} loading={loading} />
        <Metric icon={<Boxes className="h-5 w-5" aria-hidden="true" />} label={t('inventory.totalUnits')} value={dashboard.summary.total_units} loading={loading} />
        <Metric
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          label={t('inventory.lowStock')}
          value={dashboard.summary.low_stock_products}
          loading={loading}
          onClick={() => { changeView('stock'); selectStockStatus('low'); }}
        />
        <Metric
          icon={<Package className="h-5 w-5" aria-hidden="true" />}
          label={t('inventory.outOfStock')}
          value={dashboard.summary.out_of_stock_products}
          loading={loading}
          onClick={() => { changeView('stock'); selectStockStatus('out'); }}
        />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-navy-200">
        <div className="flex gap-5" role="tablist" aria-label={t('inventory.views')}>
          {(['stock', 'movements', 'sales'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={view === tab}
              className={`min-h-11 border-b-2 px-1 text-sm font-medium ${view === tab ? 'border-primary-600 text-primary-700' : 'border-transparent text-navy-500 hover:text-navy-800'}`}
              onClick={() => changeView(tab)}
            >
              {t(`inventory.tabs.${tab}`)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <label className="sr-only" htmlFor="inventory-location-filter">{t('inventory.location')}</label>
          <select
            id="inventory-location-filter"
            value={locationId}
            onChange={(event) => resetPaging(() => setLocationId(event.target.value))}
            className="min-h-10 rounded-button border border-navy-300 bg-white px-3 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">{t('inventory.allLocations')}</option>
            {locations.map((location) => <option key={location.location_id} value={location.location_id}>{location.location_name}</option>)}
          </select>
          <label htmlFor="inventory-download" className="sr-only">{t('inventory.downloadReport')}</label>
          <select
            id="inventory-download"
            defaultValue=""
            disabled={downloading}
            onChange={(event) => {
              const report = event.target.value as 'stock' | 'low-stock' | 'movements' | 'sales' | '';
              if (report) void downloadReport(report);
              event.target.value = '';
            }}
            className="min-h-10 rounded-button border border-navy-300 bg-white px-3 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">{downloading ? t('common.loading') : t('inventory.downloadReport')}</option>
            <option value="stock">{t('inventory.tabs.stock')}</option>
            <option value="low-stock">{t('inventory.lowStock')}</option>
            <option value="movements">{t('inventory.tabs.movements')}</option>
            <option value="sales">{t('inventory.tabs.sales')}</option>
          </select>
        </div>
      </div>

      {view === 'stock' && (
        <section className="space-y-4" role="tabpanel">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" aria-hidden="true" />
              <label htmlFor="inventory-search" className="sr-only">{t('inventory.search')}</label>
              <input
                id="inventory-search"
                type="search"
                value={search}
                onChange={(event) => resetPaging(() => setSearch(event.target.value))}
                placeholder={t('inventory.search')}
                className="min-h-11 w-full rounded-button border border-navy-300 bg-white ps-10 pe-3 text-sm text-navy-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <label className="sr-only" htmlFor="inventory-stock-filter">{t('inventory.stockStatus')}</label>
            <select
              id="inventory-stock-filter"
              value={stockStatus}
              onChange={(event) => selectStockStatus(event.target.value as typeof stockStatus)}
              className="min-h-11 rounded-button border border-navy-300 bg-white px-3 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {(['all', 'low', 'out', 'in_stock'] as const).map((status) => (
                <option key={status} value={status}>{t(`inventory.stockFilters.${status}`)}</option>
              ))}
            </select>
            {linkedProductId && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSearchParams((current) => {
                  const next = new URLSearchParams(current);
                  next.delete('productId');
                  return next;
                }, { replace: true })}
              >
                {t('inventory.clearProductFilter')}
              </Button>
            )}
          </div>
          {loading ? (
            <div className="space-y-3" role="status">{[0, 1, 2].map((row) => <Skeleton key={row} variant="rectangular" height={64} />)}</div>
          ) : dashboard.products.rows.length === 0 ? (
            <Card padding="none"><EmptyState icon={<Warehouse className="h-7 w-7" />} title={t('inventory.emptyTitle')} description={t('inventory.emptyDescription')} /></Card>
          ) : (
            <>
              <div className="overflow-x-auto rounded-card border border-navy-200 bg-white">
                <table className="w-full min-w-[760px] border-collapse text-start text-sm">
                  <thead className="bg-navy-50 text-xs uppercase text-navy-500">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-start">{t('inventory.product')}</th>
                      <th scope="col" className="px-4 py-3 text-start">{t('inventory.skuBarcode')}</th>
                      <th scope="col" className="px-4 py-3 text-end">{t('inventory.quantity')}</th>
                      <th scope="col" className="px-4 py-3 text-end">{t('inventory.minimumStock')}</th>
                      <th scope="col" className="px-4 py-3 text-start">{t('inventory.status')}</th>
                      <th scope="col" className="px-4 py-3 text-end">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-100">
                    {dashboard.products.rows.map((product) => (
                      <StockProductRow
                        key={`${product.product_id}-${product.location_id ?? 'unassigned'}`}
                        product={product}
                        canManage={dashboard.canManageInventory}
                        onReceive={() => openAction('movement', product)}
                        onRestock={() => openAction('restock', product)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager offset={offset} count={dashboard.products.rows.length} total={dashboard.products.total} loading={loading} onOffset={setOffset} label={t('inventory.products')} />
            </>
          )}
        </section>
      )}

      {view === 'movements' && (
        <section className="space-y-4" role="tabpanel">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-navy-600">{t('inventory.movementLedgerHint')}</p>
            <label className="sr-only" htmlFor="movement-type-filter">{t('inventory.movementType')}</label>
            <select
              id="movement-type-filter"
              value={movementType}
              onChange={(event) => { setOffset(0); setMovementType(event.target.value as StockMovementType | ''); }}
              className="min-h-10 rounded-button border border-navy-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">{t('inventory.allMovementTypes')}</option>
              {(['opening_balance', 'purchase', 'sale', 'return', 'adjustment_in', 'adjustment_out', 'cancellation_restore'] as const).map((type) => (
                <option key={type} value={type}>{t(`inventory.movementTypes.${type}`)}</option>
              ))}
            </select>
          </div>
          {viewLoading ? <Skeleton variant="rectangular" height={240} /> : movements.length === 0 ? (
            <Card padding="none"><EmptyState icon={<ClipboardList className="h-7 w-7" />} title={t('inventory.noMovements')} /></Card>
          ) : (
            <>
              <div className="overflow-x-auto rounded-card border border-navy-200 bg-white">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead className="bg-navy-50 text-xs uppercase text-navy-500"><tr>
                    {[t('inventory.date'), t('inventory.product'), t('inventory.movementType'), t('inventory.quantity'), t('inventory.balance'), t('inventory.source')].map((label) => <th key={label} scope="col" className="px-4 py-3 text-start">{label}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-navy-100">
                    {movements.map((movement) => <MovementRow key={movement.stock_movement_id} movement={movement} />)}
                  </tbody>
                </table>
              </div>
              <Pager offset={offset} count={movements.length} total={movementTotal} loading={viewLoading} onOffset={setOffset} label={t('inventory.movements')} />
            </>
          )}
        </section>
      )}

      {view === 'sales' && (
        <section className="space-y-4" role="tabpanel">
          <p className="text-sm text-navy-600">{t('inventory.salesHint')}</p>
          {viewLoading ? <Skeleton variant="rectangular" height={240} /> : salesRows.length === 0 ? (
            <Card padding="none"><EmptyState icon={<ArrowDownToLine className="h-7 w-7" />} title={t('inventory.noSales')} description={t('inventory.salesHint')} /></Card>
          ) : (
            <>
              <div className="overflow-x-auto rounded-card border border-navy-200 bg-white">
                <table className="w-full min-w-[650px] border-collapse text-sm">
                  <thead className="bg-navy-50 text-xs uppercase text-navy-500"><tr>
                    {[t('inventory.product'), t('inventory.location'), t('inventory.unitsSold'), t('inventory.unitsRestored'), t('inventory.netConsumption'), t('inventory.salesAmount')].map((label) => <th key={label} scope="col" className="px-4 py-3 text-start">{label}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-navy-100">
                    {salesRows.map((row) => <tr key={`${row.product_id}-${row.location_id ?? 'unassigned'}`}>
                      <td className="px-4 py-3 font-medium text-navy-900">{row.product_name}</td>
                      <td className="px-4 py-3 text-navy-600">{row.location_name || t('inventory.unassignedLocation')}</td>
                      <td className="px-4 py-3 text-end tabular-nums">{row.units_sold}</td>
                      <td className="px-4 py-3 text-end tabular-nums">{row.units_restored}</td>
                      <td className="px-4 py-3 text-end font-semibold tabular-nums">{row.net_consumption}</td>
                      <td className="px-4 py-3 text-end tabular-nums">{row.sales_amount}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-navy-500">{t('inventory.showing', {
                  label: t('inventory.products'),
                  first: salesTotal === 0 ? 0 : salesOffset + 1,
                  last: salesOffset + salesRows.length,
                  total: salesTotal,
                })}</p>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={salesOffset === 0 || viewLoading} onClick={() => setSalesOffset(Math.max(0, salesOffset - PAGE_SIZE))}>{t('common.previous')}</Button>
                  <Button type="button" variant="outline" size="sm" disabled={salesOffset + salesRows.length >= salesTotal || viewLoading} onClick={() => setSalesOffset(salesOffset + PAGE_SIZE)}>{t('common.next')}</Button>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      <section className="grid gap-4 xl:grid-cols-2" aria-label={t('inventory.activityAndRequests')}>
        <Card padding="none" className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-navy-100 px-4 py-3">
            <h2 className="font-semibold text-navy-900">{t('inventory.recentActivity')}</h2>
            <Button type="button" variant="ghost" size="sm" onClick={() => changeView('movements')}>
              {t('inventory.viewLedger')}
            </Button>
          </div>
          {loading ? <div className="space-y-2 p-4">{[0, 1, 2].map((row) => <Skeleton key={row} variant="rectangular" height={42} />)}</div> : dashboard.recentMovements.length === 0 ? (
            <p className="p-4 text-sm text-navy-500">{t('inventory.noMovements')}</p>
          ) : (
            <ul className="divide-y divide-navy-100">
              {dashboard.recentMovements.map((movement) => (
                <li key={movement.stock_movement_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="min-w-0 truncate font-medium text-navy-800">{movement.product_name}</span>
                  <span className="shrink-0 text-navy-500">{t(`inventory.movementTypes.${movement.movement_type}`)}</span>
                  <span className="shrink-0 tabular-nums text-navy-700">{movement.quantity} · {formatDateTime(movement.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card padding="none" className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-navy-100 px-4 py-3">
            <h2 className="font-semibold text-navy-900">{t('inventory.restockRequests')}</h2>
            {dashboard.canManageInventory && (
              <Button type="button" variant="ghost" size="sm" onClick={() => openAction('restock')}>
                <PackagePlus className="h-4 w-4" aria-hidden="true" />
                {t('inventory.requestRestock')}
              </Button>
            )}
          </div>
          {loading ? <div className="space-y-2 p-4">{[0, 1].map((row) => <Skeleton key={row} variant="rectangular" height={44} />)}</div> : dashboard.restockRequests.length === 0 ? (
            <p className="p-4 text-sm text-navy-500">{t('inventory.noRestockRequests')}</p>
          ) : (
            <ul className="divide-y divide-navy-100">
              {dashboard.restockRequests.map((request) => (
                <li key={request.restock_request_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-navy-900">{request.product_name}</p>
                    <p className="text-xs text-navy-500">{t('inventory.requestedQuantity', { count: request.requested_quantity })} · {t(`inventory.requestStatus.${request.status}`)}</p>
                  </div>
                  {dashboard.canManageInventory && request.status !== 'fulfilled' && request.status !== 'cancelled' && (
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => {
                        const params = new URLSearchParams({
                          productId: String(request.product_id),
                          quantity: String(request.requested_quantity),
                        });
                        if (request.location_id) params.set('locationId', String(request.location_id));
                        navigate(`/dashboard/business/${businessId}/wholesale?${params.toString()}`);
                      }}>{t('inventory.findSuppliers')}</Button>
                      {request.status === 'requested' && (
                        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void updateRestock(request, 'acknowledged')}>{t('inventory.acknowledge')}</Button>
                      )}
                      {request.status === 'acknowledged' && (
                        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void updateRestock(request, 'fulfilled')}>{t('inventory.markFulfilled')}</Button>
                      )}
                      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void updateRestock(request, 'cancelled')}>{t('common.cancel')}</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {actionMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setActionMode(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="inventory-action-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card border border-navy-200 bg-white p-5 shadow-xl sm:p-6">
            <h2 id="inventory-action-title" className="text-lg font-semibold text-navy-900">
              {t(actionMode === 'movement' ? 'inventory.recordMovement' : 'inventory.requestRestock')}
            </h2>
            <p className="mt-1 text-sm text-navy-600">{t(actionMode === 'movement' ? 'inventory.movementFormHint' : 'inventory.restockFormHint')}</p>
            {issue && <p role="alert" className="mt-4 rounded-button border border-error-200 bg-error-50 p-3 text-sm text-error-700">{issue}</p>}
            {actionMode === 'movement' ? (
              <form className="mt-5 space-y-4" onSubmit={(event) => void submitMovement(event)}>
                <label className="block text-sm font-medium text-navy-700">
                  {t('inventory.product')}
                  <select required value={movementDraft.productId} onChange={(event) => setMovementDraft((current) => ({ ...current, productId: event.target.value }))} className="mt-1 min-h-11 w-full rounded-button border border-navy-300 bg-white px-3 font-normal focus:outline-none focus:ring-2 focus:ring-primary-500">
                    <option value="">{t('inventory.chooseProduct')}</option>
                    {dashboard.products.rows.map((product) => <option key={product.product_id} value={product.product_id}>{product.product_name}</option>)}
                    {linkedProductId && !productsById.has(linkedProductId) && <option value={linkedProductId}>{t('inventory.linkedProduct')}</option>}
                  </select>
                </label>
                <label className="block text-sm font-medium text-navy-700">
                  {t('inventory.movementType')}
                  <select value={movementDraft.movementType} onChange={(event) => setMovementDraft((current) => ({ ...current, movementType: event.target.value as WritableMovement }))} className="mt-1 min-h-11 w-full rounded-button border border-navy-300 bg-white px-3 font-normal focus:outline-none focus:ring-2 focus:ring-primary-500">
                    {(['purchase', 'return', 'adjustment_in', 'adjustment_out'] as const).map((type) => <option key={type} value={type}>{t(`inventory.movementTypes.${type}`)}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-medium text-navy-700">
                  {t('inventory.location')}
                  <select value={movementDraft.locationId} onChange={(event) => setMovementDraft((current) => ({ ...current, locationId: event.target.value }))} className="mt-1 min-h-11 w-full rounded-button border border-navy-300 bg-white px-3 font-normal focus:outline-none focus:ring-2 focus:ring-primary-500">
                    <option value="">{t('inventory.unassignedLocation')}</option>
                    {locations.map((location) => <option key={location.location_id} value={location.location_id}>{location.location_name}</option>)}
                  </select>
                </label>
                <Input label={t('inventory.quantity')} type="number" min="1" step="1" inputMode="numeric" required value={movementDraft.quantity} onChange={(event) => setMovementDraft((current) => ({ ...current, quantity: event.target.value }))} />
                <Input label={t('inventory.noteOptional')} maxLength={500} value={movementDraft.note} onChange={(event) => setMovementDraft((current) => ({ ...current, note: event.target.value }))} />
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" disabled={busy} onClick={() => setActionMode(null)}>{t('common.cancel')}</Button>
                  <Button type="submit" loading={busy}>{t('common.save')}</Button>
                </div>
              </form>
            ) : (
              <form className="mt-5 space-y-4" onSubmit={(event) => void submitRestock(event)}>
                <label className="block text-sm font-medium text-navy-700">
                  {t('inventory.product')}
                  <select required value={restockDraft.productId} onChange={(event) => setRestockDraft((current) => ({ ...current, productId: event.target.value }))} className="mt-1 min-h-11 w-full rounded-button border border-navy-300 bg-white px-3 font-normal focus:outline-none focus:ring-2 focus:ring-primary-500">
                    <option value="">{t('inventory.chooseProduct')}</option>
                    {dashboard.products.rows.map((product) => <option key={product.product_id} value={product.product_id}>{product.product_name}</option>)}
                    {linkedProductId && !productsById.has(linkedProductId) && <option value={linkedProductId}>{t('inventory.linkedProduct')}</option>}
                  </select>
                </label>
                <label className="block text-sm font-medium text-navy-700">
                  {t('inventory.location')}
                  <select value={restockDraft.locationId} onChange={(event) => setRestockDraft((current) => ({ ...current, locationId: event.target.value }))} className="mt-1 min-h-11 w-full rounded-button border border-navy-300 bg-white px-3 font-normal focus:outline-none focus:ring-2 focus:ring-primary-500">
                    <option value="">{t('inventory.unassignedLocation')}</option>
                    {locations.map((location) => <option key={location.location_id} value={location.location_id}>{location.location_name}</option>)}
                  </select>
                </label>
                <Input label={t('inventory.requestedQuantityLabel')} type="number" min="1" step="1" inputMode="numeric" required value={restockDraft.requestedQuantity} onChange={(event) => setRestockDraft((current) => ({ ...current, requestedQuantity: event.target.value }))} />
                <Input label={t('inventory.noteOptional')} maxLength={500} value={restockDraft.note} onChange={(event) => setRestockDraft((current) => ({ ...current, note: event.target.value }))} />
                <p className="text-xs text-navy-500">{t('inventory.wholesaleIntegrationHint')}</p>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" disabled={busy} onClick={() => setActionMode(null)}>{t('common.cancel')}</Button>
                  <Button type="submit" loading={busy}>{t('inventory.submitRestockRequest')}</Button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  loading,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  loading: boolean;
  onClick?: () => void;
}) {
  return (
    <Card padding="sm" className={onClick ? 'cursor-pointer text-start hover:border-primary-300' : ''} onClick={onClick}>
      <div className="flex items-center gap-2 text-navy-500">{icon}<span className="text-xs font-medium">{label}</span></div>
      {loading ? <Skeleton variant="text" height={28} className="mt-2 w-20" /> : <p className="mt-2 text-2xl font-bold tabular-nums text-navy-900">{value.toLocaleString()}</p>}
    </Card>
  );
}

function StockProductRow({ product, canManage, onReceive, onRestock }: { product: InventoryProduct; canManage: boolean; onReceive: () => void; onRestock: () => void }) {
  const { t } = useTranslation();
  const out = product.stock_quantity === 0;
  const low = !out && product.stock_quantity <= product.minimum_stock;
  return (
    <tr>
      <th scope="row" className="px-4 py-3 text-start">
        <span className="block font-medium text-navy-900">{product.product_name}</span>
        <span className="block text-xs text-navy-500">{product.unit_of_measure}</span>
      </th>
      <td className="px-4 py-3 text-navy-600">{product.sku || '—'}{product.barcode && <span className="block text-xs">{product.barcode}</span>}</td>
      <td className="px-4 py-3 text-end font-semibold tabular-nums text-navy-900">{product.stock_quantity.toLocaleString()}</td>
      <td className="px-4 py-3 text-end tabular-nums text-navy-600">{product.minimum_stock.toLocaleString()}</td>
      <td className="px-4 py-3">
        <Badge variant={out ? 'danger' : low ? 'warning' : 'success'} size="sm">
          {t(out ? 'inventory.stockFilters.out' : low ? 'inventory.stockFilters.low' : 'inventory.stockFilters.in_stock')}
        </Badge>
      </td>
      <td className="px-4 py-3">
        {canManage && (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onReceive}>{t('inventory.receive')}</Button>
            {(out || low) && <Button type="button" variant="ghost" size="sm" onClick={onRestock}>{t('inventory.requestRestock')}</Button>}
          </div>
        )}
      </td>
    </tr>
  );
}

function MovementRow({ movement }: { movement: StockMovement }) {
  const { t } = useTranslation();
  return (
    <tr>
      <td className="px-4 py-3 whitespace-nowrap text-navy-600">{formatDateTime(movement.created_at)}</td>
      <th scope="row" className="px-4 py-3 text-start font-medium text-navy-900">{movement.product_name}</th>
      <td className="px-4 py-3 text-navy-600">{t(`inventory.movementTypes.${movement.movement_type}`)}</td>
      <td className="px-4 py-3 tabular-nums text-navy-800">{movement.quantity}</td>
      <td className="px-4 py-3 tabular-nums text-navy-600">{movement.previous_quantity} → {movement.resulting_quantity}</td>
      <td className="px-4 py-3 text-navy-600">{movement.source_reference || '—'}</td>
    </tr>
  );
}

function Pager({
  offset, count, total, loading, onOffset, label,
}: {
  offset: number;
  count: number;
  total: number;
  loading: boolean;
  onOffset: (offset: number) => void;
  label: string;
}) {
  const { t } = useTranslation();
  const first = total === 0 ? 0 : offset + 1;
  const last = offset + count;
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-navy-500">{t('inventory.showing', { label, first, last, total })}</p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" disabled={offset === 0 || loading} onClick={() => onOffset(Math.max(0, offset - PAGE_SIZE))}>{t('common.previous')}</Button>
        <Button type="button" variant="outline" size="sm" disabled={loading || count < PAGE_SIZE || offset + count >= total} onClick={() => onOffset(offset + PAGE_SIZE)}>{t('common.next')}</Button>
      </div>
    </div>
  );
}