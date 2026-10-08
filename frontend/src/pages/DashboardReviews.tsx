import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { MessageSquare, EyeOff, Eye, Send, Star } from 'lucide-react';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { EmptyState } from '../components/common/EmptyState';
import { Badge, type BadgeVariant } from '../components/common/Badge';
import {
  OffsetPagerView, StaffListLayout, useOffsetPager,
} from '../components/common/OffsetPager';
import { reviewApi, toFieldIssue, type FieldIssue } from '../services/api';
import { formatDateTime } from '../lib/utils';
import type { BusinessReview, Id, ReviewStatus } from '../types';

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
  const [status, setStatus] = useState<ReviewStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<Id | null>(null);
  const [issue, setIssue] = useState<FieldIssue | null>(null);
  const pager = useOffsetPager(PAGE_SIZE);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(false);
    try {
      const res = await reviewApi.listForBusiness(businessId, {
        limit: PAGE_SIZE,
        offset: pager.offset,
        status: status || undefined,
      });
      setReviews(res.data.data);
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
    } catch (error) {
      setIssue(toFieldIssue(error));
    } finally {
      setBusyId(null);
    }
  };

  const moderate = async (review: BusinessReview, next: 'published' | 'hidden') => {
    setBusyId(review.review_id);
    setIssue(null);
    try {
      const res = await reviewApi.moderate(businessId, review.review_id, next);
      setReviews((prev) =>
        prev.map((item) => (item.review_id === review.review_id ? res.data.data : item)),
      );
    } catch (error) {
      setIssue(toFieldIssue(error));
    } finally {
      setBusyId(null);
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
        <div className="space-y-4">
          {reviews.map((review) => (
            <Card key={review.review_id} className="p-5">
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <span className="font-medium text-navy-900">{t('review.customer')}</span>
                <Badge variant={STATUS_VARIANT[review.status]} size="sm">
                  {t(`reviewStatus.${review.status}`)}
                </Badge>
                <span className="text-xs text-navy-400 ms-auto">
                  {formatDateTime(review.created_at)}
                </span>
              </div>

              <div className="flex items-center gap-1 mb-2" aria-label={t('review.ratingOf', { count: review.rating })}>
                {Array.from({ length: 5 }, (_unused, index) => (
                  <Star
                    key={index}
                    className={`w-4 h-4 ${index < review.rating ? 'text-gold-400' : 'text-navy-200'}`}
                    fill="currentColor"
                    aria-hidden="true"
                  />
                ))}
              </div>

              {review.review_text ? (
                <p className="text-navy-700 mb-4">{review.review_text}</p>
              ) : (
                <p className="text-sm text-navy-400 italic mb-4">{t('review.noText')}</p>
              )}

              {review.business_response && (
                <div className="rounded-button bg-sky p-4 mb-4">
                  <p className="text-xs font-medium text-primary-700 mb-1">{t('review.yourReply')}</p>
                  <p className="text-navy-700">{review.business_response}</p>
                </div>
              )}

              {!review.business_response && (
                <div className="mb-4">
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
                    className="w-full rounded-button border border-navy-300 px-4 py-2.5 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <div className="mt-2">
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

              <div className="flex flex-wrap gap-2 pt-3 border-t border-navy-100">
                {review.status === 'published' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    loading={busyId === review.review_id}
                    disabled={busyId === review.review_id}
                    onClick={() => void moderate(review, 'hidden')}
                  >
                    <EyeOff className="w-4 h-4" aria-hidden="true" />
                    {t('review.hide')}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    loading={busyId === review.review_id}
                    disabled={busyId === review.review_id}
                    onClick={() => void moderate(review, 'published')}
                  >
                    <Eye className="w-4 h-4" aria-hidden="true" />
                    {t('review.publish')}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>

        <OffsetPagerView pager={pager} returned={reviews.length} pageSize={PAGE_SIZE} disabled={loading} />
      </StaffListLayout>
    </div>
  );
}