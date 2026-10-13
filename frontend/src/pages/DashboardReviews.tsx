import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { MessageSquare, Send, Star } from 'lucide-react';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { EmptyState } from '../components/common/EmptyState';
import { Badge, type BadgeVariant } from '../components/common/Badge';
import { OffsetPagerView, StaffListLayout } from '../components/common/OffsetPager';
import { useOffsetPager } from '../components/common/useOffsetPager';
import { reviewApi, toFieldIssue, type FieldIssue } from '../services/api';
import { formatDateTime } from '../lib/utils';
import type { BusinessReview, Id, ProductReview, ReviewStatus } from '../types';

const PAGE_SIZE = 20;
const STATUSES: Array<ReviewStatus | ''> = ['', 'pending', 'published', 'hidden', 'rejected'];

const STATUS_VARIANT: Record<ReviewStatus, BadgeVariant> = {
  pending: 'warning',
  published: 'success',
  hidden: 'default',
  rejected: 'danger',
};

/**
 * The owner's review inbox.
 *
 * The reviewer has no name on this row. The endpoint selects `r.*`, and the
 * display name only exists on the public route's `app_public_reviews()` view,
 * which an owner must not reach for someone else's account. So the author is
 * shown as a neutral "Customer" label rather than a name that was never sent.
 */
export function DashboardReviewsPage() {
  const { t } = useTranslation();
  const params = useParams<{ businessId: Id }>();
  const businessId = params.businessId ?? '';

  const [reviews, setReviews] = useState<BusinessReview[]>([]);
  const [productReviews, setProductReviews] = useState<ProductReview[]>([]);
  const [status, setStatus] = useState<ReviewStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [productDrafts, setProductDrafts] = useState<Record<string, string>>({});
  const [replyOpenId, setReplyOpenId] = useState<Id | null>(null);
  const [productReplyOpenId, setProductReplyOpenId] = useState<Id | null>(null);
  const [busyId, setBusyId] = useState<Id | null>(null);
  const [busyProductId, setBusyProductId] = useState<Id | null>(null);
  const [issue, setIssue] = useState<FieldIssue | null>(null);
  const pager = useOffsetPager(PAGE_SIZE);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(false);
    try {
      const params = { limit: PAGE_SIZE, offset: pager.offset, status: status || undefined };
      const [res, productRes] = await Promise.all([
        reviewApi.listForBusiness(businessId, params),
        reviewApi.listProductReviewsForBusiness(businessId, params),
      ]);
      setReviews(res.data.data);
      setProductReviews(productRes.data.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [businessId, pager.offset, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const onStatusChange = (value: string) => {
    pager.reset();
    setStatus(value as ReviewStatus | '');
  };

  const respond = async (review: BusinessReview) => {
    const text = (drafts[review.review_id] ?? '').trim();
    if (text === '') return;
    setBusyId(review.review_id);
    setIssue(null);
    try {
      const res = await reviewApi.respond(businessId, review.review_id, text);
      setReviews((prev) =>
        prev.map((item) => (item.review_id === review.review_id ? res.data.data : item)),
      );
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[review.review_id];
        return next;
      });
      setReplyOpenId(null);
    } catch (error) {
      setIssue(toFieldIssue(error));
    } finally {
      setBusyId(null);
    }
  };

  const respondToProduct = async (review: ProductReview) => {
    const text = (productDrafts[review.product_review_id] ?? '').trim();
    if (!text) return;
    setBusyProductId(review.product_review_id);
    setIssue(null);
    try {
      const res = await reviewApi.respondToProduct(businessId, review.product_review_id, text);
      setProductReviews((prev) =>
        prev.map((item) => (item.product_review_id === review.product_review_id ? res.data.data : item)),
      );
      setProductDrafts((prev) => {
        const next = { ...prev };
        delete next[review.product_review_id];
        return next;
      });
      setProductReplyOpenId(null);
    } catch (error) {
      setIssue(toFieldIssue(error));
    } finally {
      setBusyProductId(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-navy-900">{t('review.title')}</h1>
        <div>
          <label htmlFor="review-status-filter" className="sr-only">{t('review.status')}</label>
          <select
            id="review-status-filter"
            value={status}
            onChange={(e) => onStatusChange(e.target.value)}
            className="rounded-button border border-navy-300 px-3 py-2.5 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            {STATUSES.map((value) => (
              <option key={value || 'all'} value={value}>
                {value ? t(`reviewStatus.${value}`) : t('review.allStatuses')}
              </option>
            ))}
          </select>
        </div>
      </div>

      {issue && (
        <p className="mb-4 p-3 bg-error-50 border border-error-200 rounded-button text-error-700 text-sm" role="alert">
          {issue.message || t('common.saveFailed')}
        </p>
      )}

      <StaffListLayout
        loading={loading}
        error={error}
        isEmpty={reviews.length === 0}
        onRetry={() => void load()}
        empty={
          <EmptyState
            icon={<MessageSquare className="w-8 h-8" />}
            title={t('review.emptyTitle')}
            description={t('review.emptyBody')}
          />
        }
      >
        <div className="space-y-3">
          {reviews.map((review) => (
            <Card key={review.review_id} className="p-4">
              <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-semibold text-navy-900">{t('review.customer')}</span>
                <Badge variant={STATUS_VARIANT[review.status]} size="sm">
                  {t(`reviewStatus.${review.status}`)}
                </Badge>
                <span className="ms-auto text-xs text-navy-400">
                  {formatDateTime(review.created_at)}
                </span>
                <div className="flex items-center gap-1" aria-label={t('review.ratingOf', { count: review.rating })}>
                  {Array.from({ length: 5 }, (_unused, index) => (
                    <Star
                      key={index}
                      className={`h-3.5 w-3.5 ${index < review.rating ? 'text-gold-400' : 'text-navy-200'}`}
                      fill="currentColor"
                      aria-hidden="true"
                    />
                  ))}
                </div>
              </div>

              {review.review_text ? (
                <p className="mb-2 whitespace-pre-line break-words text-sm leading-5 text-navy-700">{review.review_text}</p>
              ) : (
                <p className="mb-2 text-xs italic text-navy-400">{t('review.noText')}</p>
              )}

              {review.business_response && (
                <div className="mb-2 rounded-lg border-s-2 border-primary-300 bg-primary-50 px-3 py-2">
                  <p className="mb-0.5 text-xs font-semibold text-primary-700">{t('review.yourReply')}</p>
                  <p className="whitespace-pre-line break-words text-sm text-navy-700">{review.business_response}</p>
                </div>
              )}

              {!review.business_response && (
                <div className="mb-2">
                  {replyOpenId !== review.review_id ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="px-2"
                      onClick={() => setReplyOpenId(review.review_id)}
                    >
                      <MessageSquare className="h-4 w-4" aria-hidden="true" />
                      {t('review.replyAction')}
                    </Button>
                  ) : (
                    <div className="space-y-2">
                  <label htmlFor={`reply-${review.review_id}`} className="sr-only">
                    {t('review.replyLabel')}
                  </label>
                  <textarea
                    id={`reply-${review.review_id}`}
                    value={drafts[review.review_id] ?? ''}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [review.review_id]: e.target.value }))
                    }
                    rows={2}
                    maxLength={4000}
                    placeholder={t('review.replyPlaceholder')}
                    className="w-full resize-y rounded-lg border border-navy-300 bg-white px-3 py-2 text-sm text-navy-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      loading={busyId === review.review_id}
                      disabled={(drafts[review.review_id] ?? '').trim() === ''}
                      onClick={() => void respond(review)}
                    >
                      <Send className="w-4 h-4" aria-hidden="true" />
                      {t('review.sendReply')}
                    </Button>
                  </div>
                    </div>
                  )}
                </div>
              )}

            </Card>
          ))}
        </div>

        <OffsetPagerView pager={pager} returned={reviews.length} pageSize={PAGE_SIZE} disabled={loading} />
      </StaffListLayout>

      <section className="mt-10">
        <h2 className="mb-4 text-xl font-bold text-navy-900">{t('business.productFeedback.dashboardTitle')}</h2>
        {productReviews.length === 0 ? (
          <Card className="p-5 text-sm text-navy-500">{t('business.productFeedback.dashboardEmpty')}</Card>
        ) : (
          <div className="space-y-3">
            {productReviews.map((review) => (
              <Card key={review.product_review_id} className="p-4">
                <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold text-navy-900">{t('review.customer')}</span>
                  <span className="min-w-0 truncate text-xs text-navy-500">
                    {review.product_name ?? t('business.productFeedback.productReference', { id: review.product_id })}
                  </span>
                  <Badge variant={STATUS_VARIANT[review.status]} size="sm">
                    {t(`reviewStatus.${review.status}`)}
                  </Badge>
                  <span className="ms-auto text-xs text-navy-400">{formatDateTime(review.created_at)}</span>
                  <div className="flex items-center gap-1" aria-label={t('review.ratingOf', { count: review.rating })}>
                    {Array.from({ length: 5 }, (_unused, index) => (
                      <Star
                        key={index}
                        className={`h-3.5 w-3.5 ${index < review.rating ? 'text-gold-400' : 'text-navy-200'}`}
                        fill="currentColor"
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                </div>
                {review.review_text
                  ? <p className="mb-2 whitespace-pre-line break-words text-sm leading-5 text-navy-700">{review.review_text}</p>
                  : <p className="mb-2 text-xs italic text-navy-400">{t('review.noText')}</p>}
                {review.business_response ? (
                  <div className="mb-2 rounded-lg border-s-2 border-primary-300 bg-primary-50 px-3 py-2">
                    <p className="mb-0.5 text-xs font-semibold text-primary-700">{t('review.yourReply')}</p>
                    <p className="whitespace-pre-line break-words text-sm text-navy-700">{review.business_response}</p>
                  </div>
                ) : (
                  <div className="mb-2">
                    {productReplyOpenId !== review.product_review_id ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-2"
                        onClick={() => setProductReplyOpenId(review.product_review_id)}
                      >
                        <MessageSquare className="h-4 w-4" aria-hidden="true" />
                        {t('review.replyAction')}
                      </Button>
                    ) : (
                      <div className="space-y-2">
                    <label htmlFor={`product-reply-${review.product_review_id}`} className="sr-only">
                      {t('review.replyLabel')}
                    </label>
                    <textarea
                      id={`product-reply-${review.product_review_id}`}
                      value={productDrafts[review.product_review_id] ?? ''}
                      onChange={(event) =>
                        setProductDrafts((prev) => ({ ...prev, [review.product_review_id]: event.target.value }))
                      }
                      rows={2}
                      maxLength={4000}
                      placeholder={t('review.replyPlaceholder')}
                      className="w-full resize-y rounded-lg border border-navy-300 bg-white px-3 py-2 text-sm text-navy-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        loading={busyProductId === review.product_review_id}
                        disabled={(productDrafts[review.product_review_id] ?? '').trim() === ''}
                        onClick={() => void respondToProduct(review)}
                      >
                        <Send className="h-4 w-4" aria-hidden="true" />
                        {t('review.sendReply')}
                      </Button>
                    </div>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}