import { useTranslation } from 'react-i18next';
import { LEGAL } from '../../config/legal';

interface ReportBusinessLinkProps {
  businessName: string;
}

export function ReportBusinessLink({ businessName }: ReportBusinessLinkProps) {
  const { t } = useTranslation();
  const pageUrl = window.location.href;
  const message = t('safety.report.prefill', { businessName, pageUrl });
  const digits = LEGAL.contactWhatsapp.replace(/\D/g, '');
  const whatsappHref = digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
    : null;
  const emailHref = LEGAL.contactEmail
    ? `mailto:${LEGAL.contactEmail}?subject=${encodeURIComponent(
        t('safety.report.mailSubject', { businessName }),
      )}&body=${encodeURIComponent(
        t('safety.report.mailBody', { businessName, pageUrl }),
      )}`
    : null;
  const href = whatsappHref ?? emailHref;

  if (!href) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <a
        href={href}
        {...(whatsappHref ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        className="rounded-sm text-sm text-navy-600 underline underline-offset-2 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        {t('safety.report.linkLabel')}
      </a>
      <span className="text-xs text-navy-500">{t('safety.report.notEmergency')}</span>
    </div>
  );
}
