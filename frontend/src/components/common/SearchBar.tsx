import { useState, useRef, useEffect, ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { X, Search, Loader2 } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: (value: string) => void;
  /** Defaults to the translated placeholder. */
  placeholder?: string;
  loading?: boolean;
  className?: string;
}

export function SearchBar({ value, onChange, onSearch, placeholder, loading, className }: SearchBarProps) {
  const { t } = useTranslation();
  const [showClear, setShowClear] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setShowClear(value.length > 0);
  }, [value]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(value.trim());
  };

  const handleClear = (e: React.MouseEvent) => {
    e.preventDefault();
    onChange('');
    onSearch('');
    inputRef.current?.focus();
  };

  // Clear and spinner share the same slot; showing both at once would stack
  // two icons in the gap meant for one.
  const showTrailingAction = showClear || loading;

  return (
    <form onSubmit={handleSubmit} className={cn('relative w-full max-w-2xl', className)} role="search">
      <div className="relative">
        <Search className="absolute start-4 top-1/2 -translate-y-1/2 w-5 h-5 text-navy-400" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          placeholder={placeholder ?? t('search.placeholder')}
          className="w-full ps-12 pe-12 py-3 bg-white border border-navy-300 rounded-full text-navy-900 placeholder:text-navy-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-200 shadow-sm"
          aria-label={t('search.label')}
          autoComplete="off"
        />
        {showTrailingAction && (
          <div className="absolute end-4 top-1/2 -translate-y-1/2">
            {loading ? (
              <Loader2 className="w-5 h-5 text-primary-500 animate-spin" aria-hidden="true" />
            ) : (
              <button
                type="button"
                onClick={handleClear}
                className="text-navy-400 hover:text-navy-600 transition-colors"
                aria-label={t('search.clear')}
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
