import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type {
  User, AuthMeResponse, BusinessMembership, LoginResponse, RegisterPayload, RegisterResponse, AccountRole,
} from '../types';
import { authApi, setAuthToken } from '../services/api';

/** The two places a signed-in person can land. */
const TOKEN_KEY = 'hq_token';
const BUSINESS_KEY = 'hq_current_business';
const REMEMBER_KEY = 'hq_remember';

/** What a caller needs to route itself once the account exists. */
export interface AuthOutcome {
  role: AccountRole;
}

interface AuthContextType {
  user: User | null;
  platformRoles: string[];
  businesses: BusinessMembership[];
  currentBusiness: BusinessMembership | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /**
   * `identifier` is an email address or a phone number; the server decides
   * which and normalises a number before looking the account up.
   *
   * `remember` is explicit rather than implied by the token: an unchecked box
   * has to survive a page load being able to tell the difference.
   */
  login: (identifier: string, password: string, remember: boolean) => Promise<AuthOutcome>;
  register: (payload: RegisterPayload, remember: boolean) => Promise<AuthOutcome>;
  logout: () => void;
  setCurrentBusiness: (business: BusinessMembership | null) => void;
  refreshUser: () => Promise<void>;
  hasPlatformRole: (role: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [platformRoles, setPlatformRoles] = useState<string[]>([]);
  const [businesses, setBusinesses] = useState<BusinessMembership[]>([]);
  const [currentBusiness, setCurrentBusiness] = useState<BusinessMembership | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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

  const refreshUser = async () => {
    try {
      const token = localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
      if (!token) return;

      setAuthToken(token);
      const response = await authApi.me();
      const data = response.data.data as AuthMeResponse;

      setUser(data.user);
      setPlatformRoles(data.platformRoles.map(r => r.role_key));
      setBusinesses(data.businesses);

      if (data.businesses.length > 0 && !currentBusiness) {
        const savedBusinessId = localStorage.getItem(BUSINESS_KEY);
        if (savedBusinessId) {
          const found = data.businesses.find(b => b.business_id === parseInt(savedBusinessId));
          if (found) setCurrentBusiness(found);
        } else {
          setCurrentBusiness(data.businesses[0]);
        }
      }
    } catch (error) {
      console.error('Failed to refresh user:', error);
      clearToken();
      setUser(null);
      setPlatformRoles([]);
      setBusinesses([]);
      setCurrentBusiness(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refreshUser();
  }, []);

  /**
   * Which kind of account this is.
   *
   * Neither login nor `/auth/me` is read for this alone: `/auth/me` returns the
   * businesses a person belongs to, and membership is the only thing that proves
   * a dashboard is theirs to open. A platform role is not a substitute, because a
   * platform administrator is not necessarily a business owner.
   */
  const resolveRole = (): AuthOutcome => ({
    role: businesses.length > 0 ? 'business_owner' : 'customer',
  });

  const login = async (identifier: string, password: string, remember: boolean) => {
    const response = await authApi.login({ identifier, password });
    const { token } = response.data.data as LoginResponse;

    persistToken(token, remember);
    if (remember) localStorage.setItem(REMEMBER_KEY, '1');
    else localStorage.removeItem(REMEMBER_KEY);

    await refreshUser();
    return resolveRole();
  };

  const register = async (payload: RegisterPayload, remember: boolean) => {
    const response = await authApi.register(payload);
    const { token } = response.data.data as RegisterResponse;

    persistToken(token, remember);
    if (remember) localStorage.setItem(REMEMBER_KEY, '1');
    else localStorage.removeItem(REMEMBER_KEY);

    await refreshUser();
    // The role the form asked for is what decides where to send the person; the
    // business may not have appeared in `/auth/me` yet on a slow round trip, and
    // guessing from an empty list would drop an owner on the home page.
    return { role: payload.role };
  };

  const logout = () => {
    clearToken();
    localStorage.removeItem(REMEMBER_KEY);
    setUser(null);
    setPlatformRoles([]);
    setBusinesses([]);
    setCurrentBusiness(null);
  };

  const setCurrentBusinessHandler = (business: BusinessMembership | null) => {
    setCurrentBusiness(business);
    if (business) {
      localStorage.setItem(BUSINESS_KEY, business.business_id.toString());
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
      currentBusiness,
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

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}