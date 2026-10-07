import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LegalLayout, type LegalSection } from '../components/legal/LegalLayout';
import { LEGAL } from '../config/legal';

function translationStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected an array for translation ${key}`);
  }

  const strings: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new Error(`Expected string items in translation array ${key}`);
    }
    strings.push(item);
  }
  return strings;
}

export function TermsOfServicePage() {
  const { t } = useTranslation();
  const summaryItems = translationStringArray(
    t('terms.summaryItems', { returnObjects: true }),
    'terms.summaryItems',
  );
  const prohibitedItems = translationStringArray(
    t('terms.sections.prohibited.items', { returnObjects: true }),
    'terms.sections.prohibited.items',
  );
  const contactChannels = [LEGAL.contactEmail, LEGAL.contactWhatsapp].filter(Boolean);
  const contactDetails = contactChannels.length > 0
    ? contactChannels.join(' · ')
    : t('terms.fallback.contactDetails');
  const missingItems = [
    !LEGAL.entityName && t('terms.draft.missing.entityName'),
    !LEGAL.contactEmail && t('terms.draft.missing.contactEmail'),
    !LEGAL.contactWhatsapp && t('terms.draft.missing.contactWhatsapp'),
    !LEGAL.effectiveDate && t('terms.draft.missing.effectiveDate'),
    !LEGAL.minimumAge && t('terms.draft.missing.minimumAge'),
    !LEGAL.governingLaw && t('terms.draft.missing.governingLaw'),
    !LEGAL.disputeResolution && t('terms.draft.missing.disputeResolution'),
  ].filter((item): item is string => Boolean(item));

  const sections: LegalSection[] = [
    {
      id: 'acceptance',
      title: t('terms.sections.acceptance.title'),
      content: <p>{t('terms.sections.acceptance.body')}</p>,
    },
    {
      id: 'service',
      title: t('terms.sections.service.title'),
      content: <p>{t('terms.sections.service.body')}</p>,
    },
    {
      id: 'eligibility',
      title: t('terms.sections.eligibility.title'),
      content: (
        <>
          <p>{t('terms.sections.eligibility.body')}</p>
          <p>
            {LEGAL.minimumAge
              ? t('terms.sections.eligibility.minimumAge', { minimumAge: LEGAL.minimumAge })
              : t('terms.sections.eligibility.minimumAgeFallback')}
          </p>
        </>
      ),
    },
    {
      id: 'content',
      title: t('terms.sections.content.title'),
      content: <p>{t('terms.sections.content.body')}</p>,
    },
    {
      id: 'licence',
      title: t('terms.sections.licence.title'),
      content: <p>{t('terms.sections.licence.body')}</p>,
    },
    {
      id: 'reviews',
      title: t('terms.sections.reviews.title'),
      content: <p>{t('terms.sections.reviews.body')}</p>,
    },
    {
      id: 'prohibited',
      title: t('terms.sections.prohibited.title'),
      content: (
        <>
          <p>{t('terms.sections.prohibited.intro')}</p>
          <ul className="list-inside list-disc space-y-2">
            {prohibitedItems.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </>
      ),
    },
    {
      id: 'enforcement',
      title: t('terms.sections.enforcement.title'),
      content: <p>{t('terms.sections.enforcement.body')}</p>,
    },
    {
      id: 'dealings',
      title: t('terms.sections.dealings.title'),
      content: <p>{t('terms.sections.dealings.body')}</p>,
    },
    {
      id: 'fees',
      title: t('terms.sections.fees.title'),
      content: <p>{t('terms.sections.fees.body')}</p>,
    },
    {
      id: 'availability',
      title: t('terms.sections.availability.title'),
      content: <p>{t('terms.sections.availability.body')}</p>,
    },
    {
      id: 'disclaimers',
      title: t('terms.sections.disclaimers.title'),
      content: <p>{t('terms.sections.disclaimers.body')}</p>,
    },
    {
      id: 'liability',
      title: t('terms.sections.liability.title'),
      content: <p>{t('terms.sections.liability.body')}</p>,
    },
    {
      id: 'termination',
      title: t('terms.sections.termination.title'),
      content: <p>{t('terms.sections.termination.body')}</p>,
    },
    {
      id: 'intellectual-property',
      title: t('terms.sections.intellectualProperty.title'),
      content: <p>{t('terms.sections.intellectualProperty.body')}</p>,
    },
    {
      id: 'changes',
      title: t('terms.sections.changes.title'),
      content: <p>{t('terms.sections.changes.body')}</p>,
    },
    {
      id: 'governing-law',
      title: t('terms.sections.governing.title'),
      content: (
        <p>
          {t('terms.sections.governing.body', {
            governingLaw: LEGAL.governingLaw || t('terms.fallback.governingLaw'),
            disputeResolution: LEGAL.disputeResolution || t('terms.fallback.disputeResolution'),
          })}
        </p>
      ),
    },
    {
      id: 'general',
      title: t('terms.sections.general.title'),
      content: <p>{t('terms.sections.general.body')}</p>,
    },
    {
      id: 'contact',
      title: t('terms.sections.contact.title'),
      content: (
        <p>
          {LEGAL.entityName && contactChannels.length > 0
            ? t('terms.sections.contact.body', { entityName: LEGAL.entityName, contactDetails })
            : t('terms.sections.contact.fallback', { contactDetails })}
        </p>
      ),
    },
  ];

  return (
    <LegalLayout
      title={t('terms.title')}
      lastUpdatedLabel={t('terms.lastUpdated')}
      lastUpdatedFallback={t('terms.dateFallback')}
      tableOfContentsLabel={t('terms.tableOfContents')}
      intro={(
        <>
          <p>{t('terms.intro')}</p>
          <div className="mt-8 rounded-2xl border border-primary-200 bg-primary-50 p-5 print:border-black print:bg-white">
            <h2 className="text-lg font-semibold text-navy-900 print:text-black">
              {t('terms.summaryTitle')}
            </h2>
            <ul className="mt-3 list-inside list-disc space-y-2 leading-7 text-navy-800 print:text-black">
              {summaryItems.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <nav aria-label={t('terms.tableOfContents')} className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
              <Link
                to="/privacy"
                className="text-primary-700 underline underline-offset-2 hover:text-primary-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                {t('footer.privacyPolicy')}
              </Link>
              <Link
                to="/safety"
                className="text-primary-700 underline underline-offset-2 hover:text-primary-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                {t('footer.safetyGuidelines')}
              </Link>
            </nav>
          </div>
        </>
      )}
      draftNotice={{
        title: t('terms.draft.title'),
        description: t('terms.draft.description'),
        missingLabel: t('terms.draft.missingLabel'),
        missingItems,
      }}
      sections={sections}
    />
  );
}
