import { cn, formatCurrency, getStatusColor, getStatusLabel } from '../lib/utils';
import { Badge } from '../common/Badge';
import { RatingStars } from '../common/RatingStars';
import { Card } from '../common/Card';
import { MapPin, Star, CheckCircle, Clock, Tag } from 'lucide-react';
import type { Business } from '../../types';

interface BusinessCardProps {
  business: Business;
  onClick?: () => void;
  showActions?: boolean;
  compact?: boolean;
}

export function BusinessCard({ business, onClick, showActions = false, compact = false }: BusinessCardProps) {
  const isOpen = business.status === 'active';
  const hasCover = business.cover_image_url;
  const hasLogo = business.logo_url;

  return (
    <Card
      padding="none"
      className="overflow-hidden flex flex-col h-full"
      hover={!!onClick}
      onClick={onClick}
    >
      <div className="relative aspect-video w-full bg-navy-100 overflow-hidden">
        {hasCover ? (
          <img
            src={business.cover_image_url}
            alt={`${business.business_name} cover`}
            className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary-100 to-primary-200">
            <Tag className="w-12 h-12 text-primary-400" />
          </div>
        )}
        <div className="absolute top-3 right-3 flex gap-1.5">
          {business.is_verified && (
            <Badge variant="verified" size="sm" className="shadow-soft">
              <CheckCircle className="w-3 h-3 mr-1" />
              Verified
            </Badge>
          )}
          <Badge
            variant={isOpen ? 'success' : 'default'}
            size="sm"
            className="shadow-soft"
          >
            {isOpen ? 'Open' : 'Closed'}
          </Badge>
        </div>
      </div>

      <div className="flex-1 p-4 flex flex-col" style={{ minHeight: 0 }}>
        <div className="flex items-start gap-3 mb-3">
          {hasLogo ? (
            <img
              src={business.logo_url}
              alt={`${business.business_name} logo`}
              className="w-12 h-12 rounded-lg object-cover flex-shrink-0 border border-navy-200"
            />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
              <Tag className="w-6 h-6 text-primary-500" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-navy-900 truncate">{business.business_name}</h3>
            {business.category_name && (
              <p className="text-sm text-navy-500 mt-0.5">{business.category_name}</p>
            )}
          </div>
        </div>

        {!compact && (
          <>
            {business.rating_avg && business.rating_count && (
              <div className="flex items-center gap-2 mb-3">
                <RatingStars rating={parseFloat(business.rating_avg)} showValue size="sm" />
                <span className="text-sm text-navy-500">({business.rating_count} reviews)</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 text-sm text-navy-500 mb-3">
              {business.city && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {business.city}
                </span>
              )}
              {business.district && business.city && <span>·</span>}
              {business.district && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {business.district}
                </span>
              )}
            </div>

            {(business.phone || business.email) && (
              <div className="flex flex-wrap gap-2 text-sm text-navy-500 mb-3">
                {business.phone && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {business.phone}
                  </span>
                )}
                {business.email && (
                  <span className="flex items-center gap-1 truncate">
                    <Star className="w-3.5 h-3.5" />
                    {business.email}
                  </span>
                )}
              </div>
            )}
          </>
        )}

        <div className="mt-auto pt-3 border-t border-navy-100 flex items-center justify-between">
          <span className="text-sm font-medium text-navy-700">
            {business.currency && business.price_range
              ? `${business.currency} ${business.price_range}`
              : 'Contact for pricing'}
          </span>
          {showActions && onClick && (
            <button
              onClick={(e) => { e.stopPropagation(); onClick(); }}
              className="text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors"
            >
              View Details →
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}