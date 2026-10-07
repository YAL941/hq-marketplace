import { useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PrivacyPolicyPage } from '../PrivacyPolicy';
import { SafetyGuidelinesPage } from '../SafetyGuidelines';
import { TermsOfServicePage } from '../TermsOfService';

export type LegalDoc = 'faq' | 'privacy' | 'safety' | 'terms';

interface LegalPageProps {
  doc: LegalDoc;
}

export function LegalPage({ doc }: LegalPageProps) {
  const { t } = useTranslation();
  const pageTitle = t(`${doc}.title`);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = t('legal.documentTitle', {
      pageTitle,
      siteName: t('legal.siteName'),
    });
    return () => {
      document.title = previousTitle;
    };
  }, [pageTitle, t]);

  if (doc === 'privacy') return <PrivacyPolicyPage />;
  if (doc === 'safety') return <SafetyGuidelinesPage />;
  if (doc === 'terms') return <TermsOfServicePage />;

  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-8 text-start sm:px-6 sm:py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-bold leading-tight text-navy-900 sm:text-4xl">
          {pageTitle}
        </h1>
        <p className="mt-3 leading-7 text-navy-600">{t('faq.subtitle')}</p>
      </header>

      <section aria-labelledby="faq-visitors" className="mb-10">
        <h2 id="faq-visitors" className="mb-4 text-xl font-semibold text-navy-900">
          {t('faq.visitorsTitle')}
        </h2>
        <div className="space-y-3">
          <FaqItem question={t('faq.q1Question')} answer={t('faq.q1Answer')} />
          <FaqItem
            question={t('faq.q2Question')}
            answer={t('faq.q2Answer')}
            link={{ to: '/explore', label: t('faq.openDirectory') }}
          />
        </div>
      </section>

      <section aria-labelledby="faq-owners">
        <h2 id="faq-owners" className="mb-4 text-xl font-semibold text-navy-900">
          {t('faq.ownersTitle')}
        </h2>
        <div className="space-y-3">
          <FaqItem
            question={t('faq.q3Question')}
            answer={t('faq.q3Answer')}
            link={{ to: '/list-your-business', label: t('faq.listYourBusiness') }}
          />
          <FaqItem
            question={t('faq.q4Question')}
            answer={t('faq.q4Answer')}
            link={{ to: '/dashboard', label: t('faq.openDashboard') }}
          />
        </div>
      </section>
    </article>
  );
}

interface FaqItemProps {
  question: string;
  answer: string;
  link?: {
    to: string;
    label: string;
  };
}

function FaqItem({ question, answer, link }: FaqItemProps) {
  return (
    <details className="group rounded-2xl border border-[#D9E6F4] bg-white">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-2xl p-4 text-start font-medium text-navy-900 marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
        <span className="flex-1">{question}</span>
        <ChevronDown
          aria-hidden="true"
          className="ms-auto h-5 w-5 shrink-0 text-primary-600 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="px-4 pb-4 leading-7 text-navy-700">
        <p>{answer}</p>
        {link && (
          <Link
            to={link.to}
            className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            {link.label}
          </Link>
        )}
      </div>
    </details>
  );
}
