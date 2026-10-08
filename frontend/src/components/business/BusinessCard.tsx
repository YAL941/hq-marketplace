import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../common/Badge';
import { RatingStars } from '../common/RatingStars';
import { Card } from '../common/Card';
import { SmartImage } from '../common/SmartImage';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Heart, MapPin, Tag } from 'lucide-react';
import { CategoryIcon } from '../common/CategoryIcon';
import { Toast } from '../common/Toast';
import { useToasts } from '../common/useToasts';
import { useAuth } from '../../context/useAuth';
import { useFavorites } from '../../context/useFavorites';
import type { PublicBusinessCard } from '../../types';

interface BusinessCardProps {
  business: PublicBusinessCard;
  compact?: boolean;
}

/**
 * Renders one entry from the public directory.
 *
 * The card deliberately shows no trust badge. The public routes do not publish
 * verification state, and `is_featured` is an editorial pick, not a check that
 * anybody performed. `is_open_now` is the only status-like signal available,
 * and it is optional, so nothing is shown when the server omits it.
 */
export function BusinessCard({ business, compact = false }: BusinessCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const { ids, isLoading: favoritesLoading, toggle } = useFavorites();
  const { toasts, show, dismiss } = useToasts();
  const [savingFavorite, setSavingFavorite] = useState(false);
  const isFavorite = ids.has(business.business_id);
  const hasRating = business.average_rating !== null && business.review_count > 0;
  // Routing is by slug everywhere: it is stable across a rename and it is what
  // the public URL is expected to look like.
  const href = `/business/${business.business_slug}`;

  const handleFavorite = async () => {
    if (!isAuthenticated) {
      const next = `${location.pathname}${location.search}`;
      navigate(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    setSavingFavorite(true);
    try {
      await toggle(business);
    } catch {
      show(t('favorites.actionError'), 'error');
    } finally {
      setSavingFavorite(false);
    }
  };

  return (
    <Card padding="none" className="overflow-hidden flex flex-col h-full">
      <div className="relative aspect-video w-full bg-navy-100 overflow-hidden">
        <Link to={href} className="absolute inset-0 block group" tabIndex={-1} aria-hidden="true">
          {/*
            16:9 is the frame's own ratio, so these intrinsic dimensions only
            reserve the space until the bytes land. A card is not the first thing
            on the page, so both of these stay lazy.
          */}
          <SmartImage
            value={business.cover_image_url}
            width={640}
            height={360}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            fallback={
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary-100 to-primary-200">
                <Tag className="w-12 h-12 text-primary-400" />
              </div>
            }
          />
        </Link>
        <div className="absolute top-3 end-3 flex gap-1.5 pointer-events-none">
          {business.is_featured && (
            <Badge variant="info" size="sm" className="shadow-soft">
              {t('business.featured')}
            </Badge>
          )}
          {business.is_open_now !== undefined && (
            <Badge
              variant={business.is_open_now ? 'success' : 'default'}
              size="sm"
              className="shadow-soft"
            >
              {business.is_open_now ? t('business.openNow') : t('business.closedNow')}
            </Badge>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleFavorite()}
          disabled={savingFavorite || (isAuthenticated && favoritesLoading)}
          aria-label={t(isFavorite ? 'favorites.remove' : 'favorites.save', { name: business.business_name })}
          aria-pressed={isFavorite}
          className="absolute top-3 start-3 z-10 rounded-full bg-white/95 p-2 text-primary-600 shadow-soft transition-colors hover:bg-white disabled:opacity-60"
        >
          <Heart className="h-5 w-5" fill={isFavorite ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 p-4 flex flex-col" style={{ minHeight: 0 }}>
        <div className="flex items-start gap-3 mb-3">
          {/*
            The business name is on screen right beside this, so the logo is
            decorative: an empty alt is the correct thing, not a missing one.
          */}
          <SmartImage
            value={business.logo_url}
            width={48}
            height={48}
            className="w-12 h-12 rounded-sg object-cover flex-shrink-0 border border-navy-200"
            fallback={
              <div className="w-12 h-12 rounded-sg bg-primary-100 flex items-center justify-center flex-shrink-0">
                <Tag className="w-6 h-6 text-primary-500" />
              </div>
            }
          />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-navy-900 truncate">
              <Link to={href} className="hover:text-primary-600 transition-colors">
                {business.business_name}
              </Link>
            </h3>
            {business.category_name && (
              <p className="text-sm text-navy-500 mt-1 flex items-center gap-1.5">
                {business.category_slug && (
                  <CategoryIcon slug={business.category_slug} size="inline" />
                )}
                {business.category_name}
              </p>
            )}
          </div>
        </div>

        {hasRating && !compact && (
          <div className="flex items-center gap-2 mb-3">
            <RatingStars rating={parseFloat(business.average_rating ?? '0')} showValue size="sm" />
            <span className="text-sm text-navy-500">
              ({t('business.reviewCount', { count: business.review_count })})
            </span>
          </div>
        )}

        {!compact && (business.city || business.district) && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-navy-500 mb-3">
            {business.city && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {business.city}
              </span>
            )}
            {business.district && business.city && <span aria-hidden="true">·</span>}
            {business.district && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {business.district}
              </span>
            )}
          </div>
        )}

        <div className="mt-auto pt-3 border-t border-navy-100">
          <Link
            to={href}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors"
          >
            {t('business.viewDetails')}
            <ArrowRight className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
          </Link>
        </div>
      </div>
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onRemove={() => dismiss(toast.id)} />
      ))}
    </Card>
  );
}
