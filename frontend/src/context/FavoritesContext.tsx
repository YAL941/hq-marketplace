import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './useAuth';
import { FavoritesContext } from './useFavorites';
import { favoriteApi } from '../services/api';
import type { PublicBusinessCard } from '../types';

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
