import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Sparkles, Plus, Pencil, Search, Clock, Users } from 'lucide-react';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { Badge } from '../components/common/Badge';
import { OffsetPagerView, StaffListLayout, useOffsetPager } from '../components/common/OffsetPager';
import { serviceApi } from '../services/api';
import { formatCurrency } from '../lib/utils';
import type { CatalogueStatus, Id, Service } from '../types';

const PAGE_SIZE = 20;
const STATUSES: Array<CatalogueStatus | ''> = ['', 'draft', 'active', 'inactive', 'archived'];

/**
 * The owner's service list.
 *
 * Mirrors the product screen deliberately: same layout, same states, same pager.
 * The two catalogues have the same shape and differ only in a few columns, and
 * two layouts would be two things to keep in step.
 */
export function DashboardServicesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ businessId: Id }>();
  const businessId = params.businessId ?? '';

  const [items, setItems] = useState<Service[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CatalogueStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const pager = useOffsetPager(PAGE_SIZE, { filterKey: `${search}|${status}` });

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(false);
    try {
      const res = await serviceApi.listForBusiness(businessId, {
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

  const onSearchChange = (value: string) => {
    pager.reset();
    setSearch(value);
  };

  const onStatusChange = (value: string) => {
    pager.reset();
    setStatus(value as CatalogueStatus | '');
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-navy-900">{t('service.title')}</h1>
        <Button onClick={() => navigate(`/dashboard/business/${businessId}/services/create`)}>
          <Plus className="w-4 h-4" aria-hidden="true" />
          {t('service.create')}
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <label htmlFor="service-search" className="sr-only">{t('service.search')}</label>
          <Search
            className="absolute start-4 top-1/2 -translate-y-1/2 w-5 h-5 text-navy-400"
            aria-hidden="true"
          />
          <input
            id="service-search"
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('service.search')}
            className="w-full ps-12 pe-4 py-2.5 rounded-button border border-navy-300 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
        <div>
          <label htmlFor="service-status-filter" className="sr-only">{t('service.status')}</label>
          <select
            id="service-status-filter"
            value={status}
            onChange={(e) => onStatusChange(e.target.value)}
            className="w-full sm:w-auto rounded-button border border-navy-300 px-3 py-2.5 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            {STATUSES.map((value) => (
              <option key={value || 'all'} value={value}>
                {value ? t(`status.${value}`) : t('service.allStatuses')}
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
            icon={<Sparkles className="w-8 h-8" />}
            title={t('service.emptyTitle')}
            description={t('service.emptyBody')}
            action={
              <Button onClick={() => navigate(`/dashboard/business/${businessId}/services/create`)}>
                {t('service.create')}
              </Button>
            }
          />
        }
      >
        <div className="space-y-3">
          {items.map((service) => (
            <Card key={service.service_id} padding="none" className="p-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="w-14 h-14 rounded-card bg-sky flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-6 h-6 text-primary-500" aria-hidden="true" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-navy-900 truncate">{service.service_name}</h3>
                    <Badge variant={service.status === 'active' ? 'success' : 'default'} size="sm">
                      {t(`status.${service.status}`)}
                    </Badge>
                    {service.is_bookable && (
                      <Badge variant="info" size="sm">{t('service.bookable')}</Badge>
                    )}
                  </div>
                  {service.description && (
                    <p className="text-sm text-navy-500 mt-0.5 line-clamp-2">{service.description}</p>
                  )}
                  <div className="flex flex-wrap gap-4 text-xs text-navy-500 mt-1">
                    {service.duration_minutes !== null && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('service.durationValue', { minutes: service.duration_minutes })}
                      </span>
                    )}
                    {service.capacity !== null && (
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('service.capacityValue', { count: service.capacity })}
                      </span>
                    )}
                  </div>
                </div>

                <p className="font-semibold text-navy-900">
                  {formatCurrency(service.price, service.currency)}
                </p>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    navigate(`/dashboard/business/${businessId}/services/${service.service_id}/edit`)
                  }
                >
                  <Pencil className="w-4 h-4" aria-hidden="true" />
                  {t('common.edit')}
                </Button>
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
    </div>
  );
}