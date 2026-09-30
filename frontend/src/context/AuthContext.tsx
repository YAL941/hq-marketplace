import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { User, AuthMeResponse, BusinessMembership, LoginResponse } from '../types';
import { authApi, setAuthToken } from '../services/api';

interface AuthContextType {
  user: User | null;
  platformRoles: string[];
  businesses: BusinessMembership[];
  currentBusiness: BusinessMembership | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; fullName: string; phone?: string }) => Promise<void>;
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

  const refreshUser = async () => {
    try {
      const token = localStorage.getItem('hq_token');
      if (!token) return;

      setAuthToken(token);
      const response = await authApi.me();
      const data = response.data.data as AuthMeResponse;

      setUser(data.user);
      setPlatformRoles(data.platformRoles.map(r => r.role_key));
      setBusinesses(data.businesses);

      if (data.businesses.length > 0 && !currentBusiness) {
        const savedBusinessId = localStorage.getItem('hq_current_business');
        if (savedBusinessId) {
          const found = data.businesses.find(b => b.business_id === parseInt(savedBusinessId));
          if (found) setCurrentBusiness(found);
        } else {
          setCurrentBusiness(data.businesses[0]);
        }
      }
    } catch (error) {
      console.error('Failed to refresh user:', error);
      setAuthToken(null);
      localStorage.removeItem('hq_token');
      localStorage.removeItem('hq_current_business');
      setUser(null);
      setPlatformRoles([]);
      setBusinesses([]);
      setCurrentBusiness(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const login = async (email: string, password: string) => {
    const response = await authApi.login({ email, password });
    const { user: userData, token } = response.data.data as LoginResponse;

    localStorage.setItem('hq_token', token);
    setAuthToken(token);

    await refreshUser();
  };

  const register = async (data: { email: string; password: string; fullName: string; phone?: string }) => {
    const response = await authApi.register(data);
    const { user: userData, token } = response.data.data as LoginResponse;

    localStorage.setItem('hq_token', token);
    setAuthToken(token);

    await refreshUser();
  };

  const logout = () => {
    setAuthToken(null);
    localStorage.removeItem('hq_token');
    localStorage.removeItem('hq_current_business');
    setUser(null);
    setPlatformRoles([]);
    setBusinesses([]);
    setCurrentBusiness(null);
  };

  const setCurrentBusinessHandler = (business: BusinessMembership | null) => {
    setCurrentBusiness(business);
    if (business) {
      localStorage.setItem('hq_current_business', business.business_id.toString());
    } else {
      localStorage.removeItem('hq_current_business');
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