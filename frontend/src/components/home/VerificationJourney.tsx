import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import './VerificationJourney.css';

interface VerificationJourneyProps {
  ctaTarget?: string;
}

export function VerificationJourney({
  ctaTarget = '/list-your-business',
}: VerificationJourneyProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    preference.addEventListener('change', updatePreference);
    return () => preference.removeEventListener('change', updatePreference);
  }, []);

  useEffect(() => {
    if (reducedMotion) videoRef.current?.pause();
  }, [reducedMotion]);

  return (
    <section
      className="verification-journey bg-navy-50 py-14 sm:py-20"
      aria-labelledby="verification-journey-title"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary-700">
            {t('verification.eyebrow')}
          </p>
          <h2 id="verification-journey-title" className="mt-3 text-3xl font-bold text-navy-900 sm:text-4xl">
            {t('verification.title')}
          </h2>
          <p className="mt-4 leading-7 text-navy-600">{t('verification.subtitle')}</p>
        </header>

        <video
          ref={videoRef}
          className="verification-video mt-10"
          src="/omnihq.mp4"
          poster="/omnihq-poster.jpg"
          aria-label={t('verification.title')}
          autoPlay={!reducedMotion}
          muted
          loop
          playsInline
          controls
          preload="metadata"
        />

        <div className="mt-8 flex justify-center">
          <Link
            to={ctaTarget}
            onClick={(event) => {
              if (!ctaTarget.startsWith('#')) return;
              const target = document.getElementById(ctaTarget.slice(1));
              if (!target) return;
              event.preventDefault();
              target.scrollIntoView({
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
                block: 'start',
              });
            }}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-button bg-primary-600 px-5 py-2.5 font-semibold text-white shadow-soft transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            {t('verification.cta')}
            <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
