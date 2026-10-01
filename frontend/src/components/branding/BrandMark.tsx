import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

type BrandMarkProps = {
  to: string;
  ariaLabel: string;
  variant: 'light' | 'dark';
  size: 'sm' | 'md';
  className?: string;
};

const SIZES = {
  sm: { box: 'w-9 h-9 rounded-xl', initial: 'text-base', suffix: 'text-[9px]', wordmark: 'text-xl' },
  md: { box: 'w-10 h-10 rounded-xl', initial: 'text-lg', suffix: 'text-[10px]', wordmark: 'text-2xl' },
};

export function BrandMark({ to, ariaLabel, variant, size, className }: BrandMarkProps) {
  const { t } = useTranslation();
  const dims = SIZES[size];
  const onDark = variant === 'dark';

  return (
    <Link to={to} aria-label={ariaLabel} className={cn('flex items-center gap-2', className)}>
      <span
        className={cn(
          dims.box,
          'bg-primary-600 flex flex-col items-center justify-center leading-none font-bold text-white flex-shrink-0',
        )}
        aria-hidden="true"
      >
        <span className={dims.initial}>O</span>
        <span className={cn(dims.suffix, 'tracking-tight')}>HQ</span>
      </span>
      <span className={cn(dims.wordmark, 'font-bold', onDark ? 'text-white' : 'text-navy-900')}>
        <span>{t('brand.wordmarkBase')}</span>
        <span className="text-primary-600">{t('brand.wordmarkAccent')}</span>
      </span>
    </Link>
  );
}

export default BrandMark;