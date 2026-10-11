import { useCallback, useEffect, useRef, useState, ReactNode } from 'react';
import type {
  User, AuthMeResponse, BusinessMembership, LoginResponse, RegisterPayload, RegisterResponse,
} from '../types';
import { authApi, businessApi, setAuthToken } from '../services/api';
import { AuthContext } from './useAuth';

/** The two places a signed-in person can land. */
const TOKEN_KEY = 'hq_token';
const BUSINESS_KEY = 'hq_current_business';
const REMEMBER_KEY = 'hq_remember';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [platformRoles, setPlatformRoles] = useState<string[]>([]);
  const [businesses, setBusinesses] = useState<BusinessMembership[]>([]);
  const [courierBusinesses, setCourierBusinesses] = useState<Array<{ business_id: string }>>([]);
  const [currentBusiness, setCurrentBusiness] = useState<BusinessMembership | null>(null);
  const [currentBusinessLogo, setCurrentBusinessLogo] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * The selected business, mirrored through a ref so `refreshUser`
   * below can be a single stable callback: it always reads the
   * latest selection without being rebuilt on every switch, which
   * is what keeps its mount effect from re-running.
   */
  const currentBusinessRef = useRef(currentBusiness);
  useEffect(() => {
    currentBusinessRef.current = currentBusiness;
  });

  /**
   * The staff read for the current business, used only for its logo.
   *
   * A failure here is swallowed rather than surfaced. A logo is decoration: it is
   * not worth an error banner, and letting it reject would be indistinguishable
   * from the sign-in having failed, which is why it does not go through the path
   * that clears the token.
   */
  const refreshBusinessLogo = useCallback(async () => {
    const id = currentBusiness?.business_id;
    if (!id) {
      setCurrentBusinessLogo(null);
      return;
    }
    try {
      const res = await businessApi.getForBusiness(id);
      setCurrentBusinessLogo(res.data.data.logo_url ?? null);
    } catch {
      setCurrentBusinessLogo(null);
    }
  }, [currentBusiness?.business_id]);

  useEffect(() => {
    void refreshBusinessLogo();
  }, [refreshBusinessLogo]);

  /**
   * Stores the token for this session, or for good.
   *
   * An unchecked box still signs the person in; it only means the token is not
   * kept past the browser session, which is what "remember me" is asking.
   */
  const persistToken = (token: string, remember: boolean) => {
    if (remember) {
      localStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(TOKEN_KEY, token);
    } else {
      sessionStorage.setItem(TOKEN_KEY, token);
    }
    setAuthToken(token);
  };

  const clearToken = () => {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(BUSINESS_KEY);
    setAuthToken(null);
  };

  /**
   * Stable by design: it is called from the mount effect, from
   * `login` and from `register`, and a callback that changes
   * identity on every render would re-run that effect on every
   * render. The selected business is read through a ref instead
   * of a closure for the same reason.
   */
  const refreshUser = useCallback(async () => {
    try {
      const token = localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
      if (!token) return;

      setAuthToken(token);
      const response = await authApi.me();
      const data = response.data.data as AuthMeResponse;

      setUser(data.user);
      setPlatformRoles(data.platformRoles.map(r => r.role_key));
      setBusinesses(data.businesses);
      setCourierBusinesses(data.courierBusinesses ?? []);

      if (data.businesses.length > 0 && !currentBusinessRef.current) {
        const savedBusinessId = localStorage.getItem(BUSINESS_KEY);
        if (savedBusinessId) {
          // Both sides are the same string the server sent: `business_id` is a
          // bigint serialised as text, so parsing it would compare two different
          // representations of the same id.
          const found = data.businesses.find((b) => b.business_id === savedBusinessId);
          if (found) setCurrentBusiness(found);
        }
        if (!savedBusinessId || !data.businesses.some((b) => b.business_id === savedBusinessId)) {
          setCurrentBusiness(data.businesses[0]);
        }
      }
    } catch (error) {
      console.error('Failed to refresh user:', error);
      clearToken();
      setUser(null);
      setPlatformRoles([]);
      setBusinesses([]);
      setCourierBusinesses([]);
      setCurrentBusiness(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // `refreshUser` never changes identity, so this runs once per
  // mount: the session is restored from storage on every reload.
  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const login = async (identifier: string, password: string, remember: boolean) => {
    const response = await authApi.login({ identifier, password });
    const { token } = response.data.data as LoginResponse;

    persistToken(token, remember);
    if (remember) localStorage.setItem(REMEMBER_KEY, '1');
    else localStorage.removeItem(REMEMBER_KEY);

    await refreshUser();
    const meData = (await authApi.me()).data.data as AuthMeResponse;
    const role: 'courier' | 'business_owner' | 'customer' = meData.courierBusinesses?.length
      ? 'courier'
      : meData.businesses.length
        ? 'business_owner'
        : 'customer';
    return {
      role,
    };
  };

  const register = async (payload: RegisterPayload, remember: boolean) => {
    const response = await authApi.register(payload);
    const data = response.data.data as RegisterResponse;
    const { token } = data;

    persistToken(token, remember);
    if (remember) localStorage.setItem(REMEMBER_KEY, '1');
    else localStorage.removeItem(REMEMBER_KEY);

    // Prefer the id the server returns with the registration itself, so the
    // post-signup redirect does not depend on the `/me` round trip landing in
    // time. The business-owner branch of `/auth/register` always returns one;
    // a `customer` signup returns null, which is what `businessId` stays.
    let businessId = data.business?.business_id;
    if (!businessId && payload.role === 'business_owner') {
      // Defensive fallback only: re-read /me and take the newest membership the
      // account now owns, in case the register response ever stops carrying it.
      const meData = (await authApi.me()).data.data as AuthMeResponse;
      const memberships = meData.businesses;
      businessId = memberships[memberships.length - 1]?.business_id;
    }

    await refreshUser();
    // The role the form asked for is what decides where to send the person; the
    // business may not have appeared in `/auth/me` yet on a slow round trip, and
    // guessing from an empty list would drop an owner on the home page.
    return { role: payload.role, businessId };
  };

  const logout = () => {
    clearToken();
    localStorage.removeItem(REMEMBER_KEY);
    setUser(null);
    setPlatformRoles([]);
    setBusinesses([]);
    setCourierBusinesses([]);
    setCurrentBusiness(null);
  };

  const setCurrentBusinessHandler = (business: BusinessMembership | null) => {
    setCurrentBusiness(business);
    if (business) {
      localStorage.setItem(BUSINESS_KEY, business.business_id);
    } else {
      localStorage.removeItem(BUSINESS_KEY);
    }
  };

  const hasPlatformRole = (role: string) => platformRoles.includes(role);

  return (
    <AuthContext.Provider value={{
      user,
      platformRoles,
      businesses,
      courierBusinesses,
      currentBusiness,
      currentBusinessLogo,
      refreshBusinessLogo,
      isLoading,
      isAuthenticated: !!user,
      login,
      register,
      logout,
      setCurrentBusiness: setCurrentBusinessHandler,
      refreshUser,
      hasPlatformRole,
    }}>
      {children}
    </AuthContext.Provider>
  );
}