import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { BusinessProfile } from '../components/business/BusinessProfile';
import { BusinessCardSkeleton } from '../components/common/Skeleton';
import { Button } from '../components/common/Button';
import { businessApi, productApi, serviceApi, reviewApi, locationApi } from '../services/api';
import type { Business } from '../types';

export function BusinessProfilePage() {
  const { businessSlug } = useParams<{ businessSlug: string }>();
  const [business, setBusiness] = useState<Business | null>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        // First find business by slug
        const bizList = await businessApi.list({ q: businessSlug || '', limit: 1 });
        const found = bizList.data.data.find((b: Business) => b.business_slug === businessSlug);

        if (!found) {
          setError('Business not found');
          return;
        }

        setBusiness(found);

        // Fetch related data
        const [prodRes, servRes, revRes, locRes] = await Promise.all([
          productApi.listForBusiness(found.business_id, { status: 'active', limit: 6 }),
          serviceApi.listForBusiness(found.business_id, { status: 'active', limit: 6 }),
          reviewApi.listForBusiness(found.business_id, { status: 'published', limit: 10 }),
          locationApi.listForBusiness(found.business_id),
        ]);

        setProducts(prodRes.data.data);
        setServices(servRes.data.data);
        setReviews(revRes.data.data);
        setLocations(locRes.data.data);
      } catch (error) {
        console.error('Failed to fetch business profile:', error);
        setError('Failed to load business profile');
      } finally {
        setLoading(false);
      }
    };

    if (businessSlug) {
      fetchData();
    }
  }, [businessSlug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-navy-50">
        <div className="animate-pulse">
          <div className="aspect-[21/9] bg-navy-200" />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="flex gap-4 mb-8">
              <div className="w-20 h-20 rounded-xl bg-navy-200" />
              <div className="flex-1 space-y-3">
                <div className="h-8 bg-navy-200 rounded w-1/4" />
                <div className="h-4 bg-navy-200 rounded w-1/3" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => <BusinessCardSkeleton key={i} />)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !business) {
    return (
      <div className="min-h-screen bg-navy-50 flex items-center justify-center">
        <div className="text-center px-4">
          <Building2 className="w-16 h-16 text-navy-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-navy-900 mb-2">Business Not Found</h1>
          <p className="text-navy-500 mb-6">{error || 'The business you\'re looking for doesn\'t exist.'}</p>
          <Link to="/explore">
            <Button>Browse Businesses</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Determine if current user is owner (would come from auth context in real app)
  const isOwner = false; // Would check auth context

  return (
    <BusinessProfile
      business={business}
      products={products}
      services={services}
      reviews={reviews}
      locations={locations}
      currentBusinessId={business.business_id}
      isOwner={isOwner}
      onEdit={() => window.location.href = `/dashboard/settings?business=${business.business_id}`}
      onContact={() => alert('Contact functionality coming soon')}
      onBook={() => alert('Booking functionality coming soon')}
      onOrder={() => alert('Ordering functionality coming soon')}
      onFavorite={() => alert('Added to favorites')}
      onRespondReview={(reviewId) => alert(`Respond to review ${reviewId}`)}
      onModerateReview={(reviewId, status) => alert(`Moderate review ${reviewId} to ${status}`)}
    />
  );
}