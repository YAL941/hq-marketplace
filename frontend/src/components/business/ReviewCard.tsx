import { useTranslation } from 'react-i18next';
import { formatRelativeTime } from '../../lib/utils';
import { Card } from '../common/Card';
import { RatingStars } from '../common/RatingStars';
import { User, MessageSquare, Clock } from 'lucide-react';
import type { PublicReview } from '../../types';

interface ReviewCardProps {
  /**
   * A `PublicReview`, not the owner's `BusinessReview`.
   *
   * These are different rows. The public endpoint reads `app_public_reviews()`,
   * which is the one view that carries `author_name` and `responded_at`. The
   * owner's endpoint selects `r.*` and has neither, so this card cannot be fed
   * from the dashboard without showing a blank author and a missing date.
   *
   * This card is also presentational only. A published review carries no
   * `status` at all — moderation state is not published — so there is nothing
   * here for a status pill or a publish/hide button to read. The owner surface
   * renders `DashboardReviewCard` instead.
   */
  review: PublicReview;
}

export function ReviewCard({ review }: ReviewCardProps) {
  const { t } = useTranslation();

  return (
    <Card padding="md" className="relative">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-sky flex items-center justify-center flex-shrink-0">
          <User className="w-5 h-5 text-primary-500" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h4 className="font-medium text-navy-900 truncate">
              {review.author_name || t('review.customer')}
            </h4>
            <RatingStars rating={review.rating} size="sm" />
          </div>
          <div className="flex items-center gap-3 text-sm text-navy-500 mb-2">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
              {formatRelativeTime(review.created_at)}
            </span>
            {review.responded_at && (
              <span className="text-success-600">
                {t('review.respondedOn', { date: formatRelativeTime(review.responded_at) })}
              </span>
            )}
          </div>
        </div>
      </div>

      {review.review_text && (
        <p className="text-navy-700 mt-3 whitespace-pre-wrap">{review.review_text}</p>
      )}

      {review.business_response && (
        <div className="mt-4 p-3 bg-sky rounded-sg border border-primary-100">
          <div className="flex items-center gap-1.5 text-sm text-primary-700 mb-1">
            <MessageSquare className="w-4 h-4" aria-hidden="true" />
            <span className="font-medium">{t('review.yourReply')}</span>
          </div>
          <p className="text-navy-700">{review.business_response}</p>
          {review.responded_at && (
            <p className="text-xs text-navy-500 mt-1">
              {t('review.respondedOn', { date: formatRelativeTime(review.responded_at) })}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}