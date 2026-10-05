import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import {
  MapPin, Phone, Globe, Clock, Star, MessageCircle, Tag, Building2, ArrowLeft, ExternalLink,
} from 'lucide-react';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { RatingStars } from '../components/common/RatingStars';
import { BusinessCardSkeleton } from '../components/common/Skeleton';
import { ErrorState } from '../components/common/ErrorState';
import { SmartImage } from '../components/common/SmartImage';
import { businessApi } from '../services/api';
import { cn, formatDate, formatRelativeTime } from '../lib/utils';
import type { Location, PublicBusinessProfile, PublicReview } from '../types';

/** Postgres `day_of_week`: 0 = Sunday. Indexed from Sunday to match. */
const WEEKDAYS = [
  'common.daySunday',
  'common.dayMonday',
  'common.dayTuesday',
  'common.dayWednesday',
  'common.dayThursday',
  'common.dayFriday',
  'common.daySaturday',
] as const;

/**
 * wa.me wants the number in international form with no `+` and no separators.
 * The column is already digits with an optional leading plus, so stripping the
 * plus is the whole conversion. If it ever stops matching, the button is not
 * rendered rather than linking to a broken URL.
 */
function whatsappUrl(number: string): string | null {
  const digits = number.replace(/[^\d]/g, '');
  return /^\d{7,15}$/.test(digits) ? `https://wa.me/${digits}` : null;
}

/** A local Somali number needs a country code to be dialable from a link. */
function telHref(phone: string): string | null {
  const trimmed = phone.trim();
  return trimmed.length >= 7 ? `tel:${trimmed.replace(/\s+/g, '')}` : null;
}

export function BusinessProfilePage() {
  const { t } = useTranslation();
  const { businessSlug } = useParams<{ businessSlug: string }>();

  const [business, setBusiness] = useState<PublicBusinessProfile | null>(null);
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);

  /**
   * The profile comes straight from GET /businesses/slug/:businessSlug, and the
   * numeric id it returns is what the reviews and locations endpoints take.
   *
   * A 404 here means either "no such slug" or "not publicly visible", and the
   * server answers both with the same body on purpose, so the page shows one
   * not-found state for both. Any other failure is a real error.
   */
  const load = useCallback(async () => {
    if (!businessSlug) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotFound(false);
    setError(false);
    try {
      const profileRes = await businessApi.getPublicBySlug(businessSlug);
      const profile = profileRes.data.data;

      const [reviewsRes, locationsRes] = await Promise.all([
        businessApi.listPublicReviews(profile.business_id, 1, 5),
        businessApi.listPublicLocations(profile.business_id),
      ]);

      setBusiness(profile);
      setReviews(reviewsRes.data.data);
      setLocations(locationsRes.data.data);
    } catch (caught) {
      if (axios.isAxiosError(caught) && caught.response?.status === 404) {
        setNotFound(true);
      } else {
        setError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [businessSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-screen bg-navy-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(3)].map((_, i) => <BusinessCardSkeleton key={i} />)}
          </div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-navy-50 flex items-center justify-center px-4">
        <div className="text-center">
          <Building2 className="w-16 h-16 text-navy-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-navy-900 mb-2">
            {t('business.notFoundTitle')}
          </h1>
          <p className="text-navy-500 mb-6">{t('business.notFoundDescription')}</p>
          <Link to="/explore">
            <Button variant="outline">
              <ArrowLeft className="w-4 h-4 me-2 rtl:rotate-180" />
              {t('category.backToExplore')}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (error || !business) {
    return (
      <div className="min-h-screen bg-navy-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <ErrorState onRetry={() => void load()} />
        </div>
      </div>
    );
  }

  const hasRating = business.average_rating !== null && business.review_count > 0;
  const call = business.phone ? telHref(business.phone) : null;
  const whatsapp = business.whatsapp_number ? whatsappUrl(business.whatsapp_number) : null;
  const hasContact = !!(call || whatsapp || business.website);
  const totalRated = Object.values(business.rating_distribution).reduce((a, b) => a + b, 0);

  return (
    <div className="min-h-screen bg-navy-50">
      <div className="bg-white border-b border-navy-200">
        <div className="relative h-48 sm:h-64 bg-navy-100 overflow-hidden">
          {/*
            The one image in the app that is not lazy: it is the first thing on
            the page, and deferring it would trade the visitor's first impression
            for bandwidth they did not ask to save. The logo below is eager for
            the same reason — it overlaps this one, so both are in the first
            viewport.
          */}
          <SmartImage
            value={business.cover_image_url}
            width={1200}
            height={400}
            eager
            className="w-full h-full object-cover"
            fallback={
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary-100 to-primary-200">
                <Tag className="w-16 h-16 text-primary-300" />
              </div>
            }
          />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-12 pb-6">
            <div className="w-24 h-24 rounded-2xl bg-white border-4 border-white shadow-card flex items-center justify-center overflow-hidden flex-shrink-0">
              {/* Beside the `<h1>` with the same name, so decorative. */}
              <SmartImage
                value={business.logo_url}
                width={96}
                height={96}
                eager
                className="w-full h-full object-cover"
                fallback={<Tag className="w-10 h-10 text-primary-300" />}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-navy-900">{business.business_name}</h1>
                {business.is_featured && (
                  <Badge variant="info" size="sm">{t('business.featured')}</Badge>
                )}
                {business.is_open_now !== undefined && (
                  <Badge variant={business.is_open_now ? 'success' : 'default'} size="sm">
                    {business.is_open_now ? t('business.openNow') : t('business.closedNow')}
                  </Badge>
                )}
              </div>
              {business.category_name && (
                <p className="text-navy-500 mt-0.5">{business.category_name}</p>
              )}
              {hasRating && (
                <div className="flex items-center gap-2 mt-1">
                  <RatingStars rating={parseFloat(business.average_rating ?? '0')} showValue size="sm" />
                  <span className="text-sm text-navy-500">
                    {t('business.reviewCount', { count: business.review_count })}
                  </span>
                </div>
              )}
            </div>

            {/*
              Each button is rendered only when the underlying data exists.
              A disabled "Call" is worse than no button: it advertises a phone
              number the business never published.
            */}
            {hasContact && (
              <div className="flex flex-wrap gap-2">
                {call && (
                  <a href={call} className="inline-flex">
                    <Button variant="outline">
                      <Phone className="w-4 h-4 me-2" />
                      {t('business.callBusiness')}
                    </Button>
                  </a>
                )}
                {whatsapp && (
                  <a
                    href={whatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex"
                  >
                    <Button>
                      <MessageCircle className="w-4 h-4 me-2" />
                      {t('business.whatsapp')}
                    </Button>
                  </a>
                )}
                {business.website && (
                  <a
                    href={business.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex"
                  >
                    <Button variant="ghost">
                      <Globe className="w-4 h-4 me-2" />
                      {t('business.website')}
                      <ExternalLink className="w-3 h-3 ms-1" />
                    </Button>
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <h2 className="text-lg font-semibold text-navy-900 mb-3">{t('business.about')}</h2>
              <p className="text-navy-600 whitespace-pre-line">
                {business.business_description || t('business.noDescription')}
              </p>
            </Card>

            <Card>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-navy-900">{t('business.reviewsTitle')}</h2>
                <span className="text-sm text-navy-500">
                  {t('business.reviewCount', { count: business.review_count })}
                </span>
              </div>

              {reviews.length === 0 ? (
                <p className="text-navy-500">{t('business.noReviews')}</p>
              ) : (
                <ul className="space-y-6">
                  {reviews.map((review) => (
                    <li key={review.review_id} className="border-b border-navy-100 pb-6 last:border-0 last:pb-0">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-600">
                            <Star className="w-4 h-4" />
                          </div>
                          <div>
                            {/* The reviewer's account is never published, only a display name. */}
                            <p className="font-medium text-navy-900">{review.author_name}</p>
                            <p className="text-xs text-navy-500">
                              {formatRelativeTime(review.created_at)}
                            </p>
                          </div>
                        </div>
                        <RatingStars rating={review.rating} size="sm" />
                      </div>
                      {review.review_text && (
                        <p className="text-navy-700 text-start">{review.review_text}</p>
                      )}
                      {review.business_response && (
                        <div className="mt-3 ps-4 border-s-2 border-primary-200">
                          <p className="text-xs font-medium text-primary-700 mb-1">
                            {t('business.businessResponse')}
                            {review.responded_at && (
                              <span className="text-navy-400 font-normal ms-2">
                                {formatDate(review.responded_at)}
                              </span>
                            )}
                          </p>
                          <p className="text-navy-600 text-sm">{review.business_response}</p>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            {hasRating && totalRated > 0 && (
              <Card>
                <h2 className="text-lg font-semibold text-navy-900 mb-4">
                  {t('business.ratingsBreakdown')}
                </h2>
                <ul className="space-y-2">
                  {(['5', '4', '3', '2', '1'] as const).map((star) => {
                    const count = business.rating_distribution[star];
                    const percent = totalRated > 0 ? Math.round((count / totalRated) * 100) : 0;
                    return (
                      <li key={star} className="flex items-center gap-2 text-sm">
                        <span className="w-8 text-navy-600 flex items-center gap-0.5">
                          {star} <Star className="w-3 h-3 fill-current" />
                        </span>
                        <div
                          className="flex-1 h-2 bg-navy-100 rounded-full overflow-hidden"
                          role="img"
                          aria-label={t('business.ratingsBreakdownAria', { count, percent })}
                        >
                          <div className="h-full bg-primary-500 rounded-full" style={{ width: `${percent}%` }} />
                        </div>
                        <span className="w-10 text-end text-navy-500">{count}</span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}

            <Card>
              <h2 className="text-lg font-semibold text-navy-900 mb-4">
                {t('business.openingHours')}
              </h2>
              <ul className="space-y-1.5 text-sm">
                {business.opening_hours.map((day) => (
                  <li key={day.day_of_week} className="flex items-center justify-between gap-3">
                    <span className="text-navy-600">{t(WEEKDAYS[day.day_of_week] ?? WEEKDAYS[0])}</span>
                    <span
                      className={cn(
                        'flex items-center gap-1',
                        day.is_closed ? 'text-error-600' : 'text-navy-900'
                      )}
                    >
                      {!day.is_closed && <Clock className="w-3.5 h-3.5" aria-hidden="true" />}
                      {day.is_closed || !day.opens_at
                        ? t('business.closedDay')
                        : `${day.opens_at} – ${day.closes_at ?? ''}`}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            {locations.length > 0 && (
              <Card>
                <h2 className="text-lg font-semibold text-navy-900 mb-4">
                  {t('business.locationsTitle')}
                </h2>
                <ul className="space-y-4">
                  {locations.map((location) => (
                    <li key={location.location_id} className="text-sm">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-navy-400 flex-shrink-0" />
                        <span className="font-medium text-navy-900">{location.location_name}</span>
                        {location.is_primary && (
                          <Badge variant="info" size="sm">{t('business.primaryLocation')}</Badge>
                        )}
                      </div>
                      {location.address && (
                        <p className="text-navy-500 mt-1 ps-6">
                          {[location.address, location.district, location.city]
                            .filter(Boolean)
                            .join(', ')}
                        </p>
                      )}
                      {location.phone && (
                        <a
                          href={telHref(location.phone) ?? '#'}
                          className="text-primary-600 hover:text-primary-700 mt-1 ps-6 flex items-center gap-1"
                        >
                          <Phone className="w-3.5 h-3.5" />
                          {location.phone}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
