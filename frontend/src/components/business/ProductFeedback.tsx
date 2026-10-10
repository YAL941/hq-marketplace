import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import { Button } from '../common/Button';
import { RatingStars } from '../common/RatingStars';
import { formatRelativeTime } from '../../lib/utils';
import { reviewApi } from '../../services/api';
import type { Product, PublicProductReview } from '../../types';

interface ProductFeedbackProps {
  product: Product;
  isAuthenticated: boolean;
  loginHref: string;
  registerHref: string;
  orderTarget: string;
}

export function ProductFeedback({
  product,
  isAuthenticated,
  loginHref,
  registerHref,
  orderTarget,
}: ProductFeedbackProps) {
  const { t } = useTranslation();
  const pageSize = 50;
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reviews, setReviews] = useState<PublicProductReview[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [eligibility, setEligibility] = useState<{ eligible: boolean; order_id: string | null; already_reviewed: boolean; is_member: boolean } | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(isAuthenticated);
  const [eligibilityError, setEligibilityError] = useState(false);
  const [error, setError] = useState(false);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    void reviewApi.listPublicForProduct(product.product_id, pageSize).then((reviewResponse) => {
      if (cancelled) return;
      setReviews(reviewResponse.data.data);
      setHasMore(reviewResponse.data.data.length === pageSize);
    }).catch(() => {
      if (!cancelled) setError(true);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    if (isAuthenticated) {
      setEligibilityLoading(true);
      setEligibilityError(false);
      void reviewApi.productEligibility(product.product_id).then((response) => {
        if (!cancelled) setEligibility(response.data.data);
      }).catch(() => {
        if (!cancelled) {
          setEligibility(null);
          setEligibilityError(true);
        }
      }).finally(() => {
        if (!cancelled) setEligibilityLoading(false);
      });
    } else {
      setEligibility(null);
      setEligibilityLoading(false);
    }
    return () => { cancelled = true; };
  }, [isAuthenticated, product.product_id, pageSize]);

  const loadMore = async () => {
    setLoadingMore(true);
    setError(false);
    try {
      const response = await reviewApi.listPublicForProduct(product.product_id, pageSize, reviews.length);
      setReviews((current) => [...current, ...response.data.data]);
      setHasMore(response.data.data.length === pageSize);
    } catch {
      setError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!eligibility?.order_id || rating === 0) return;
    setSaving(true);
    setError(false);
    try {
      await reviewApi.createProductReview({
        productId: Number(product.product_id),
        orderId: Number(eligibility.order_id),
        rating,
        reviewText: text.trim() || null,
      });
      setSubmitted(true);
      setEligibility({ eligible: false, order_id: null, already_reviewed: true, is_member: false });
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="product-feedback" className="scroll-mt-20 border-t border-navy-100 pt-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-navy-900">{t('business.productFeedback.view')}</h3>
        {!loading && (
          <span className="text-sm text-navy-500">
            {t('business.productRatingCount', { count: product.rating_count })}
          </span>
        )}
      </div>
      <div className="space-y-4">
        {loading && <p className="text-sm text-navy-500">{t('business.productFeedback.loading')}</p>}
        {error && (
          <p role="alert" className="text-sm text-error-600">{t('business.productFeedback.error')}</p>
        )}
        {!loading && !error && reviews.length === 0 && (
          <p className="text-sm text-navy-500">{t('business.productFeedback.none')}</p>
        )}
        {reviews.map((review) => (
          <article key={review.product_review_id} className="border-t border-navy-100 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-navy-900">
                {review.author_name || t('business.productFeedback.customer')}
              </span>
              <time className="text-xs text-navy-400">{formatRelativeTime(review.created_at)}</time>
            </div>
            <RatingStars
              rating={review.rating}
              size="sm"
              className="mt-2 text-gold-500"
            />
            {review.review_text && <p className="mt-2 whitespace-pre-line text-sm text-navy-700">{review.review_text}</p>}
            {review.business_response && (
              <p className="mt-3 border-s-2 border-primary-200 ps-3 text-sm text-navy-600">
                <span className="font-medium">{t('business.productFeedback.businessReply')}: </span>
                {review.business_response}
              </p>
            )}
          </article>
        ))}
        {hasMore && (
          <Button type="button" variant="outline" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
            {t('business.productFeedback.loadMore')}
          </Button>
        )}
        {isAuthenticated && eligibility?.eligible && !submitted && (
          <form onSubmit={(event) => void submit(event)} className="border-t border-navy-100 pt-4">
            <h4 className="font-semibold text-navy-900">{t('business.productFeedback.write')}</h4>
            <fieldset className="mt-2">
              <legend className="mb-1 text-sm text-navy-700">{t('business.yourRating')}</legend>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRating(value)}
                    aria-label={t('common.starsLabel', { count: value })}
                    aria-pressed={rating === value}
                    className="rounded p-1 text-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    <Star className={`h-6 w-6 ${rating >= value ? 'fill-current' : ''}`} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="mt-2 block">
              <span className="mb-1 block text-sm text-navy-700">{t('business.productFeedback.commentLabel')}</span>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={4000}
                rows={3}
                required
                placeholder={t('business.productFeedback.commentPlaceholder')}
                className="w-full rounded-xl border border-navy-200 p-3 text-sm text-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              />
            </label>
            <Button type="submit" size="sm" className="mt-3" loading={saving} disabled={rating === 0 || !text.trim()}>
              {t('business.productFeedback.submit')}
            </Button>
          </form>
        )}
        {isAuthenticated && eligibilityLoading && (
          <p className="border-t border-navy-100 pt-3 text-sm text-navy-500">{t('business.productFeedback.checkingEligibility')}</p>
        )}
        {isAuthenticated && eligibilityError && (
          <p role="alert" className="border-t border-navy-100 pt-3 text-sm text-error-600">{t('business.productFeedback.eligibilityError')}</p>
        )}
        {isAuthenticated && eligibility?.is_member && !eligibility.already_reviewed && (
          <p className="border-t border-navy-100 pt-3 text-sm text-navy-600">
            {t('business.productFeedback.memberCannotReview')}
          </p>
        )}
        {isAuthenticated && eligibility && !eligibility.eligible && !eligibility.already_reviewed && !eligibility.is_member && (
          <p className="border-t border-navy-100 pt-3 text-sm text-navy-600">
            {t('business.productFeedback.requiresOrder')}{' '}
            <Link to={orderTarget} className="font-semibold text-primary-700 underline">
              {t('business.productFeedback.orderFirst')}
            </Link>
          </p>
        )}
        {isAuthenticated && eligibility?.already_reviewed && (
          <p className="border-t border-navy-100 pt-3 text-sm text-navy-600">
            {submitted ? t('business.productFeedback.submitted') : t('business.productFeedback.alreadyReviewed')}
          </p>
        )}
        {!isAuthenticated && (
          <div className="flex flex-wrap items-center gap-2 border-t border-navy-100 pt-3 text-sm text-navy-600">
            <Link to={loginHref} className="font-semibold text-primary-700 underline">{t('business.productFeedback.signIn')}</Link>
            <span aria-hidden="true">·</span>
            <Link to={registerHref} className="font-semibold text-primary-700 underline">{t('business.productFeedback.createAccount')}</Link>
          </div>
        )}
      </div>
    </section>
  );
}
