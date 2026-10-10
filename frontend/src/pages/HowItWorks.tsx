import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Building2, Search, MessageCircle } from 'lucide-react';
import { Card } from '../components/common/Card';

const STEPS = [
  { key: 'search', Icon: Search },
  { key: 'compare', Icon: Building2 },
  { key: 'contact', Icon: MessageCircle },
] as const;

export function HowItWorksPage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-navy-50">
      <section className="bg-white border-b border-navy-200">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="font-semibold text-primary-700">{t('about.eyebrow')}</p>
          <h1 className="mt-2 text-3xl font-bold text-navy-900 sm:text-4xl">{t('about.title')}</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-navy-600">{t('about.intro')}</p>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-5 px-4 py-10 sm:px-6 md:grid-cols-3 lg:px-8">
        {STEPS.map(({ key, Icon }, index) => (
          <Card key={key} className="p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
              <Icon className="h-6 w-6" aria-hidden="true" />
            </div>
            <p className="mt-5 text-sm font-semibold text-primary-700">
              {t('about.stepLabel', { number: index + 1 })}
            </p>
            <h2 className="mt-1 text-lg font-bold text-navy-900">{t(`about.${key}Title`)}</h2>
            <p className="mt-2 leading-7 text-navy-600">{t(`about.${key}Body`)}</p>
          </Card>
        ))}
      </section>

      <section className="mx-auto grid max-w-5xl gap-5 px-4 pb-12 sm:px-6 md:grid-cols-2 lg:px-8">
        <Card className="p-6">
          <h2 className="text-xl font-bold text-navy-900">{t('about.ownersTitle')}</h2>
          <p className="mt-2 leading-7 text-navy-600">{t('about.ownersBody')}</p>
          <Link
            to="/list-your-business"
            className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-button bg-primary-600 px-4 py-2 font-medium text-white shadow-soft transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            {t('nav.listYourBusiness')} <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </Link>
        </Card>
        <Card className="p-6">
          <h2 className="text-xl font-bold text-navy-900">{t('about.trustTitle')}</h2>
          <p className="mt-2 leading-7 text-navy-600">{t('about.trustBody')}</p>
          <Link
            to="/safety"
            className="mt-5 inline-flex min-h-10 items-center font-medium text-primary-700 underline underline-offset-4"
          >
            {t('about.safetyLink')}
          </Link>
        </Card>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-12 sm:px-6 lg:px-8">
        <div className="rounded-2xl bg-navy-900 p-6 text-white sm:flex sm:items-center sm:justify-between sm:gap-8 sm:p-8">
          <div>
            <h2 className="text-xl font-bold">{t('about.browseTitle')}</h2>
            <p className="mt-2 text-navy-200">{t('about.browseBody')}</p>
          </div>
          <Link
            to="/explore"
            className="mt-5 inline-flex min-h-10 shrink-0 items-center justify-center rounded-button bg-gold-400 px-4 py-2 font-medium text-navy-900 shadow-soft transition-colors hover:bg-gold-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 sm:mt-0"
          >
            {t('nav.explore')}
          </Link>
        </div>
      </section>
    </div>
  );
}
