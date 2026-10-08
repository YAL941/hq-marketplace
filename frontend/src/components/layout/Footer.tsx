import { HTMLAttributes, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Link } from 'react-router-dom';
import { Facebook, Twitter, Instagram, Linkedin } from 'lucide-react';
import { Logo } from '../branding/Logo';
import { SOCIAL_LINKS, COOKIE_POLICY_URL } from '../../config/links';

/** The icon each configured social network renders with. */
const SOCIAL_ICONS = {
  facebook: Facebook,
  twitter: Twitter,
  instagram: Instagram,
  linkedin: Linkedin,
} as const;

interface FooterProps extends HTMLAttributes<HTMLElement> {}

export const Footer = forwardRef<HTMLElement, FooterProps>(
  ({ className, ...props }, ref) => {
    const { t } = useTranslation();
    // Category names are server data and stay untranslated, so only the
    // section headings and the surrounding chrome are translated here.
    const exploreLinks = [
      { to: '/explore', label: t('footer.allBusinesses') },
      { to: '/categories', label: t('nav.categories') },
      { to: '/explore?sort=rating', label: t('footer.topRated') },
      { to: '/explore?sort=newest', label: t('footer.newBusinesses') },
    ];
    const categoryLinks = [
      { to: '/categories/healthcare', label: t('footer.healthcare') },
      { to: '/categories/restaurants', label: t('footer.restaurants') },
      { to: '/categories/hotels', label: t('footer.hotels') },
      { to: '/categories/beauty-wellness', label: t('footer.beautyWellness') },
    ];
    const supportLinks = [
      { to: '/faq', label: t('footer.faq') },
      { to: '/safety', label: t('footer.safetyGuidelines') },
      { to: '/privacy', label: t('footer.privacyPolicy') },
      { to: '/terms', label: t('footer.termsOfService') },
    ];
    const socials = SOCIAL_LINKS.filter(({ url }) => url !== '').map(
      ({ network, url }) => ({
        href: url,
        Icon: SOCIAL_ICONS[network],
        label: t(`footer.${network}`),
      }),
    );

    return (
      <footer
        ref={ref}
        className={cn('bg-navy-900 text-white py-12', className)}
        {...props}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8">
            <div className="lg:col-span-2">
              <Logo to="/" ariaLabel={t('brand.homeLabel')} variant="dark" size="md" className="mb-4" />
              <p className="text-navy-300 max-w-sm mb-6">{t('footer.about')}</p>
              {socials.length > 0 && (
                <div className="flex gap-4">
                  {socials.map(({ href, Icon, label }) => (
                    <a
                      key={label}
                      href={href}
                      className="text-navy-400 hover:text-white transition-colors"
                      aria-label={label}
                    >
                      <Icon className="w-5 h-5" />
                    </a>
                  ))}
                </div>
              )}
            </div>

            <FooterColumn title={t('footer.exploreTitle')} links={exploreLinks} />
            <FooterColumn title={t('footer.categoriesTitle')} links={categoryLinks} />
            <FooterColumn title={t('footer.supportTitle')} links={supportLinks} />
          </div>

          <div className="mt-12 pt-8 border-t border-navy-800 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-navy-400 text-sm">
              {t('footer.rightsReserved', { year: new Date().getFullYear() })}
            </p>
            <div className="flex gap-6 text-sm text-navy-400">
              <Link to="/privacy" className="hover:text-white transition-colors">{t('footer.privacyPolicy')}</Link>
              <Link to="/terms" className="hover:text-white transition-colors">{t('footer.termsOfService')}</Link>
              {COOKIE_POLICY_URL && (
                <a href={COOKIE_POLICY_URL} className="hover:text-white transition-colors">{t('footer.cookiePolicy')}</a>
              )}
            </div>
          </div>
        </div>
      </footer>
    );
  }
);

Footer.displayName = 'Footer';

interface FooterColumnProps {
  title: string;
  links: Array<{ to: string; label: string }>;
}

function FooterColumn({ title, links }: FooterColumnProps) {
  return (
    <div>
      <h4 className="font-semibold mb-4">{title}</h4>
      <ul className="space-y-2 text-navy-300">
        {links.map((link) => (
          <li key={link.label}>
            <Link to={link.to} className="hover:text-white transition-colors">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
