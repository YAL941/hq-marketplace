import { useState, useRef, useEffect, KeyboardEvent, ChangeEvent } from 'react';
import { cn } from '../lib/utils';
import { X, Search, Loader2 } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: (value: string) => void;
  placeholder?: string;
  loading?: boolean;
  className?: string;
}

export function SearchBar({ value, onChange, onSearch, placeholder = 'Search businesses, services, products...', loading, className }: SearchBarProps) {
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

  return (
    <form onSubmit={handleSubmit} className={cn('relative w-full max-w-2xl', className)}>
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-navy-400" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-12 pr-12 py-3 bg-white border border-navy-300 rounded-full text-navy-900 placeholder:text-navy-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-200 shadow-sm"
          aria-label="Search"
          autoComplete="off"
        />
        {showClear && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-navy-400 hover:text-navy-600 transition-colors"
            aria-label="Clear search"
          >
            <X className="w-5 h-5" />
          </button>
        )}
        {loading && (
          <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-primary-500 animate-spin" aria-hidden="true" />
        )}
      </div>
    </form>
  );
}