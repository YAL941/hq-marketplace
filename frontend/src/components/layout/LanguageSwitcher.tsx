import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Globe } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_NAMES,
  SUPPORTED_LANGUAGES,
  directionFor,
  type SupportedLanguage,
} from '../../i18n';

interface LanguageSwitcherProps {
  className?: string;
  /**
   * `menu` is the desktop dropdown. `inline` is the stacked list used inside
   * the mobile drawer, where a floating popover would be clipped by the
   * overflow on the drawer.
   */
  variant?: 'menu' | 'inline';
}

export function LanguageSwitcher({ className, variant = 'menu' }: LanguageSwitcherProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const current = (i18n.resolvedLanguage ?? i18n.language) as SupportedLanguage;
  const currentName = LANGUAGE_NAMES[current] ?? LANGUAGE_NAMES[DEFAULT_LANGUAGE];

  // Close on outside click or Escape. Without this the menu stays open behind
  // whatever the user clicked next, which is worse than no menu at all.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const select = (language: SupportedLanguage) => {
    void i18n.changeLanguage(language);
    setOpen(false);
  };

  if (variant === 'inline') {
    return (
      <div className={cn('space-y-1', className)} role="group" aria-label={t('language.change')}>
        <p className="px-3 pt-2 pb-1 text-xs font-medium uppercase tracking-wide text-navy-500">
          {t('language.label')}
        </p>
        {SUPPORTED_LANGUAGES.map((language) => (
          <button
            key={language}
            type="button"
            onClick={() => select(language)}
            aria-current={language === current ? 'true' : undefined}
            lang={language}
            className={cn(
              'w-full flex items-center justify-between px-3 py-2 rounded-button text-sm transition-colors',
              language === current
                ? 'bg-primary-50 text-primary-600 font-medium'
                : 'text-navy-700 hover:bg-navy-50'
            )}
          >
            <span>{LANGUAGE_NAMES[language]}</span>
            {language === current && <Check className="w-4 h-4" aria-hidden="true" />}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={t('language.change')}
        title={t('language.current', { language: currentName })}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-button text-sm font-medium text-navy-700 hover:bg-navy-100 transition-colors"
      >
        <Globe className="w-4 h-4" aria-hidden="true" />
        <span>{currentName}</span>
        <ChevronDown
          className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={t('language.label')}
          // Anchored to the inline end so it opens away from the edge in both
          // text directions instead of hanging off the screen in RTL.
          className="absolute end-0 mt-2 w-44 bg-white rounded-card shadow-card border border-navy-200 py-1 z-50"
        >
          {SUPPORTED_LANGUAGES.map((language) => (
            <li key={language} role="option" aria-selected={language === current}>
              <button
                type="button"
                onClick={() => select(language)}
                lang={language}
                // Each option is tagged with its own lang so a screen reader
                // switches pronunciation for "Soomaali" but not for "العربية"
                // read through an English voice.
                dir={directionFor(language)}
                className={cn(
                  'w-full flex items-center justify-between gap-2 px-3 py-2 text-sm transition-colors',
                  language === current
                    ? 'bg-primary-50 text-primary-600 font-medium'
                    : 'text-navy-700 hover:bg-navy-50'
                )}
              >
                <span>{LANGUAGE_NAMES[language]}</span>
                {language === current && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
