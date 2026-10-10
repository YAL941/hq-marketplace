import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import {
  MapPin, Phone, Globe, Clock, Star, MessageCircle, Tag, Building2, ArrowLeft, ExternalLink, ShoppingBag, X,
} from 'lucide-react';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { RatingStars } from '../components/common/RatingStars';
import { BusinessCardSkeleton } from '../components/common/Skeleton';
import { ErrorState } from '../components/common/ErrorState';
import { SmartImage } from '../components/common/SmartImage';
import { ReportBusinessLink } from '../components/business/ReportBusinessLink';
import { ProductFeedback } from '../components/business/ProductFeedback';
import { businessApi, orderApi, productApi, reviewApi, serviceApi } from '../services/api';
import { useAuth } from '../context/useAuth';
import { safeExternalUrl } from '../lib/safeUrl';
import { cn, formatDate, formatRelativeTime } from '../lib/utils';
import type { Location, Product, PublicBusinessProfile, PublicReview, Service } from '../types';

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
  const digits = phone.replace(/\D/g, '');
  return /^\d{7,15}$/.test(digits) ? `tel:${digits}` : null;
}

export function BusinessProfilePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { businessSlug } = useParams<{ businessSlug: string }>();
  const [searchParams] = useSearchParams();
  const { isAuthenticated } = useAuth();

  const [business, setBusiness] = useState<PublicBusinessProfile | null>(null);
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productDetails, setProductDetails] = useState<Product | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [catalogueError, setCatalogueError] = useState(false);
  const [reviewEligibility, setReviewEligibility] = useState<{ eligible: boolean; order_id: string | null; already_reviewed: boolean; is_member: boolean } | null>(null);
  const [reviewEligibilityError, setReviewEligibilityError] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [selectedItem, setSelectedItem] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [productQuantity, setProductQuantity] = useState(1);
  const [scheduledFor, setScheduledFor] = useState('');
  const [orderError, setOrderError] = useState('');
  const [orderSubmitted, setOrderSubmitted] = useState(false);
  const [orderLoading, setOrderLoading] = useState(false);
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
      setCatalogueError(false);
      try {
        const [productRes, serviceRes] = await Promise.all([
          productApi.listPublic({ businessId: Number(profile.business_id), status: 'active', limit: 50 }),
          serviceApi.listPublic({ businessId: Number(profile.business_id), status: 'active', limit: 50 }),
        ]);
        setProducts(productRes.data.data);
        setServices(serviceRes.data.data);
      } catch {
        setCatalogueError(true);
        setProducts([]);
        setServices([]);
      }
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

  useEffect(() => {
    const requestedProductId = searchParams.get('product');
    if (!requestedProductId || products.length === 0) return;
    const requestedProduct = products.find((product) => product.product_id === requestedProductId);
    if (!requestedProduct) return;

    setProductQuantity(1);
    setProductDetails(requestedProduct);
    const params = new URLSearchParams(searchParams);
    params.delete('product');
    const remainingSearch = params.toString();
    const targetHash = window.location.hash;
    navigate(
      { search: remainingSearch ? `?${remainingSearch}` : '', hash: targetHash },
      { replace: true },
    );
  }, [navigate, products, searchParams]);

  useEffect(() => {
    if (!productDetails || window.location.hash !== '#product-feedback') return;
    document.getElementById('product-feedback')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [productDetails]);

  useEffect(() => {
    if (!isAuthenticated || !business) {
      setReviewEligibility(null);
      setReviewEligibilityError(false);
      return;
    }
    let cancelled = false;
    void reviewApi.eligibility(business.business_id).then((response) => {
      if (!cancelled) {
        setReviewEligibility(response.data.data);
        setReviewEligibilityError(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setReviewEligibility(null);
        setReviewEligibilityError(true);
      }
    });
    return () => { cancelled = true; };
  }, [business, isAuthenticated]);

  useEffect(() => {
    if (!productDetails) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProductDetails(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [productDetails]);

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
  const website = safeExternalUrl(business.website);
  const hasContact = !!(call || whatsapp || website);
  const totalRated = Object.values(business.rating_distribution).reduce((a, b) => a + b, 0);
  const orderableProducts = products.filter((product) =>
    !product.is_stock_tracked || product.stock_quantity > 0,
  );
  const bookableServices = services.filter((service) => service.is_bookable);
  const selectedProduct = selectedItem.startsWith('product:')
    ? orderableProducts.find((product) => product.product_id === selectedItem.slice(8))
    : undefined;
  const selectedService = selectedItem.startsWith('service:')
    ? bookableServices.find((service) => service.service_id === selectedItem.slice(8))
    : undefined;

  const placeOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedItem) return;
    setOrderError('');
    setOrderLoading(true);
    try {
      const item = selectedItem.split(':');
      const parsedScheduledFor = scheduledFor ? new Date(scheduledFor).toISOString() : null;
      await orderApi.create({
        businessId: Number(business.business_id),
        items: [{
          ...(item[0] === 'product' ? { productId: Number(item[1]) } : { serviceId: Number(item[1]) }),
          quantity,
        }],
        ...(parsedScheduledFor ? { scheduledFor: parsedScheduledFor } : {}),
      });
      setOrderSubmitted(true);
      setSelectedItem('');
      setScheduledFor('');
      setQuantity(1);
    } catch {
      setOrderError(t('business.orderError'));
    } finally {
      setOrderLoading(false);
    }
  };

  const placeProductOrder = async () => {
    if (!productDetails || !isAuthenticated) return;
    setOrderError('');
    setOrderSubmitted(false);
    setOrderLoading(true);
    try {
      await orderApi.create({
        businessId: Number(business.business_id),
        items: [{ productId: Number(productDetails.product_id), quantity: productQuantity }],
      });
      setOrderSubmitted(true);
      setProductQuantity(1);
    } catch {
      setOrderError(t('business.orderError'));
    } finally {
      setOrderLoading(false);
    }
  };

  const submitReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reviewEligibility?.order_id || reviewRating < 1) return;
    setReviewError('');
    try {
      await reviewApi.create({
        businessId: Number(business.business_id),
        orderId: Number(reviewEligibility.order_id),
        rating: reviewRating,
        reviewText: reviewText.trim(),
      });
      setReviewSubmitted(true);
      setReviewEligibility({ eligible: false, order_id: null, already_reviewed: true, is_member: false });
    } catch {
      setReviewError(t('business.reviewSubmitError'));
    }
  };

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
                    rel="noopener noreferrer nofollow ugc"
                    className="inline-flex"
                  >
                    <Button>
                      <MessageCircle className="w-4 h-4 me-2" />
                      {t('business.whatsapp')}
                    </Button>
                  </a>
                )}
                {website && (
                  <a
                    href={website}
                    target="_blank"
                    rel="noopener noreferrer nofollow ugc"
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
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
              <Link
                to="/safety"
                className="text-sm text-primary-700 underline underline-offset-2 hover:text-primary-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                {t('safety.report.safetyTipsLink')}
              </Link>
              <ReportBusinessLink businessName={business.business_name} />
            </div>
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

            {(products.length > 0 || services.length > 0 || catalogueError) && (
              <Card>
                <div className="mb-5 flex items-center gap-2">
                  <ShoppingBag className="h-5 w-5 text-navy-600" aria-hidden="true" />
                  <h2 className="text-lg font-semibold text-navy-900">{t('business.catalogueTitle')}</h2>
                </div>
                {catalogueError && (
                  <p role="alert" className="mb-4 rounded-xl bg-error-50 p-3 text-sm text-error-600">
                    {t('business.catalogueError')}
                  </p>
                )}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {products.map((product) => (
                    <article key={product.product_id} className="overflow-hidden rounded-xl border border-navy-100 bg-white">
                      <button
                        type="button"
                        onClick={() => {
                          setProductQuantity(1);
                          setOrderError('');
                          setOrderSubmitted(false);
                          setProductDetails(product);
                        }}
                        aria-label={t('business.openProductDetails', { name: product.product_name })}
                        className="w-full text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                      >
                        {product.image_url ? (
                          <SmartImage
                            value={product.image_url}
                            width={640}
                            height={360}
                            className="h-40 w-full object-cover"
                            fallback={<div className="h-40 bg-navy-50" />}
                          />
                        ) : (
                          <div className="flex h-40 items-center justify-center bg-navy-50">
                            <ShoppingBag className="h-10 w-10 text-navy-300" aria-hidden="true" />
                          </div>
                        )}
                        <div className="p-4">
                          <h3 className="font-semibold text-navy-900">{product.product_name}</h3>
                          {product.description && <p className="mt-1 line-clamp-2 text-sm text-navy-500">{product.description}</p>}
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                            <p className="font-semibold text-navy-800">
                              {product.discount_price ?? product.price} {product.currency}
                            </p>
                            <span className="text-sm font-medium text-primary-700">{t('business.viewProduct')}</span>
                          </div>
                        </div>
                      </button>
                    </article>
                  ))}
                  {services.map((service) => (
                    <article key={service.service_id} className="overflow-hidden rounded-xl border border-navy-100 bg-white">
                      <div className="p-4">
                        <h3 className="font-semibold text-navy-900">{service.service_name}</h3>
                        {service.description && <p className="mt-1 line-clamp-2 text-sm text-navy-500">{service.description}</p>}
                        <p className="mt-3 font-semibold text-navy-800">
                          {service.price} {service.currency}
                          {service.duration_minutes ? ` · ${service.duration_minutes} ${t('business.minutes')}` : ''}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              </Card>
            )}

            {(orderableProducts.length > 0 || bookableServices.length > 0) && (
              <Card>
                <h2 className="mb-2 text-lg font-semibold text-navy-900">{t('business.orderTitle')}</h2>
                <p className="mb-4 text-sm text-navy-500">{t('business.orderDescription')}</p>
                {!isAuthenticated ? (
                  <Link
                    to={`/login?next=${encodeURIComponent(`/business/${businessSlug}`)}`}
                    className="inline-flex min-h-11 items-center rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
                  >
                    {t('business.signInToOrder')}
                  </Link>
                ) : (
                  <form onSubmit={(event) => void placeOrder(event)} className="space-y-4">
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-navy-700">{t('business.selectItem')}</span>
                      <select
                        value={selectedItem}
                        onChange={(event) => setSelectedItem(event.target.value)}
                        required
                        className="min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      >
                        <option value="">{t('business.selectItemPlaceholder')}</option>
                        {orderableProducts.map((product) => (
                          <option key={product.product_id} value={`product:${product.product_id}`}>
                            {product.product_name} · {product.discount_price ?? product.price} {product.currency}
                          </option>
                        ))}
                        {bookableServices.map((service) => (
                          <option key={service.service_id} value={`service:${service.service_id}`}>
                            {service.service_name} · {service.price} {service.currency}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedProduct && (
                      <p className="text-sm font-semibold text-navy-800">
                        {t('business.orderTotal')}: {(
                          Number(selectedProduct.discount_price ?? selectedProduct.price) * quantity
                        ).toFixed(2)} {selectedProduct.currency}
                      </p>
                    )}
                    {selectedService && (
                      <p className="text-sm font-semibold text-navy-800">
                        {t('business.orderTotal')}: {(
                          Number(selectedService.price) * quantity
                        ).toFixed(2)} {selectedService.currency}
                      </p>
                    )}
                    {selectedItem.startsWith('product:') && (
                      <label className="block">
                        <span className="mb-1 block text-sm font-medium text-navy-700">{t('business.quantity')}</span>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          max={selectedProduct?.is_stock_tracked ? selectedProduct.stock_quantity : 999}
                          value={quantity}
                          onChange={(event) => {
                            const next = Number(event.target.value);
                            if (Number.isInteger(next)) setQuantity(Math.min(999, Math.max(1, next)));
                          }}
                          className="min-h-11 w-full rounded-xl border border-navy-200 px-3 text-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:w-40"
                        />
                      </label>
                    )}
                    {selectedService && (
                      <label className="block">
                        <span className="mb-1 block text-sm font-medium text-navy-700">{t('business.bookingTime')}</span>
                        <input
                          type="datetime-local"
                          value={scheduledFor}
                          onChange={(event) => setScheduledFor(event.target.value)}
                          required
                          min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                          className="min-h-11 w-full rounded-xl border border-navy-200 px-3 text-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                        />
                      </label>
                    )}
                    {orderError && <p role="alert" className="text-sm text-error-600">{orderError}</p>}
                    {orderSubmitted && <p role="status" className="text-sm font-medium text-success-600">{t('business.orderSuccess')}</p>}
                    <Button type="submit" loading={orderLoading} disabled={!selectedItem}>
                      {t('business.placeOrder')}
                    </Button>
                  </form>
                )}
              </Card>
            )}

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
              {reviewSubmitted && (
                <p role="status" className="mt-5 rounded-xl bg-success-50 p-3 text-sm text-success-600">
                  {t('business.reviewSubmitted')}
                </p>
              )}
              {isAuthenticated && reviewEligibilityError && (
                <p role="alert" className="mt-5 rounded-xl bg-error-50 p-3 text-sm text-error-600">
                  {t('business.reviewEligibilityError')}
                </p>
              )}
              {isAuthenticated && reviewEligibility?.eligible && !reviewSubmitted && (
                <form onSubmit={(event) => void submitReview(event)} className="mt-6 border-t border-navy-100 pt-5">
                  <h3 className="mb-3 font-semibold text-navy-900">{t('business.writeReview')}</h3>
                  <fieldset>
                    <legend className="mb-2 text-sm font-medium text-navy-700">{t('business.yourRating')}</legend>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setReviewRating(value)}
                          aria-label={t('common.starsLabel', { count: value })}
                          aria-pressed={reviewRating === value}
                          className="rounded p-1 text-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                        >
                          <Star className={cn('h-7 w-7', reviewRating >= value && 'fill-current')} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <label className="mt-3 block">
                    <span className="mb-1 block text-sm font-medium text-navy-700">{t('business.reviewComment')}</span>
                    <textarea
                      value={reviewText}
                      onChange={(event) => setReviewText(event.target.value)}
                      maxLength={4000}
                      rows={4}
                      className="w-full rounded-xl border border-navy-200 p-3 text-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                  </label>
                  {reviewError && <p role="alert" className="mt-3 text-sm text-error-600">{reviewError}</p>}
                  <Button type="submit" disabled={reviewRating === 0} className="mt-4">
                    {t('business.submitReview')}
                  </Button>
                </form>
              )}
              {isAuthenticated && reviewEligibility?.is_member && !reviewEligibility.already_reviewed && (
                <p className="mt-5 rounded-xl bg-navy-50 p-3 text-sm text-navy-600">{t('business.reviewMemberCannotReview')}</p>
              )}
              {isAuthenticated && reviewEligibility && !reviewEligibility.eligible && !reviewEligibility.already_reviewed && !reviewEligibility.is_member && (
                <p className="mt-5 rounded-xl bg-navy-50 p-3 text-sm text-navy-600">{t('business.reviewRequiresCompletedOrder')}</p>
              )}
              {isAuthenticated && reviewEligibility?.already_reviewed && !reviewSubmitted && (
                <p className="mt-5 rounded-xl bg-navy-50 p-3 text-sm text-navy-600">{t('business.alreadyReviewed')}</p>
              )}
              {!isAuthenticated && (
                <p className="mt-5 text-sm text-navy-600">
                  <Link to={`/login?next=${encodeURIComponent(`/business/${businessSlug}`)}`} className="font-semibold text-primary-700 underline">
                    {t('business.signInToReview')}
                  </Link>
                </p>
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
                      {(location.latitude != null && location.longitude != null || location.address) && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                            location.latitude != null && location.longitude != null
                              ? `${location.latitude},${location.longitude}`
                              : [location.address, location.district, location.city].filter(Boolean).join(', '),
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-medium text-primary-700 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                        >
                          <MapPin className="h-4 w-4" aria-hidden="true" />
                          {t('business.viewMap')}
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      )}
                      {location.phone && telHref(location.phone) && (
                        <a
                          href={telHref(location.phone)!}
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

        {productDetails && (
          <div
            key={productDetails.product_id}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-navy-950/60 p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setProductDetails(null);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="product-details-title"
              className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-navy-100 bg-white/95 p-4 backdrop-blur">
                <h2 id="product-details-title" className="text-xl font-bold text-navy-900">
                  {productDetails.product_name}
                </h2>
                <button
                  type="button"
                  onClick={() => setProductDetails(null)}
                  aria-label={t('common.close')}
                  className="rounded-full p-2 text-navy-500 hover:bg-navy-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <div className="space-y-6 p-4 sm:p-6">
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="space-y-5">
                    {productDetails.image_url && (
                      <SmartImage
                        value={productDetails.image_url}
                        width={960}
                        height={540}
                        className="max-h-96 w-full rounded-xl object-cover"
                        fallback={<div className="h-48 rounded-xl bg-navy-50" />}
                      />
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xl font-bold text-navy-900">
                        {productDetails.discount_price ?? productDetails.price} {productDetails.currency}
                      </p>
                      {productDetails.rating_count > 0 ? (
                        <div className="flex items-center gap-2">
                          <RatingStars rating={Number(productDetails.rating_avg)} size="sm" showValue />
                          <span className="text-sm text-navy-500">
                            {t('business.productRatingCount', { count: productDetails.rating_count })}
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm text-navy-500">{t('business.productRatingCount', { count: 0 })}</span>
                      )}
                    </div>
                    {productDetails.description && (
                      <section>
                        <h3 className="mb-1 font-semibold text-navy-900">{t('business.productDescription')}</h3>
                        <p className="whitespace-pre-line text-sm text-navy-600">{productDetails.description}</p>
                      </section>
                    )}
                    <section>
                      <h3 className="mb-1 font-semibold text-navy-900">{t('business.productIngredients')}</h3>
                      <p className="whitespace-pre-line text-sm text-navy-600">
                        {productDetails.ingredients || t('business.productIngredientsUnavailable')}
                      </p>
                    </section>
                  </div>

                  <section id="product-order" className="h-fit scroll-mt-20 rounded-2xl border border-primary-100 bg-primary-50/50 p-4 sm:p-5">
                    <h3 className="mb-2 text-lg font-semibold text-navy-900">{t('business.orderTitle')}</h3>
                    <p className="mb-4 text-sm text-navy-600">{t('business.orderDescription')}</p>
                    {isAuthenticated ? (
                      <div className="space-y-3">
                        {productDetails.is_stock_tracked && productDetails.stock_quantity === 0 ? (
                          <p className="text-sm text-error-600">{t('business.productOutOfStock')}</p>
                        ) : (
                          <>
                            <label className="block">
                              <span className="mb-1 block text-sm font-medium text-navy-700">{t('business.quantity')}</span>
                              <input
                                type="number"
                                min={1}
                                max={productDetails.is_stock_tracked ? productDetails.stock_quantity : 999}
                                step={1}
                                value={productQuantity}
                                onChange={(event) => {
                                  const next = Number(event.target.value);
                                  if (Number.isInteger(next)) {
                                    setProductQuantity(Math.min(
                                      productDetails.is_stock_tracked ? productDetails.stock_quantity : 999,
                                      Math.max(1, next),
                                    ));
                                  }
                                }}
                                className="min-h-11 w-full rounded-xl border border-navy-200 px-3 text-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:w-40"
                              />
                            </label>
                            <p className="font-semibold text-navy-800">
                              {t('business.orderTotal')}: {(
                                Number(productDetails.discount_price ?? productDetails.price) * productQuantity
                              ).toFixed(2)} {productDetails.currency}
                            </p>
                            {orderError && <p role="alert" className="text-sm text-error-600">{orderError}</p>}
                            {orderSubmitted && <p role="status" className="text-sm text-success-600">{t('business.orderSuccess')}</p>}
                            <Button
                              type="button"
                              loading={orderLoading}
                              disabled={orderLoading}
                              onClick={() => void placeProductOrder()}
                            >
                              {t('business.placeOrder')}
                            </Button>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-3">
                        <Link
                          to={`/login?next=${encodeURIComponent(`/business/${businessSlug}?product=${productDetails.product_id}`)}`}
                          className="inline-flex min-h-11 items-center rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
                        >
                          {t('business.signInToOrder')}
                        </Link>
                        <Link
                          to={`/register?next=${encodeURIComponent(`/business/${businessSlug}?product=${productDetails.product_id}`)}`}
                          className="text-sm font-semibold text-primary-700 underline"
                        >
                          {t('business.productFeedback.createAccount')}
                        </Link>
                      </div>
                    )}
                  </section>
                </div>

                <ProductFeedback
                  product={productDetails}
                  isAuthenticated={isAuthenticated}
                  loginHref={`/login?next=${encodeURIComponent(`/business/${businessSlug}?product=${productDetails.product_id}#product-feedback`)}`}
                  registerHref={`/register?next=${encodeURIComponent(`/business/${businessSlug}?product=${productDetails.product_id}#product-feedback`)}`}
                  orderTarget="#product-order"
                />
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
