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

function guidanceItems(
  t: ReturnType<typeof useTranslation>['t'],
  audience: 'visitors' | 'owners',
  names: readonly string[],
) {
  return names.map((name) => ({
    title: t(`safety.sections.${audience}.items.${name}.title`),
    body: t(`safety.sections.${audience}.items.${name}.body`),
  }));
}

export function SafetyGuidelinesPage() {
  const { t } = useTranslation();
  const contactChannels = [LEGAL.contactEmail, LEGAL.contactWhatsapp].filter(Boolean);
  const contactDetails = contactChannels.length > 0
    ? contactChannels.join(' · ')
    : t('safety.fallback.contactDetails');
  const summaryItems = translationStringArray(
    t('safety.summaryItems', { returnObjects: true }),
    'safety.summaryItems',
  );
  const missingItems = [
    !LEGAL.contactEmail && t('safety.draft.missing.contactEmail'),
    !LEGAL.contactWhatsapp && t('safety.draft.missing.contactWhatsapp'),
    !LEGAL.effectiveDate && t('safety.draft.missing.effectiveDate'),
  ].filter((item): item is string => Boolean(item));
  const visitorItems = guidanceItems(t, 'visitors', [
    'check',
    'payments',
    'warningSigns',
    'meeting',
    'emergencies',
  ]);
  const ownerItems = guidanceItems(t, 'owners', [
    'accurate',
    'honesty',
    'reviews',
    'account',
    'customers',
    'actions',
  ]);

  const sections: LegalSection[] = [
    {
      id: 'visitors',
      title: t('safety.sections.visitors.title'),
      content: (
        <>
          {visitorItems.map(({ title, body }) => (
            <section key={title} className="space-y-2">
              <h3 className="text-lg font-semibold leading-snug text-navy-900 print:text-black">
                {title}
              </h3>
              <p>{body}</p>
            </section>
          ))}
          <section className="space-y-2">
            <h3 className="text-lg font-semibold leading-snug text-navy-900 print:text-black">
              {t('safety.sections.visitors.items.report.title')}
            </h3>
            <p>
              {contactChannels.length > 0
                ? t('safety.report.reportInstructions', { contactDetails })
                : t('safety.report.noContact')}
            </p>
            <p className="font-medium">{t('safety.report.notEmergency')}</p>
          </section>
        </>
      ),
    },
    {
      id: 'business-owners',
      title: t('safety.sections.owners.title'),
      content: (
        <>
          {ownerItems.map(({ title, body }) => (
            <section key={title} className="space-y-2">
              <h3 className="text-lg font-semibold leading-snug text-navy-900 print:text-black">
                {title}
              </h3>
              <p>{body}</p>
            </section>
          ))}
        </>
      ),
    },
  ];

  return (
    <LegalLayout
      title={t('safety.title')}
      lastUpdatedLabel={t('safety.lastUpdated')}
      lastUpdatedFallback={t('safety.dateFallback')}
      tableOfContentsLabel={t('safety.tableOfContents')}
      intro={(
        <>
          <p>{t('safety.intro')}</p>
          <div className="mt-8 rounded-2xl border border-primary-200 bg-primary-50 p-5 print:border-black print:bg-white">
            <h2 className="text-lg font-semibold text-navy-900 print:text-black">
              {t('safety.summaryTitle')}
            </h2>
            <ul className="mt-3 list-inside list-decimal space-y-2 leading-7 text-navy-800 print:text-black">
              {summaryItems.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <Link
              to="/terms"
              className="mt-4 inline-block text-primary-700 underline underline-offset-2 hover:text-primary-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 print:hidden"
            >
              {t('footer.termsOfService')}
            </Link>
          </div>
        </>
      )}
      draftNotice={{
        title: t('safety.draft.title'),
        description: t('safety.draft.description'),
        missingLabel: t('safety.draft.missingLabel'),
        missingItems,
      }}
      sections={sections}
    />
  );
}
