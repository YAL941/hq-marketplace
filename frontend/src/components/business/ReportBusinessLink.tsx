import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

interface ReportBusinessLinkProps {
  businessName: string;
}

export function ReportBusinessLink({ businessName }: ReportBusinessLinkProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Link
        to={`/contact?businessName=${encodeURIComponent(businessName)}&pageUrl=${encodeURIComponent(window.location.href)}`}
        className="rounded-sm text-sm text-navy-600 underline underline-offset-2 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        {t('safety.report.linkLabel')}
      </Link>
      <span className="text-xs text-navy-500">{t('safety.report.notEmergency')}</span>
    </div>
  );
}
