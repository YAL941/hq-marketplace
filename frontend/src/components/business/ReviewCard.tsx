import { formatRelativeTime } from '../../lib/utils';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { RatingStars } from '../common/RatingStars';
import { User, MessageSquare, Clock, CheckCircle } from 'lucide-react';
import type { Review } from '../../types';

interface ReviewCardProps {
  review: Review;
  showBusiness?: boolean;
  businessName?: string;
  onRespond?: (reviewId: number) => void;
  onModerate?: (reviewId: number, status: 'published' | 'hidden') => void;
  isBusinessView?: boolean;
}

export function ReviewCard({ review, onRespond, onModerate, isBusinessView = false }: ReviewCardProps) {
  return (
    <Card padding="md" className="relative">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
          <User className="w-5 h-5 text-primary-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h4 className="font-medium text-navy-900 truncate">
              {review.user_full_name || 'Anonymous'}
            </h4>
            <RatingStars rating={review.rating} size="sm" />
          </div>
          <div className="flex items-center gap-3 text-sm text-navy-500 mb-2">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {formatRelativeTime(review.created_at)}
            </span>
            {review.responded_at && (
              <span className="flex items-center gap-1 text-success-600">
                <CheckCircle className="w-3.5 h-3.5" />
                Responded {formatRelativeTime(review.responded_at)}
              </span>
            )}
          </div>
        </div>
      </div>

      {review.review_text && (
        <p className="text-navy-700 mt-3 whitespace-pre-wrap">{review.review_text}</p>
      )}

      {review.business_response && (
        <div className="mt-4 p-3 bg-primary-50 rounded-lg border border-primary-100">
          <div className="flex items-center gap-1.5 text-sm text-primary-700 mb-1">
            <MessageSquare className="w-4 h-4" />
            <span className="font-medium">Business Response:</span>
          </div>
          <p className="text-primary-800">{review.business_response}</p>
          <p className="text-xs text-primary-500 mt-1">
            Responded {formatRelativeTime(review.responded_at!)}
          </p>
        </div>
      )}

      {isBusinessView && (
        <div className="mt-4 flex items-center gap-2">
          {review.status === 'pending' && (
            <>
              <button
                onClick={() => onModerate?.(review.review_id, 'published')}
                className="px-3 py-1.5 bg-success-500 text-white text-sm rounded-button hover:bg-success-600 transition-colors"
              >
                Publish
              </button>
              <button
                onClick={() => onModerate?.(review.review_id, 'hidden')}
                className="px-3 py-1.5 bg-warning-500 text-white text-sm rounded-button hover:bg-warning-600 transition-colors"
              >
                Hide
              </button>
            </>
          )}
          {review.status === 'published' && !review.business_response && onRespond && (
            <button
              onClick={() => onRespond(review.review_id)}
              className="px-3 py-1.5 bg-primary-500 text-white text-sm rounded-button hover:bg-primary-600 transition-colors"
            >
              Respond
            </button>
          )}
          <Badge
            variant={
              review.status === 'published' ? 'success' :
              review.status === 'hidden' ? 'warning' :
              review.status === 'rejected' ? 'error' : 'default'
            }
            size="sm"
          >
            {review.status}
          </Badge>
        </div>
      )}
    </Card>
  );
}