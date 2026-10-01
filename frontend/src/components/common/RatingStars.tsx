import { cn } from '../../lib/utils';

interface RatingStarsProps {
  rating: number;
  maxRating?: number;
  size?: 'sm' | 'md' | 'lg';
  showValue?: boolean;
  interactive?: boolean;
  onChange?: (rating: number) => void;
  className?: string;
}

export function RatingStars({ rating, maxRating = 5, size = 'md', showValue = false, interactive = false, onChange, className }: RatingStarsProps) {
  const sizes = { sm: 'w-3 h-3', md: 'w-5 h-5', lg: 'w-6 h-6' };
  const starSize = sizes[size];

  const renderStars = () => {
    const stars = [];
    for (let i = 1; i <= maxRating; i++) {
      const filled = i <= rating;
      const partial = !filled && i - 0.5 <= rating;
      stars.push(
        <button
          key={i}
          type="button"
          onClick={() => interactive && onChange?.(i)}
          onMouseEnter={() => interactive && onChange?.(i - 0.5)}
          onMouseLeave={() => interactive && onChange?.(rating)}
          disabled={!interactive}
          className={cn('flex-shrink-0 transition-transform duration-100', interactive && 'hover:scale-110 cursor-pointer', !interactive && 'cursor-default')}
          aria-label={`${i} star${i !== 1 ? 's' : ''}`}
        >
          <svg className={starSize} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            {filled ? (
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            ) : partial ? (
              <>
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor" fillOpacity="0.5" />
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="none" stroke="currentColor" strokeWidth="0.5" />
              </>
            ) : (
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="none" stroke="currentColor" strokeWidth="1.5" />
            )}
          </svg>
        </button>
      );
    }
    return stars;
  };

  return (
    <div className={cn('flex items-center gap-1', className)} role="img" aria-label={`${rating} out of ${maxRating} stars`}>
      {renderStars()}
      {showValue && (
        <span className="text-navy-600 font-medium ml-1">{rating.toFixed(1)}</span>
      )}
    </div>
  );
}