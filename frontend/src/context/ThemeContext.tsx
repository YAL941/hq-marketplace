import { useEffect, useState, type ReactNode } from 'react';
import { ThemeContext, type Theme } from './theme-context-value';

const STORAGE_KEY = 'omnihq-theme';

function initialTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setCurrentTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // The theme still applies for this session when storage is unavailable.
    }
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setCurrentTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
