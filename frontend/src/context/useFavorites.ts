import { createContext, useContext } from 'react';
import type { PublicBusinessCard } from '../types';

interface FavoritesContextValue {
  businesses: PublicBusinessCard[];
  ids: ReadonlySet<string>;
  isLoading: boolean;
  hasError: boolean;
  refresh: () => Promise<void>;
  toggle: (business: PublicBusinessCard) => Promise<void>;
}

export const FavoritesContext = createContext<FavoritesContextValue | undefined>(undefined);

export function useFavorites() {
  const context = useContext(FavoritesContext);
  if (!context) throw new Error('useFavorites must be used within a FavoritesProvider');
  return context;
}
