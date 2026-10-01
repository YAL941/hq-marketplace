import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Filter, X, MapPin, Shield, Building2 } from 'lucide-react';
import { BusinessCard } from '../components/business/BusinessCard';
import { BusinessCardSkeleton } from '../components/common/Skeleton';
import { Button } from '../components/common/Button';
import { SearchBar } from '../components/common/SearchBar';
import { Badge } from '../components/common/Badge';
import { businessApi } from '../services/api';
import type { Business } from '../types';
import { cn } from '../lib/utils';

const cities = ['Mogadishu', 'Hargeisa', 'Bosaso', 'Kismayo', 'Marka', 'Baidoa', 'Galkayo', 'Berbera'];

export function ExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortBy, setSortBy] = useState('recommended');

  const search = searchParams.get('search') || '';
  const categoryId = searchParams.get('categoryId');
  const city = searchParams.get('city') || '';
  const verifiedOnly = searchParams.get('verifiedOnly') === 'true';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = 12;

  const filters = {
    search,
    categoryId: categoryId ? parseInt(categoryId) : undefined,
    city,
    verifiedOnly,
    limit,
    offset: (page - 1) * limit,
  };

  useEffect(() => {
    const fetchBusinesses = async () => {
      setLoading(true);
      try {
        const response = await businessApi.list(filters);
        setBusinesses(response.data.data);
        setTotalCount(Number(response.data.meta?.total ?? response.data.data.length));
      } catch (error) {
        console.error('Failed to fetch businesses:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchBusinesses();
  }, [search, categoryId, city, verifiedOnly, page, sortBy]);

  const updateFilter = (key: string, value: string | boolean | null) => {
    const params = new URLSearchParams(searchParams);
    if (value === '' || value === false || value === null) {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
    params.set('page', '1');
    setSearchParams(params);
  };

  const clearFilters = () => {
    setSearchParams({});
  };

  const hasActiveFilters = categoryId || city || verifiedOnly;

  return (
    <div className="min-h-screen bg-navy-50">
      {/* Page Header */}
      <div className="bg-white border-b border-navy-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-navy-900">Explore Businesses</h1>
              <p className="text-navy-500 mt-1">
                {totalCount} {totalCount === 1 ? 'business' : 'businesses'} found
                {search && ` for "${search}"`}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <SearchBar
                value={search}
                onChange={(v) => updateFilter('search', v)}
                onSearch={(v) => updateFilter('search', v)}
                placeholder="Search businesses..."
                className="flex-1"
              />
              <button
                onClick={() => setFiltersOpen(!filtersOpen)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-button border transition-colors',
                  hasActiveFilters
                    ? 'bg-primary-50 border-primary-200 text-primary-700'
                    : 'bg-white border-navy-300 text-navy-700 hover:bg-navy-50'
                )}
              >
                <Filter className="w-4 h-4" />
                <span className="hidden sm:inline">Filters</span>
                {hasActiveFilters && (
                  <Badge variant="info" size="sm">
                    {Object.keys({ categoryId, city, verifiedOnly: verifiedOnly ? 'true' : '' }).filter(k => k).length}
                  </Badge>
                )}
              </button>
              <button
                onClick={clearFilters}
                disabled={!hasActiveFilters}
                className="px-4 py-2 text-sm text-navy-600 hover:text-navy-900 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Active Filters Chips */}
          {(categoryId || city || verifiedOnly) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {categoryId && (
                <Badge variant="info" onRemove={() => updateFilter('categoryId', null)}>Category</Badge>
              )}
              {city && (
                <Badge variant="info" onRemove={() => updateFilter('city', null)}>
                  <MapPin className="w-3 h-3 mr-1" /> {city}
                </Badge>
              )}
              {verifiedOnly && (
                <Badge variant="success" onRemove={() => updateFilter('verifiedOnly', false)}>
                  <Shield className="w-3 h-3 mr-1" /> Verified Only
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Filters Sidebar / Mobile */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex gap-8">
          {/* Sidebar Filters */}
          <aside className={cn('w-full lg:w-64 flex-shrink-0', filtersOpen ? 'block' : 'hidden lg:block')}>
            <div className="bg-white rounded-card border border-navy-200 p-4 sticky top-24">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-navy-900">Filters</h3>
                <button
                  onClick={() => setFiltersOpen(false)}
                  className="lg:hidden text-navy-500 hover:text-navy-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-6">
                {/* Category Filter */}
                <div>
                  <label className="block text-sm font-medium text-navy-700 mb-2">Category</label>
                  <select
                    value={categoryId || ''}
                    onChange={(e) => updateFilter('categoryId', e.target.value || null)}
                    className="w-full px-3 py-2 border border-navy-300 rounded-button text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">All Categories</option>
                    <option value="1">Healthcare</option>
                    <option value="2">Restaurants</option>
                    <option value="3">Grocery & Retail</option>
                    <option value="4">Hotels</option>
                    <option value="5">Events & Venues</option>
                    <option value="6">Agriculture</option>
                    <option value="7">Education</option>
                    <option value="8">Transportation</option>
                    <option value="9">Professional Services</option>
                    <option value="10">Technology</option>
                    <option value="11">Beauty & Wellness</option>
                    <option value="12">Local Products</option>
                    <option value="13">Other</option>
                  </select>
                </div>

                {/* City Filter */}
                <div>
                  <label className="block text-sm font-medium text-navy-700 mb-2">City</label>
                  <select
                    value={city}
                    onChange={(e) => updateFilter('city', e.target.value || null)}
                    className="w-full px-3 py-2 border border-navy-300 rounded-button text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">All Cities</option>
                    {cities.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                {/* Verified Only */}
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={verifiedOnly}
                      onChange={(e) => updateFilter('verifiedOnly', e.target.checked)}
                      className="w-4 h-4 text-primary-600 border-navy-300 rounded focus:ring-primary-500"
                    />
                    <span className="text-sm text-navy-700">Verified businesses only</span>
                  </label>
                </div>
              </div>
            </div>
          </aside>

          {/* Results */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <label htmlFor="sort" className="text-sm text-navy-500">Sort by:</label>
                <select
                  id="sort"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="px-3 py-1.5 border border-navy-300 rounded-button text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="recommended">Recommended</option>
                  <option value="highest_rated">Highest Rated</option>
                  <option value="most_reviewed">Most Reviewed</option>
                  <option value="newest">Newest</option>
                </select>
              </div>
            </div>

            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {[...Array(6)].map((_, i) => <BusinessCardSkeleton key={i} />)}
              </div>
            ) : businesses.length > 0 ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {businesses.map((business) => (
                    <BusinessCard
                      key={business.business_id}
                      business={business}
                      onClick={() => window.location.href = `/business/${business.business_id}`}
                    />
                  ))}
                </div>

                {/* Pagination */}
                {totalCount > limit && (
                  <div className="mt-8 flex items-center justify-center gap-2">
                    <button
                      onClick={() => setSearchParams({ ...Object.fromEntries(searchParams), page: String(page - 1) })}
                      disabled={page === 1}
                      className="px-4 py-2 border border-navy-300 rounded-button text-sm hover:bg-navy-50 disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <span className="px-4 text-sm text-navy-600">
                      Page {page} of {Math.ceil(totalCount / limit)}
                    </span>
                    <button
                      onClick={() => setSearchParams({ ...Object.fromEntries(searchParams), page: String(page + 1) })}
                      disabled={page * limit >= totalCount}
                      className="px-4 py-2 border border-navy-300 rounded-button text-sm hover:bg-navy-50 disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-16">
                <Building2 className="w-16 h-16 text-navy-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-navy-900 mb-2">No businesses found</h3>
                <p className="text-navy-500 mb-6">Try adjusting your search or filters</p>
                <Button onClick={clearFilters} variant="outline">Clear Filters</Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}