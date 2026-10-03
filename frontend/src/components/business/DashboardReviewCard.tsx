import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Send } from 'lucide-react';
import { formatRelativeTime } from '../../lib/utils';
import { Card } from '../common/Card';
import { Badge, type BadgeVariant } from '../common/Badge';
import { RatingStars } from '../common/RatingStars';
import type { BusinessReview, Id, ReviewStatus } from '../../types';

/** The pill tone per state. `danger` marks the rejected row, not a neutral one. */
const STATUS_VARIANT: Record<ReviewStatus, BadgeVariant> = {
  pending: 'warning',
  published: 'success',
  hidden: 'default',
  rejected: 'danger',
};

interface DashboardReviewCardProps {
  /**
   * The owner's row, which is the only one that carries `status`.
   *
   * This is `BusinessReview` and not `PublicReview`: moderation state and the
   * actions below are meaningless on a published review, and the public card
   * deliberately has no controls to render.
   */
  review: BusinessReview;
  /** Shows the buttons as in-flight for this row. */
  isBusy?: boolean;
  onRespond?: (reviewId: Id) => void;
  onModerate?: (reviewId: Id, status: 'published' | 'hidden') => void;
}

/**
 * One review in the owner's inbox.
 *
 * There is no reviewer name on this row — the endpoint selects `r.*`, and only
 * the public view publishes a display name — so the author is a neutral
 * "Customer" label instead of a name the server never sent.
 */
export function DashboardReviewCard({
  review,
  isBusy = false,
  onRespond,
  onModerate,
}: DashboardReviewCardProps) {
  const { t } = useTranslation();

  return (
    <Card padding="md">
      <div className="flex items-start justify-between gap-2 mb-1">
        <h4 className="font-medium text-navy-900 truncate">{t('review.customer')}</h4>
        <RatingStars rating={review.rating} size="sm" />
      </div>

      <div className="flex items-center gap-3 text-sm text-navy-500 mb-2">
        <span>{formatRelativeTime(review.created_at)}</span>
        <Badge variant={STATUS_VARIANT[review.status]} size="sm">
          {t(`reviewStatus.${review.status}`)}
        </Badge>
      </div>

      {review.review_text && (
        <p className="text-navy-700 mt-3 whitespace-pre-wrap">{review.review_text}</p>
      )}

      {review.business_response && (
        <div className="mt-4 p-3 bg-sky rounded-sg border border-primary-100">
          <p className="text-xs font-medium text-primary-700 mb-1">{t('review.yourReply')}</p>
          <p className="text-navy-700">{review.business_response}</p>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        {review.status === 'pending' ? (
          <>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => onModerate?.(review.review_id, 'published')}
              className="px-3 py-1.5 bg-success-500 text-white text-sm rounded-button hover:bg-success-600 transition-colors disabled:opacity-60"
            >
              {t('review.publish')}
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => onModerate?.(review.review_id, 'hidden')}
              className="px-3 py-1.5 bg-navy-200 text-navy-800 text-sm rounded-button hover:bg-navy-300 transition-colors disabled:opacity-60"
            >
              {t('review.hide')}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => onModerate?.(review.review_id, review.status === 'published' ? 'hidden' : 'published')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-navy-100 text-navy-800 text-sm rounded-button hover:bg-navy-200 transition-colors disabled:opacity-60"
          >
            {review.status === 'published' ? (
              <EyeOff className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Eye className="w-4 h-4" aria-hidden="true" />
            )}
            {review.status === 'published' ? t('review.hide') : t('review.publish')}
          </button>
        )}

        {!review.business_response && onRespond && (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => onRespond(review.review_id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-500 text-white text-sm rounded-button hover:bg-primary-600 transition-colors disabled:opacity-60"
          >
            <Send className="w-4 h-4" aria-hidden="true" />
            {t('review.sendReply')}
          </button>
        )}
      </div>
    </Card>
  );
}