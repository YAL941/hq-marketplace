import { useTranslation } from 'react-i18next';
import { useSearchParams, Link } from 'react-router-dom';
import { Mail, MessageCircle, ShieldCheck } from 'lucide-react';
import { Card } from '../components/common/Card';
import { LEGAL } from '../config/legal';

export function ContactPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const businessName = params.get('businessName') ?? '';
  const pageUrl = params.get('pageUrl') ?? '';
  const reportSubject = t('safety.report.mailSubject', { businessName: businessName || t('contact.generalSubject') });
  const reportBody = t('safety.report.mailBody', {
    businessName: businessName || t('contact.generalSubject'),
    pageUrl: pageUrl || window.location.origin,
  });
  const emailUrl = LEGAL.contactEmail
    ? `mailto:${LEGAL.contactEmail}?subject=${encodeURIComponent(reportSubject)}&body=${encodeURIComponent(reportBody)}`
    : null;
  const whatsappDigits = LEGAL.contactWhatsapp.replace(/\D/g, '');
  const whatsappUrl = whatsappDigits
    ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(`${reportSubject}\n\n${reportBody}`)}`
    : null;

  return (
    <div className="min-h-[65vh] bg-navy-50 px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <p className="font-semibold text-primary-700">{t('contact.eyebrow')}</p>
        <h1 className="mt-2 text-3xl font-bold text-navy-900">{t('contact.title')}</h1>
        <p className="mt-3 leading-7 text-navy-600">
          {businessName ? t('contact.reportIntro', { businessName }) : t('contact.intro')}
        </p>
        <Card className="mt-7 p-6 sm:p-8">
          {(emailUrl || whatsappUrl) ? (
            <div className="flex flex-wrap gap-3">
              {emailUrl && (
                <a
                  href={emailUrl}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-button bg-primary-600 px-4 py-2 font-medium text-white shadow-soft transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                >
                  <Mail className="h-4 w-4" aria-hidden="true" />{t('contact.email')}
                </a>
              )}
              {whatsappUrl && (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow ugc"
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-button border-2 border-navy-300 px-4 py-2 font-medium text-navy-700 transition-colors hover:bg-navy-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                >
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />{t('contact.whatsapp')}
                </a>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-gold-200 bg-gold-50 p-4 text-navy-800" role="status">
              <p className="font-semibold">{t('contact.unavailableTitle')}</p>
              <p className="mt-1 text-sm leading-6">{t('contact.unavailableBody')}</p>
            </div>
          )}
          <div className="mt-6 border-t border-navy-100 pt-5">
            <h2 className="flex items-center gap-2 font-semibold text-navy-900">
              <ShieldCheck className="h-5 w-5 text-primary-600" aria-hidden="true" />
              {t('contact.reportTitle')}
            </h2>
            <p className="mt-2 text-sm leading-6 text-navy-600">{t('contact.reportFollowUp')}</p>
          </div>
        </Card>
        <p className="mt-5 text-sm text-navy-600">
          {t('contact.moreHelp')}{' '}
          <Link to="/faq" className="font-medium text-primary-700 underline underline-offset-2">{t('footer.faq')}</Link>
        </p>
      </div>
    </div>
  );
}
