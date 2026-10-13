import { Avatar } from '../layout/Avatar';
import { RatingStars } from '../common/RatingStars';
import { formatRelativeTime } from '../../lib/utils';

interface CustomerReviewItemProps {
  authorName: string;
  createdAt: string;
  rating: number;
  reviewText: string | null;
  businessResponse: string | null;
  responseLabel: string;
}

export function CustomerReviewItem({
  authorName,
  createdAt,
  rating,
  reviewText,
  businessResponse,
  responseLabel,
}: CustomerReviewItemProps) {
  return (
    <article className="flex min-w-0 items-start gap-3">
      <Avatar name={authorName} size="sm" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-navy-900">{authorName}</span>
          <span className="text-xs text-navy-400" aria-hidden="true">·</span>
          <time className="text-xs text-navy-500">{formatRelativeTime(createdAt)}</time>
          <RatingStars rating={rating} size="sm" className="ms-auto text-gold-500" />
        </div>
        {reviewText && (
          <p className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-navy-700">
            {reviewText}
          </p>
        )}
        {businessResponse && (
          <div className="mt-3 border-s-2 border-primary-200 ps-3">
            <p className="text-xs font-semibold text-primary-700">{responseLabel}</p>
            <p className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-navy-600">
              {businessResponse}
            </p>
          </div>
        )}
      </div>
    </article>
  );
}
