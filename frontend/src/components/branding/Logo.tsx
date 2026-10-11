import { CSSProperties, PointerEvent, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import './Logo.css';

type LogoVariant = 'light' | 'dark';
type LogoSize = 'sm' | 'md';
let headerIntroPlayed = false;

interface LogoProps {
  variant: LogoVariant;
  size?: LogoSize;
  to?: string;
  ariaLabel?: string;
  className?: string;
  intro?: boolean;
  introOnce?: boolean;
  iconOnly?: boolean;
}

const SIZE_VALUES: Record<LogoSize, { icon: number; font: number }> = {
  sm: { icon: 40, font: 24 },
  md: { icon: 72, font: 44 },
};

// الحركة التمهيدية اختيارية، وتُستخدم introOnce لمنع تكرارها داخل الترويسة.
export function Logo({
  variant,
  size = 'md',
  to,
  ariaLabel,
  className,
  intro = false,
  iconOnly = false,
  introOnce = false,
}: LogoProps) {
  const { t } = useTranslation();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const shouldPlayIntro = intro && (!introOnce || !headerIntroPlayed);
  const [hasIntro, setHasIntro] = useState(shouldPlayIntro);
  const [burst, setBurst] = useState(false);
  const dimensions = SIZE_VALUES[size];
  const style = {
    '--icon': `${dimensions.icon}px`,
    '--fs': `${dimensions.font}px`,
    '--tilt-x': '0deg',
    '--tilt-y': '0deg',
  } as CSSProperties;

  useEffect(() => {
    if (!shouldPlayIntro) return;
    if (introOnce) headerIntroPlayed = true;
    const timer = window.setTimeout(() => setHasIntro(false), 2100);
    return () => window.clearTimeout(timer);
  }, [introOnce, shouldPlayIntro]);

  useEffect(() => {
    if (!burst) return;
    const timer = window.setTimeout(() => setBurst(false), 700);
    return () => window.clearTimeout(timer);
  }, [burst]);

  const handlePointerMove = (event: PointerEvent<HTMLSpanElement>) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    event.currentTarget.style.setProperty('--tilt-x', `${(0.5 - y) * 16}deg`);
    event.currentTarget.style.setProperty('--tilt-y', `${(x - 0.5) * 16}deg`);
  };

  const handlePointerLeave = (event: PointerEvent<HTMLSpanElement>) => {
    event.currentTarget.style.setProperty('--tilt-x', '0deg');
    event.currentTarget.style.setProperty('--tilt-y', '0deg');
  };

  const handleClick = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setBurst(false);
    window.requestAnimationFrame(() => setBurst(true));
  };

  const wordmark = (
    <span className="omni-logo__wordmark" aria-hidden="true">
      <span className="omni-logo__base">
        {Array.from(t('brand.wordmarkBase')).map((letter, index) => (
          <span className="omni-logo__letter" style={{ '--letter-index': index } as CSSProperties} key={`base-${index}`}>
            {letter}
          </span>
        ))}
      </span>
      <span className="omni-logo__accent">
        {Array.from(t('brand.wordmarkAccent')).map((letter, index) => (
          <span className="omni-logo__letter" style={{ '--letter-index': index + t('brand.wordmarkBase').length } as CSSProperties} key={`accent-${index}`}>
            {letter}
          </span>
        ))}
      </span>
    </span>
  );

  const content = (
    <span
      className={cn(
        'omni-logo',
        `omni-logo--${variant}`,
        hasIntro && 'omni-logo--intro',
        burst && 'omni-logo--burst',
        iconOnly && 'omni-logo--icon-only',
        className,
      )}
      style={style}
      dir="ltr"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onClick={handleClick}
    >
      <svg className="omni-logo__mark" viewBox="0 0 128 128" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`omniGrad-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#5CA9FF" />
            <stop offset="100%" stopColor="#1B62CC" />
          </linearGradient>
          <linearGradient id={`omniShine-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity=".48" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="omni-logo__tilt">
          <g className="omni-logo__entrance">
            <rect x="4" y="4" width="120" height="120" rx="30" fill={`url(#omniGrad-${id})`} />
            <path d="M12 34C22 17 41 9 64 9s42 8 52 25v12H12z" fill={`url(#omniShine-${id})`} />
            <g className="omni-logo__ambient">
              <circle className="omni-logo__radar omni-logo__radar--first" cx="64" cy="64" r="14" />
              <circle className="omni-logo__radar omni-logo__radar--second" cx="64" cy="64" r="14" />
              <circle className="omni-logo__center-breathe" cx="64" cy="64" r="6.5" fill="white" />
              <g className="omni-logo__ring-spin">
                <circle className="omni-logo__ring" cx="64" cy="64" r="25" pathLength="100" />
              </g>
              <g className="omni-logo__star-interaction">
                <g className="omni-logo__star">
                  <path d="m87 34 3.3 7.1 7.7.9-5.7 5.2 1.5 7.6-6.8-3.9-6.8 3.9 1.5-7.6-5.7-5.2 7.7-.9z" fill="#F5B93A" />
                </g>
              </g>
            </g>
          </g>
        </g>
      </svg>
      {wordmark}
      <span className="omni-logo__underline" aria-hidden="true" />
    </span>
  );

  if (!to) return content;
  return (
    <Link to={to} aria-label={ariaLabel ?? 'OmniHQ'} className="omni-logo__link">
      {content}
    </Link>
  );
}

export default Logo;
