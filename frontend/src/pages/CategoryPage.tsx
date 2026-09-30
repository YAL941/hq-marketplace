import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MapPin, Star, Building2, ArrowRight } from 'lucide-react';
import { BusinessCard } from '../components/business/BusinessCard';
import { CategoryCard } from '../components/business/CategoryCard';
import { BusinessCardSkeleton, CategoryCardSkeleton } from '../components/common/Skeleton';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { businessApi } from '../services/api';
import type { Business, BusinessCategory } from '../types';
import { cn } from '../lib/utils';

export function CategoryPage() {
  const { category: catSlug } = useParams<{ category: string }>();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [category, setCategory] = useState<BusinessCategory | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const limit = 12;

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Find category ID from slug
        const categorySlug = catSlug;
        let catId: number | undefined;

        // Map slugs to IDs
        const slugToId: Record<string, number> = {
          'healthcare': 1,
          'restaurants': 2,
          'grocery-retail': 3,
          'hotels': 4,
          'events-venues': 5,
          'agriculture': 6,
          'education': 7,
          'transportation': 8,
          'professional-services': 9,
          'technology': 10,
          'beauty-wellness': 11,
          'local-products': 12,
          'other': 13,
        };
        catId = slugToId[catSlug];

        const [bizRes] = await Promise.all([
          businessApi.list({ categoryId: catId, limit, offset: (page - 1) * limit, verifiedOnly: true }),
        ]);
        setBusinesses(bizRes.data.data);

        if (catId) {
          setCategory({
            category_id: catId,
            category_name: catSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
            category_slug: catSlug,
            business_count: bizRes.data.meta?.count || 0,
          });
        }
      } catch (error) {
        console.error('Failed to fetch category data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [catSlug, page]);

  if (loading) {
    return (
      <div className="min-h-screen bg-navy-50">
        <div className="bg-white border-b border-navy-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="animate-pulse space-y-4">
              <div className="h-8 bg-navy-200 rounded w-1/4"></div>
              <div className="h-4 bg-navy-200 rounded w-1/3"></div>
            </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {[...Array(6)].map((_, i) => <CategoryCardSkeleton key={i} />)}
          </div>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => <BusinessCardSkeleton key={i} />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy-50">
      {/* Category Header */}
      <div className="bg-gradient-to-b from-primary-600 to-primary-700 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <Badge variant="info" className="mb-3">{category?.category_name} Businesses</Badge>
              <h1 className="text-3xl font-bold mb-2">{category?.category_name}</h1>
              <p className="text-primary-100">
                {category?.business_count || businesses.length} {category?.business_count === 1 ? 'business' : 'businesses'} in this category
              </p>
            </div>
            <Link to="/categories" className="flex items-center gap-1 text-primary-100 hover:text-white font-medium">
              <ArrowRight className="w-4 h-4" /> All Categories
            </Link>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 -mt-6 relative z-10">
        <div className="bg-white rounded-t-card shadow-card overflow-hidden">
          <div className="p-4 border-b border-navy-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-navy-600">
              Showing {businesses.length} of {category?.business_count || 0} businesses
            </p>
            <div className="flex items-center gap-2">
              <label htmlFor="sort" className="text-sm text-navy-500">Sort:</label>
              <select
                id="sort"
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
              {[...Array(6)].map((_, i) => <BusinessCardSkeleton key={i} />)}
            </div>
          ) : businesses.length > 0 ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
                {businesses.map((business) => (
                  <BusinessCard
                    key={business.business_id}
                    business={business}
                    onClick={() => window.location.href = `/business/${business.business_id}`}
                  />
                ))}
              </div>

              {/* Pagination */}
              {category && category.business_count > limit && (
                <div className="px-6 py-4 border-t border-navy-200 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-4 py-2 border border-navy-300 rounded-button text-sm hover:bg-navy-50 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="px-4 text-sm text-navy-600">
                    Page {page} of {Math.ceil((category?.business_count || 0) / limit)}
                  </span>
                  <button
                    onClick={() => setPage(p => p + 1)}
                    disabled={page * limit >= (category?.business_count || 0)}
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
              <h3 className="text-lg font-medium text-navy-900 mb-2">No businesses in this category</h3>
              <p className="text-navy-500 mb-6">Be the first to add a business in {category?.category_name}</p>
              <Link to="/businesses/register">
                <Button>Register a Business</Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}