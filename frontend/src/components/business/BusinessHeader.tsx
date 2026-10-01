import { Badge } from '../common/Badge';
import { MapPin, Star, Tag, CheckCircle } from 'lucide-react';
import type { Business } from '../../types';

interface BusinessHeaderProps {
  business: Business;
  currentBusinessId?: number;
  isOwner?: boolean;
  onEdit?: () => void;
  onContact?: () => void;
  onBook?: () => void;
  onOrder?: () => void;
  onFavorite?: () => void;
}

export function BusinessHeader({ business, currentBusinessId, isOwner, onEdit, onContact, onBook, onOrder, onFavorite }: BusinessHeaderProps) {
  const isOpen = business.status === 'active';
  const isCurrentBusiness = currentBusinessId === business.business_id;

  return (
    <div className="relative">
      <div className="relative aspect-[21/9] w-full bg-navy-100 overflow-hidden rounded-t-card">
        {business.cover_image_url ? (
          <img
            src={business.cover_image_url}
            alt={`${business.business_name} cover`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary-100 via-primary-50 to-primary-100">
            <Tag className="w-20 h-20 text-primary-300" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-navy-900/60 via-transparent to-transparent" />
        <div className="absolute bottom-0 start-0 end-0 p-6">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div className="flex items-start gap-4">
              {business.logo_url ? (
                <img
                  src={business.logo_url}
                  alt={`${business.business_name} logo`}
                  className="w-20 h-20 rounded-xl object-cover border-4 border-white shadow-lg flex-shrink-0"
                />
              ) : (
                <div className="w-20 h-20 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0 backdrop-blur-sm">
                  <Tag className="w-10 h-10 text-white/80" />
                </div>
              )}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="text-2xl sm:text-3xl font-bold text-white">{business.business_name}</h1>
                  {business.is_verified && (
                    <Badge variant="verified" className="shadow-lg">
                      <CheckCircle className="w-4 h-4 me-1.5" />
                      Verified
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-white/90 text-sm">
                  {business.category_name && (
                    <span className="flex items-center gap-1 bg-white/10 px-3 py-1 rounded-full backdrop-blur-sm">
                      <Tag className="w-4 h-4" />
                      {business.category_name}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    {business.city}{business.district && `, ${business.district}`}
                  </span>
                  <span className="flex items-center gap-1">
                    <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                    {business.average_rating ? `${parseFloat(business.average_rating).toFixed(1)}` : '—'}
                    {business.review_count && ` (${business.review_count})`}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
              <Badge
                variant={isOpen ? 'success' : 'default'}
                size="md"
                className="text-sm px-4 py-2"
              >
                {isOpen ? (
                  <>
                    <CheckCircle className="w-4 h-4 me-1.5" />
                    Open Now
                  </>
                ) : (
                  'Closed'
                )}
              </Badge>

              {isOwner && isCurrentBusiness && onEdit && (
                <button
                  onClick={onEdit}
                  className="px-4 py-2 bg-white/10 text-white rounded-button hover:bg-white/20 transition-colors backdrop-blur-sm border border-white/20"
                >
                  Edit Profile
                </button>
              )}

              {!isOwner && !isCurrentBusiness && (
                <div className="flex gap-2">
                  {onContact && (
                    <button
                      onClick={onContact}
                      className="px-4 py-2 bg-primary-500 text-white rounded-button hover:bg-primary-600 transition-colors"
                    >
                      Contact
                    </button>
                  )}
                  {onBook && (
                    <button
                      onClick={onBook}
                      className="px-4 py-2 bg-success-500 text-white rounded-button hover:bg-success-600 transition-colors"
                    >
                      Book Appointment
                    </button>
                  )}
                  {onOrder && (
                    <button
                      onClick={onOrder}
                      className="px-4 py-2 bg-navy-900 text-white rounded-button hover:bg-navy-800 transition-colors"
                    >
                      Order Now
                    </button>
                  )}
                  {onFavorite && (
                    <button
                      onClick={onFavorite}
                      className="px-4 py-2 bg-white/10 text-white rounded-button hover:bg-white/20 transition-colors backdrop-blur-sm border border-white/20"
                      aria-label="Add to favorites"
                    >
                      <Star className="w-5 h-5 fill-current" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}