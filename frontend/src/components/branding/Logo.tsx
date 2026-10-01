import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

/**
 * The OmniHQ wordmark.
 *
 * Two parts, and the split matters. The mark is an image, so it cannot be
 * translated, restyled or read by a screen reader; the name beside it is live
 * text, so it stays selectable, scales with the page, and reads correctly in
 * every language. Baking "OmniHQ" into the SVG would make the logo an
 * untranslatable, unreadable raster in a layout that has to work in three
 * scripts.
 *
 * The two supplied marks are chosen by background, not by preference:
 * `omnihq-mark.svg` carries its own rounded-square gradient and reads on a
 * light surface, while `omnihq-mark-transparent.svg` is a white ring and would
 * disappear against white.
 */
type LogoVariant = 'light' | 'dark';

const SIZES = {
  sm: { mark: 'h-8 w-8', text: 'text-xl' },
  md: { mark: 'h-10 w-10', text: 'text-2xl' },
} as const;

const MARKS: Record<LogoVariant, string> = {
  light: '/brand/omnihq-mark.svg',
  dark: '/brand/omnihq-mark-transparent.svg',
};

const WORDMARK: Record<LogoVariant, { base: string; accent: string }> = {
  // Navy and blue on a light surface.
  light: { base: 'text-navy-900', accent: 'text-primary-500' },
  // White and gold on a dark surface.
  dark: { base: 'text-white', accent: 'text-gold-400' },
};

interface LogoProps {
  variant: LogoVariant;
  size?: keyof typeof SIZES;
  /** Wraps the mark and the name in a link. Omit to render the mark alone. */
  to?: string;
  /** Accessible name for the link. */
  ariaLabel?: string;
  className?: string;
}

export function Logo({ variant, size = 'sm', to, ariaLabel, className }: LogoProps) {
  const { t } = useTranslation();
  const dims = SIZES[size];
  const colors = WORDMARK[variant];

  const content = (
    <>
      <img
        src={MARKS[variant]}
        alt=""
        aria-hidden="true"
        width={128}
        height={128}
        className={cn(dims.mark, 'flex-shrink-0')}
      />
      <span
        className={cn(
          'font-brand font-bold tracking-[-0.04em] leading-none',
          dims.text,
          colors.base,
        )}
      >
        {/* The space between the two parts is what makes "Omni HQ" read as one
            word; a newline in JSX would collapse to that same single space. */}
        <span>{t('brand.wordmarkBase')}</span>
        <span className={colors.accent}>{t('brand.wordmarkAccent')}</span>
      </span>
    </>
  );

  if (!to) {
    return <span className={cn('inline-flex items-center gap-2', className)}>{content}</span>;
  }

  return (
    <Link to={to} aria-label={ariaLabel} className={cn('inline-flex items-center gap-2', className)}>
      {content}
    </Link>
  );
}

export default Logo;