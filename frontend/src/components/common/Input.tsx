import { InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  /** Decorative icons. They are not labels, so they stay aria-hidden. */
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, helperText, leftIcon, rightIcon, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
    // The control has to make room for whichever icon was passed in, otherwise
    // the text runs underneath it.
    const controlClassName = cn(
      'w-full py-2.5 rounded-button border transition-colors duration-200',
      leftIcon ? 'ps-10' : 'ps-4',
      rightIcon ? 'pe-10' : 'pe-4',
      'bg-white text-navy-900 placeholder:text-navy-400',
      'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent',
      'disabled:bg-navy-50 disabled:text-navy-500 disabled:cursor-not-allowed',
      error
        ? 'border-error-500 focus:ring-error-500'
        : 'border-navy-300 hover:border-navy-400',
      className
    );

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-navy-700 mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 start-0 ps-3.5 flex items-center text-navy-400"
            >
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={controlClassName}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
            {...props}
          />
          {rightIcon && (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 end-0 pe-3.5 flex items-center text-navy-400"
            >
              {rightIcon}
            </span>
          )}
        </div>
        {error && (
          <p id={`${inputId}-error`} className="mt-1.5 text-sm text-error-600" role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p id={`${inputId}-helper`} className="mt-1.5 text-sm text-navy-500">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';