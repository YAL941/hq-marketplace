import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, Check, ChevronDown, MapPin, Search, X } from 'lucide-react';
import { CategoryBar } from '../common/CategoryBar';
import { CategoryIcon } from '../common/CategoryIcon';
import { useCategories } from '../../hooks/useCategories';
import { businessApi } from '../../services/api';
import type { PublicBusinessCard, PublicCategory, PublicCity } from '../../types';

interface HeroSearchProps {
  cities?: PublicCity[];
  children?: ReactNode;
}

export function HeroSearch({ cities = [], children }: HeroSearchProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { categories, loading: categoriesLoading, error: categoriesError, retry } = useCategories();
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<PublicCategory | null>(null);
  const [selectedCity, setSelectedCity] = useState('');
  const [listboxOpen, setListboxOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<PublicBusinessCard[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState(false);
  const searchId = useId();
  const listboxId = useId();
  const suggestionsId = useId();
  const controlsRef = useRef<HTMLDivElement>(null);
  const categoryButtonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const options = [null, ...categories] as const;
  const searchTerm = query.trim().toLocaleLowerCase();
  const matchingCategories = searchTerm.length >= 2
    ? categories.filter((category) =>
        `${category.category_name} ${category.category_slug}`.toLocaleLowerCase().includes(searchTerm),
      ).slice(0, 3)
    : [];
  const matchingCities = searchTerm.length >= 2
    ? cities.filter((city) => city.city.toLocaleLowerCase().includes(searchTerm)).slice(0, 3)
    : [];

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      setSuggestionsError(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSuggestionsLoading(true);
      setSuggestionsError(false);
      void businessApi.listPublic({
        q: term,
        category: selectedCategory?.category_slug,
        city: selectedCity || undefined,
        limit: 5,
      }).then((response) => {
        if (!cancelled) setSuggestions(response.data.data);
      }).catch(() => {
        if (!cancelled) {
          setSuggestions([]);
          setSuggestionsError(true);
        }
      }).finally(() => {
        if (!cancelled) setSuggestionsLoading(false);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, selectedCategory?.category_slug, selectedCity]);

  useEffect(() => {
    if (!listboxOpen) return;
    const selectedIndex = selectedCategory
      ? categories.findIndex((category) => category.category_id === selectedCategory.category_id) + 1
      : 0;
    const nextIndex = selectedIndex >= 0 ? selectedIndex : 0;
    optionRefs.current[nextIndex]?.focus();
  }, [categories, listboxOpen, selectedCategory]);

  useEffect(() => {
    if (!listboxOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !controlsRef.current?.contains(event.target)) {
        setListboxOpen(false);
        setSuggestionsOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [listboxOpen]);

  const openListbox = () => setListboxOpen(true);

  const closeListbox = (restoreFocus = false) => {
    setListboxOpen(false);
    setSuggestionsOpen(false);
    if (restoreFocus) categoryButtonRef.current?.focus();
  };

  const chooseCategory = (category: PublicCategory | null) => {
    setSelectedCategory(category);
    closeListbox(true);
  };

  const moveOptionFocus = (index: number) => {
    const nextIndex = (index + options.length) % options.length;
    optionRefs.current[nextIndex]?.focus();
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveOptionFocus(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveOptionFocus(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveOptionFocus(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveOptionFocus(options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      chooseCategory(options[index]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeListbox(true);
    }
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    const trimmedQuery = query.trim();
    if (trimmedQuery) params.set('q', trimmedQuery);
    if (selectedCategory) params.set('category', selectedCategory.category_slug);
    if (selectedCity) params.set('city', selectedCity);
    const queryString = params.toString();
    navigate(`/explore${queryString ? `?${queryString}` : ''}`);
  };

  const chooseSuggestionCity = (city: string) => {
    setSelectedCity(city);
    setSuggestionsOpen(false);
  };

  return (
    <section data-home-hero="" className="relative isolate flex min-h-[560px] w-full min-w-0 items-center justify-center overflow-hidden bg-[linear-gradient(135deg,#0B3A78_0%,#1769C4_55%,#2F8FF0_100%)] px-4 py-16 text-white sm:px-6 sm:py-20 lg:min-h-[720px] lg:px-8">
      <div
        aria-hidden="true"
        className="hero-glow-float pointer-events-none absolute -start-[140px] -top-[170px] h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgba(120,190,255,0.75)_0%,rgba(120,190,255,0)_70%)] blur-[30px] scale-[0.6] sm:scale-100 sm:blur-[50px]"
      />
      <div
        aria-hidden="true"
        className="hero-glow-float hero-glow-float-delayed pointer-events-none absolute -end-[160px] -bottom-[200px] h-[680px] w-[680px] rounded-full bg-[radial-gradient(circle,#FFC83D_0%,rgba(255,200,61,0)_68%)] opacity-[0.65] blur-[30px] scale-[0.6] sm:scale-100 sm:blur-[60px]"
      />
      <div
        aria-hidden="true"
        className="hero-glow-float pointer-events-none absolute bottom-[-140px] start-[120px] h-[320px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(255,170,70,0.55)_0%,rgba(255,170,70,0)_70%)] blur-[30px] scale-[0.6] sm:scale-100 sm:blur-[55px]"
      />
      <div
        aria-hidden="true"
        className="hero-glow-float hero-glow-float-delayed pointer-events-none absolute start-1/2 top-[48%] h-[320px] w-[700px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.18)_0%,rgba(255,255,255,0)_70%)] blur-[30px] scale-[0.6] sm:scale-100 sm:blur-[40px] rtl:translate-x-1/2"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[70%] bg-[linear-gradient(180deg,rgba(11,42,74,0.72)_0%,rgba(11,42,74,0.48)_55%,rgba(11,42,74,0)_100%)]"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center text-center">
        <h1 className="max-w-[900px] text-balance font-brand text-[clamp(34px,5vw,60px)] font-bold leading-[1.1] tracking-[-0.02em]">
          {t('home.heroTitle')}
        </h1>
        <p className="mt-5 max-w-[640px] text-[clamp(16px,1.6vw,20px)] leading-[1.55] text-white/[0.95]">
          {t('home.heroSubtitle')}
        </p>

        <form
          role="search"
          onSubmit={submitSearch}
          className="mt-8 w-full max-w-[760px]"
        >
          <label htmlFor={searchId} className="sr-only">
            {t('home.heroSearchLabel')}
          </label>
          <div
            ref={controlsRef}
            onBlur={(event) => {
              const nextTarget = event.relatedTarget;
              if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                setListboxOpen(false);
                setSuggestionsOpen(false);
              }
            }}
            className="relative"
          >
            <div className="hero-search-glass flex h-[68px] min-w-0 items-center gap-2 rounded-[22px] border px-2 ps-3 pe-2 sm:gap-3 sm:ps-6">
              <Search className="h-6 w-6 shrink-0 text-white" aria-hidden="true" />
              {selectedCategory && (
                <span className="flex max-w-[72px] shrink-0 items-center gap-1 rounded-full border border-white/35 bg-white/15 py-1 ps-2 pe-1 text-xs text-white sm:max-w-[140px] sm:ps-3 sm:pe-2 sm:text-sm">
                  <span className="min-w-0 truncate">{selectedCategory.category_name}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedCategory(null)}
                    aria-label={t('home.heroRemoveCategory', { name: selectedCategory.category_name })}
                    className="rounded-full p-1 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 motion-reduce:transition-none"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </span>
              )}
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => {
                  if (query.trim().length >= 2) setSuggestionsOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' && suggestionsOpen) {
                    event.preventDefault();
                    document.getElementById(suggestionsId)?.querySelector<HTMLElement>('a, button')?.focus();
                  } else if (event.key === 'ArrowDown' && !listboxOpen) {
                    event.preventDefault();
                    openListbox();
                  } else if (event.key === 'Escape' && suggestionsOpen) {
                    event.preventDefault();
                    setSuggestionsOpen(false);
                  }
                }}
                aria-expanded={suggestionsOpen}
                aria-controls={suggestionsId}
                placeholder={t('home.heroSearchPlaceholder')}
                className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-start text-base text-white placeholder:text-white/[0.88] focus:outline-none focus:ring-0 sm:text-lg"
              />
              {cities.length > 0 && (
                <div className="flex h-11 w-[96px] shrink-0 items-center gap-1 rounded-full border border-white/25 bg-white/10 px-2 text-white sm:w-[148px] sm:gap-2 sm:px-3">
                  <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <label htmlFor={`${searchId}-city`} className="sr-only">
                    {t('home.heroCitiesLabel')}
                  </label>
                  <select
                    id={`${searchId}-city`}
                    value={selectedCity}
                    onChange={(event) => setSelectedCity(event.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-xs text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 sm:text-sm"
                  >
                    <option value="" className="text-navy-900">{t('home.heroAllCities')}</option>
                    {cities.map((city) => (
                      <option key={city.city} value={city.city} className="text-navy-900">
                        {city.city}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                ref={categoryButtonRef}
                type="button"
                aria-label={t('home.heroChooseCategory')}
                aria-haspopup="listbox"
                aria-expanded={listboxOpen}
                aria-controls={listboxId}
                onClick={() => listboxOpen ? closeListbox() : openListbox()}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openListbox();
                  } else if (event.key === 'Escape' && listboxOpen) {
                    event.preventDefault();
                    closeListbox();
                  }
                }}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-white/[0.18] text-white transition duration-150 hover:bg-white/[0.28] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B3A78] motion-reduce:transition-none"
              >
                <ChevronDown className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {listboxOpen && (
              <div
                className="absolute inset-x-0 top-full z-30 mt-2 max-h-72 overflow-y-auto rounded-2xl border border-white/40 bg-[#0B2A4A]/95 p-2 text-start shadow-2xl backdrop-blur-xl"
              >
                <div id={listboxId} role="listbox" aria-label={t('home.heroChooseCategory')}>
                  <div
                    ref={(element) => { optionRefs.current[0] = element; }}
                    role="option"
                    aria-selected={selectedCategory === null}
                    tabIndex={0}
                    onClick={() => chooseCategory(null)}
                    onKeyDown={(event) => handleOptionKeyDown(event, 0)}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-start text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                  >
                    <CategoryIcon slug={null} size="chip" />
                    <span className="flex-1">{t('home.heroAllCategories')}</span>
                    {selectedCategory === null && <Check className="h-4 w-4" aria-hidden="true" />}
                  </div>
                  {categories.map((category, index) => (
                    <div
                      key={category.category_id}
                      ref={(element) => { optionRefs.current[index + 1] = element; }}
                      role="option"
                      aria-selected={selectedCategory?.category_id === category.category_id}
                      tabIndex={0}
                      onClick={() => chooseCategory(category)}
                      onKeyDown={(event) => handleOptionKeyDown(event, index + 1)}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-start text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                    >
                      <CategoryIcon slug={category.category_slug} size="chip" />
                      <span className="flex-1">{category.category_name}</span>
                      {selectedCategory?.category_id === category.category_id && (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      )}

                      {suggestionsOpen && searchTerm.length >= 2 && !listboxOpen && (
                        <div
                          id={suggestionsId}
                          className="absolute inset-x-0 top-full z-20 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-white/30 bg-[#0B2A4A]/95 p-2 text-start shadow-2xl backdrop-blur-xl"
                        >
                          {matchingCategories.length > 0 && (
                            <div className="border-b border-white/15 pb-1">
                              {matchingCategories.map((category) => (
                                <Link
                                  key={category.category_id}
                                  to={`/categories/${category.category_slug}`}
                                  onClick={() => setSuggestionsOpen(false)}
                                  className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                                >
                                  <CategoryIcon slug={category.category_slug} size="chip" />
                                  <span className="flex-1">{category.category_name}</span>
                                  <span className="text-xs text-white/65">{t('home.heroCategorySuggestion')}</span>
                                </Link>
                              ))}
                            </div>
                          )}
                          {matchingCities.length > 0 && (
                            <div className="border-b border-white/15 py-1">
                              {matchingCities.map((city) => (
                                <button
                                  key={city.city}
                                  type="button"
                                  onClick={() => chooseSuggestionCity(city.city)}
                                  className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-sm text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                                >
                                  <MapPin className="h-4 w-4 text-white/75" aria-hidden="true" />
                                  <span className="flex-1">{city.city}</span>
                                  <span className="text-xs text-white/65">{t('home.heroCitySuggestion')}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {suggestions.map((business) => (
                            <Link
                              key={business.business_id}
                              to={`/business/${business.business_slug}`}
                              onClick={() => setSuggestionsOpen(false)}
                              className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                            >
                              <Building2 className="h-4 w-4 shrink-0 text-white/75" aria-hidden="true" />
                              <span className="min-w-0 flex-1 truncate">{business.business_name}</span>
                              <span className="max-w-[35%] truncate text-xs text-white/65">
                                {[business.category_name, business.city].filter(Boolean).join(' · ')}
                              </span>
                            </Link>
                          ))}
                          {suggestionsLoading && (
                            <p role="status" className="px-3 py-2 text-sm text-white/75">{t('common.loading')}</p>
                          )}
                          {suggestionsError && (
                            <p role="alert" className="px-3 py-2 text-sm text-white">{t('home.heroSuggestionsError')}</p>
                          )}
                          {!suggestionsLoading && !suggestionsError && suggestions.length === 0 &&
                            matchingCategories.length === 0 && matchingCities.length === 0 && (
                              <p className="px-3 py-2 text-sm text-white/75">{t('home.heroNoSuggestions')}</p>
                            )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {categoriesLoading && (
                  <p role="status" className="px-3 py-2 text-sm text-white/80">
                    {t('home.heroCategoriesLoading')}
                  </p>
                )}
                {Boolean(categoriesError) && (
                  <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-white">
                    <span>{t('home.heroCategoriesError')}</span>
                    <button
                      type="button"
                      onClick={() => void retry()}
                      className="rounded underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                    >
                      {t('categoryBar.retry')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="submit"
            className="hero-search-submit mt-[22px] min-h-14 w-full min-w-[200px] rounded-full border px-11 text-lg font-bold text-white shadow-[0_14px_34px_rgba(5,25,60,0.35)] transition duration-150 hover:bg-white/25 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B3A78] motion-reduce:transition-none sm:w-auto"
          >
            {t('home.heroSearchCta')}
          </button>
        </form>

        <div className="mt-8 w-full max-w-[900px]">
          <h2 className="mb-2 text-center text-sm font-semibold text-white/90">
            {t('home.browseCategories')}
          </h2>
          <CategoryBar selected={null} variant="onDark" />
        </div>
        {children}
      </div>
    </section>
  );
}
