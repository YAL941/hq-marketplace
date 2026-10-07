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

export function PrivacyPolicyPage() {
  const { t } = useTranslation();
  const collectedItems = translationStringArray(
    t('privacy.sections.information.items', { returnObjects: true }),
    'privacy.sections.information.items',
  );
  const missingItems = [
    !LEGAL.entityName && t('privacy.draft.missing.entityName'),
    !LEGAL.contactEmail && t('privacy.draft.missing.contactEmail'),
    !LEGAL.contactWhatsapp && t('privacy.draft.missing.contactWhatsapp'),
    !LEGAL.effectiveDate && t('privacy.draft.missing.effectiveDate'),
    !LEGAL.retentionPeriod && t('privacy.draft.missing.retentionPeriod'),
    !LEGAL.minimumAge && t('privacy.draft.missing.minimumAge'),
  ].filter((item): item is string => Boolean(item));

  const contactChannels = [LEGAL.contactEmail, LEGAL.contactWhatsapp].filter(Boolean);
  const contactDetails = contactChannels.length > 0
    ? contactChannels.join(' · ')
    : t('privacy.fallback.contactDetails');
  const retentionContent = LEGAL.retentionPeriod
    ? t('privacy.sections.retention.body', { retentionPeriod: LEGAL.retentionPeriod })
    : t('privacy.sections.retention.fallback');
  const childrenContent = LEGAL.minimumAge
    ? t('privacy.sections.children.body', { minimumAge: LEGAL.minimumAge })
    : t('privacy.sections.children.fallback');
  const contactContent = LEGAL.entityName && contactChannels.length > 0
    ? t('privacy.sections.contact.body', {
        entityName: LEGAL.entityName,
        contactDetails,
      })
    : t('privacy.sections.contact.fallback', {
        entityName: LEGAL.entityName || t('privacy.fallback.entityName'),
      });
  const choicesContent = contactChannels.length > 0
    ? t('privacy.sections.choices.body', { contactDetails })
    : t('privacy.sections.choices.fallback');

  const sections: LegalSection[] = [
    {
      id: 'information',
      title: t('privacy.sections.information.title'),
      content: (
        <ul className="list-inside list-disc space-y-2">
          {collectedItems.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
        </ul>
      ),
    },
    {
      id: 'use',
      title: t('privacy.sections.use.title'),
      content: <p>{t('privacy.sections.use.body')}</p>,
    },
    {
      id: 'public',
      title: t('privacy.sections.public.title'),
      content: <p>{t('privacy.sections.public.body')}</p>,
    },
    {
      id: 'sharing',
      title: t('privacy.sections.sharing.title'),
      content: <p>{t('privacy.sections.sharing.body')}</p>,
    },
    {
      id: 'security',
      title: t('privacy.sections.security.title'),
      content: <p>{t('privacy.sections.security.body')}</p>,
    },
    {
      id: 'retention',
      title: t('privacy.sections.retention.title'),
      content: <p>{retentionContent}</p>,
    },
    {
      id: 'choices',
      title: t('privacy.sections.choices.title'),
      content: <p>{choicesContent}</p>,
    },
    {
      id: 'children',
      title: t('privacy.sections.children.title'),
      content: <p>{childrenContent}</p>,
    },
    {
      id: 'changes',
      title: t('privacy.sections.changes.title'),
      content: <p>{t('privacy.sections.changes.body')}</p>,
    },
    {
      id: 'contact',
      title: t('privacy.sections.contact.title'),
      content: <p>{contactContent}</p>,
    },
  ];

  return (
    <LegalLayout
      title={t('privacy.title')}
      lastUpdatedLabel={t('privacy.lastUpdated')}
      lastUpdatedFallback={t('privacy.dateFallback')}
      tableOfContentsLabel={t('privacy.tableOfContents')}
      intro={(
        <>
          <p>{t('privacy.intro')}</p>
          <p className="mt-4">
            <Link
              to="/terms"
              className="text-primary-700 underline underline-offset-2 hover:text-primary-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              {t('footer.termsOfService')}
            </Link>
          </p>
        </>
      )}
      draftNotice={{
        title: t('privacy.draft.title'),
        description: t('privacy.draft.description'),
        missingLabel: t('privacy.draft.missingLabel'),
        missingItems,
      }}
      sections={sections}
    />
  );
}
