import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { RatingStars } from '../common/RatingStars';
import type { Business } from '../../types';
import { BusinessHeader } from './BusinessHeader';
import { BusinessContact } from './BusinessContact';
import { ProductCard } from './ProductCard';
import { ServiceCard } from './ServiceCard';
import { ReviewCard } from './ReviewCard';
import { LocationCard } from './LocationCard';

interface BusinessProfileProps {
  business: Business;
  products?: any[];
  services?: any[];
  reviews?: any[];
  locations?: any[];
  currentBusinessId?: number;
  isOwner?: boolean;
  onEdit?: () => void;
  onContact?: () => void;
  onBook?: () => void;
  onOrder?: () => void;
  onFavorite?: () => void;
  onRespondReview?: (reviewId: number) => void;
  onModerateReview?: (reviewId: number, status: 'published' | 'hidden') => void;
}

export function BusinessProfile({
  business,
  products = [],
  services = [],
  reviews = [],
  locations = [],
  currentBusinessId,
  isOwner = false,
  onEdit,
  onContact,
  onBook,
  onOrder,
  onFavorite,
  onRespondReview,
  onModerateReview,
}: BusinessProfileProps) {
    return (
    <div className="min-h-screen bg-navy-50">
      <BusinessHeader
        business={business}
        currentBusinessId={currentBusinessId}
        isOwner={isOwner}
        onEdit={onEdit}
        onContact={onContact}
        onBook={onBook}
        onOrder={onOrder}
        onFavorite={onFavorite}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            {business.business_description && (
              <Card>
                <h3 className="text-lg font-semibold text-navy-900 mb-4">About</h3>
                <p className="text-navy-600 whitespace-pre-wrap">{business.business_description}</p>
              </Card>
            )}

            {(business.phone || business.email || business.website || business.address || business.city) && (
              <BusinessContact business={business} />
            )}

            {(products.length > 0 || services.length > 0) && (
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-navy-900">Products & Services</h3>
                  <div className="flex gap-2">
                    {products.length > 0 && <Badge variant="info" size="sm">{products.length} Products</Badge>}
                    {services.length > 0 && <Badge variant="info" size="sm">{services.length} Services</Badge>}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {products.map((product) => (
                    <ProductCard key={product.product_id} product={product} showBusiness />
                  ))}
                  {services.map((service) => (
                    <ServiceCard key={service.service_id} service={service} showBusiness />
                  ))}
                </div>
                {(products.length === 0 && services.length === 0) && (
                  <div className="text-center py-8 text-navy-500">No products or services available</div>
                )}
              </Card>
            )}

            {reviews.length > 0 && (
              <Card>
                <h3 className="text-lg font-semibold text-navy-900 mb-4">Reviews</h3>
                <div className="space-y-4">
                  {reviews.map((review) => (
                    <ReviewCard
                      key={review.review_id}
                      review={review}
                      isBusinessView={isOwner}
                      onRespond={onRespondReview}
                      onModerate={onModerateReview}
                    />
                  ))}
                </div>
              </Card>
            )}

            {locations.length > 0 && (
              <Card>
                <h3 className="text-lg font-semibold text-navy-900 mb-4">Locations</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {locations.map((location) => (
                    <LocationCard key={location.location_id} location={location} showBusiness />
                  ))}
                </div>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <Card>
              <h3 className="text-lg font-semibold text-navy-900 mb-4">Business Info</h3>
              <dl className="space-y-4 text-sm">
                <div>
                  <dt className="text-navy-500">Status</dt>
                  <dd className="mt-1">
                    <Badge
                      variant={
                        business.status === 'active' ? 'success' :
                        business.status === 'pending' ? 'warning' :
                        business.status === 'suspended' ? 'error' :
                        business.status === 'closed' ? 'default' : 'default'
                      }
                    >
                      {business.status}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-navy-500">Verification</dt>
                  <dd className="mt-1">
                    <Badge variant={business.is_verified ? 'success' : 'warning'}>
                      {business.verification_status}
                    </Badge>
                  </dd>
                </div>
                {business.business_category_id && business.category_name && (
                  <div>
                    <dt className="text-navy-500">Category</dt>
                    <dd className="mt-1 text-navy-900">{business.category_name}</dd>
                  </div>
                )}
                {business.created_at && (
                  <div>
                    <dt className="text-navy-500">Member Since</dt>
                    <dd className="mt-1 text-navy-900">
                      {new Date(business.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
                    </dd>
                  </div>
                )}
              </dl>
            </Card>

            {business.average_rating && business.review_count && (
              <Card>
                <h3 className="text-lg font-semibold text-navy-900 mb-4">Rating</h3>
                <div className="text-center">
                  <div className="text-4xl font-bold text-navy-900 mb-1">{parseFloat(business.average_rating).toFixed(1)}</div>
                  <RatingStars rating={parseFloat(business.average_rating)} size="lg" className="mx-auto mb-2" />
                  <p className="text-navy-500 text-sm">{business.review_count} reviews</p>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}