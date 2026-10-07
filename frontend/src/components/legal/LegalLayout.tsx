import type { ReactNode } from 'react';
import { LEGAL } from '../../config/legal';

export interface LegalSection {
  id: string;
  title: string;
  content: ReactNode;
}

interface DraftNotice {
  title: string;
  description: string;
  missingLabel: string;
  missingItems: string[];
}

interface LegalLayoutProps {
  title: string;
  lastUpdatedLabel: string;
  lastUpdatedFallback: string;
  tableOfContentsLabel: string;
  intro?: ReactNode;
  draftNotice?: DraftNotice;
  sections: LegalSection[];
}

export function LegalLayout({
  title,
  lastUpdatedLabel,
  lastUpdatedFallback,
  tableOfContentsLabel,
  intro,
  draftNotice,
  sections,
}: LegalLayoutProps) {
  const missingItems = draftNotice?.missingItems ?? [];

  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-8 text-start sm:px-6 sm:py-12 print:max-w-none print:px-0 print:py-0 print:text-black">
      <header className="mb-8 border-b border-navy-200 pb-6 print:border-navy-400">
        <h1 className="text-3xl font-bold leading-tight text-navy-900 print:text-black sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 text-sm text-navy-600 print:text-black">
          {lastUpdatedLabel}: {LEGAL.effectiveDate || lastUpdatedFallback}
        </p>
      </header>

      {draftNotice && missingItems.length > 0 && (
        <aside
          className="mb-8 rounded-xl border border-gold-300 bg-gold-50 p-4 text-navy-900 print:border-black print:bg-white"
          role="alert"
        >
          <h2 className="font-semibold">{draftNotice.title}</h2>
          <p className="mt-1 leading-6">{draftNotice.description}</p>
          <p className="mt-3 font-medium">{draftNotice.missingLabel}</p>
          <ul className="mt-1 list-inside list-disc space-y-1 leading-6">
            {missingItems.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </aside>
      )}

      {intro && (
        <div className="mb-8 leading-7 text-navy-700 print:text-black">
          {intro}
        </div>
      )}

      <nav
        aria-label={tableOfContentsLabel}
        className="mb-10 rounded-xl border border-navy-200 bg-white p-5 print:hidden"
      >
        <h2 className="font-semibold text-navy-900">{tableOfContentsLabel}</h2>
        <ol className="mt-3 list-inside list-decimal space-y-2 text-primary-700">
          {sections.map(({ id, title: sectionTitle }) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="rounded-sm underline decoration-primary-200 underline-offset-2 hover:text-primary-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                {sectionTitle}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="space-y-8">
        {sections.map(({ id, title: sectionTitle, content }) => (
          <section key={id} id={id} className="scroll-mt-24">
            <h2 className="mb-3 text-xl font-semibold leading-snug text-navy-900 print:text-black">
              {sectionTitle}
            </h2>
            <div className="space-y-3 leading-7 text-navy-700 print:text-black">
              {content}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
