import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { favoriteApi } from '../services/api';
import type { PublicBusinessCard } from '../types';

interface FavoritesContextValue {
  businesses: PublicBusinessCard[];
  ids: ReadonlySet<string>;
  isLoading: boolean;
  hasError: boolean;
  refresh: () => Promise<void>;
  toggle: (business: PublicBusinessCard) => Promise<void>;
}

const FavoritesContext = createContext<FavoritesContextValue | undefined>(undefined);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const [businesses, setBusinesses] = useState<PublicBusinessCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setBusinesses([]);
      setHasError(false);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setHasError(false);
    try {
      const response = await favoriteApi.list();
      setBusinesses(response.data.data);
    } catch (error) {
      console.error('Failed to load favorite businesses:', error);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    if (!isAuthenticated) {
      setBusinesses([]);
      setHasError(false);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setHasError(false);
    favoriteApi.list()
      .then((response) => {
        if (!cancelled) setBusinesses(response.data.data);
      })
      .catch((error: unknown) => {
        console.error('Failed to load favorite businesses:', error);
        if (!cancelled) setHasError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, user?.user_id]);

  const toggle = useCallback(async (business: PublicBusinessCard) => {
    const isSaved = businesses.some((item) => item.business_id === business.business_id);
    setHasError(false);
    try {
      if (isSaved) {
        await favoriteApi.remove(business.business_id);
        setBusinesses((items) => items.filter((item) => item.business_id !== business.business_id));
      } else {
        await favoriteApi.save(business.business_id);
        setBusinesses((items) => [business, ...items.filter((item) => item.business_id !== business.business_id)]);
      }
    } catch (error) {
      console.error('Failed to update favorite business:', error);
      setHasError(true);
      throw error;
    }
  }, [businesses]);

  const value = useMemo(() => ({
    businesses,
    ids: new Set(businesses.map((business) => business.business_id)),
    isLoading,
    hasError,
    refresh,
    toggle,
  }), [businesses, isLoading, hasError, refresh, toggle]);

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites() {
  const context = useContext(FavoritesContext);
  if (!context) throw new Error('useFavorites must be used within a FavoritesProvider');
  return context;
}
