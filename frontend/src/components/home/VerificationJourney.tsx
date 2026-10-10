import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BellRing, Building2, Check, MailCheck, Pause, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import './VerificationJourney.css';

interface VerificationJourneyProps {
  ctaTarget?: string;
}

const STEPS = [
  { key: 'register', number: '01' },
  { key: 'review', number: '02' },
  { key: 'approval', number: '03' },
] as const;

export function VerificationJourney({
  ctaTarget = '/list-your-business',
}: VerificationJourneyProps) {
  const { t } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    if (!('IntersectionObserver' in window)) {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.18 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="verification-journey bg-navy-50 py-14 sm:py-20"
      aria-labelledby="verification-journey-title"
      data-animate={inView}
      data-paused={paused}
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

        <ol className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
          {STEPS.map(({ key, number }) => (
            <li key={key} className={`verification-card verification-card--${key} relative rounded-2xl bg-white p-5 shadow-card sm:p-6`}>
              <div className="verification-card__content">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-sm font-bold text-primary-700">
                    {number}
                  </span>
                  <span className="verification-step-label text-xs font-semibold uppercase tracking-wider text-navy-400">
                    {t('verification.step', { number: Number(number) })}
                  </span>
                </div>

                <div className="verification-scene mt-5 flex h-36 items-center justify-center rounded-xl bg-navy-50 p-4" aria-hidden="true">
                  {key === 'register' && (
                    <div className="verification-form">
                      <div className="verification-form__heading">
                        <Building2 size={17} />
                        <span>{t('verification.businessProfile')}</span>
                      </div>
                      <div className="verification-form__field">
                        <span>{t('verification.businessName')}</span>
                        <i />
                      </div>
                      <div className="verification-form__field verification-form__field--short">
                        <span>{t('verification.category')}</span>
                        <i />
                      </div>
                      <span className="verification-submit">{t('verification.submit')}</span>
                    </div>
                  )}
                  {key === 'review' && (
                    <div className="verification-review">
                      <div className="verification-review__top">
                        <span className="verification-bell"><BellRing size={19} /></span>
                        <span className="verification-count">1</span>
                        <span className="verification-pending">{t('verification.pending')}</span>
                      </div>
                      <div className="verification-review__business">
                        <span className="verification-building"><Building2 size={17} /></span>
                        <span className="verification-lines"><i /><i /></span>
                        <span className="verification-approve">{t('verification.approve')}</span>
                      </div>
                    </div>
                  )}
                  {key === 'approval' && (
                    <div className="verification-approved">
                      <span className="verification-active">
                        <Check className="verification-check" size={15} strokeWidth={3} />
                        {t('verification.active')}
                      </span>
                      <span className="verification-email">
                        <MailCheck size={21} />
                        <span>{t('verification.emailSent')}</span>
                      </span>
                    </div>
                  )}
                </div>

                <h3 className="mt-5 text-lg font-bold text-navy-900">{t(`verification.${key}Title`)}</h3>
                <p className="mt-2 text-sm leading-6 text-navy-600">{t(`verification.${key}Body`)}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-8 flex flex-col items-center gap-3">
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
            className="inline-flex min-h-11 items-center justify-center rounded-button bg-primary-600 px-5 py-2.5 font-semibold text-white shadow-soft transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            {t('verification.cta')}
          </Link>
          <button
            type="button"
            className="verification-toggle inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-navy-600 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            onClick={() => setPaused((current) => !current)}
          >
            {paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
            {paused ? t('verification.play') : t('verification.pause')}
          </button>
        </div>
      </div>
    </section>
  );
}
