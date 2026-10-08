import { createContext, useContext } from 'react';
import type { User, BusinessMembership, RegisterPayload, AccountRole, Id } from '../types';

/** The two places a signed-in person can land. */
export interface AuthOutcome {
  role: AccountRole;
  /** The business created alongside a `business_owner` signup, else undefined. */
  businessId?: Id;
}

export interface AuthContextType {
  user: User | null;
  platformRoles: string[];
  businesses: BusinessMembership[];
  currentBusiness: BusinessMembership | null;
  /**
   * The current business's logo, as the database holds it.
   *
   * It lives here rather than in the header and the sidebar because
   * `/auth/me` does not publish a logo — a membership carries a name and a slug
   * only — so the value has to come from the staff read. The header and the
   * sidebar render at the same time, so fetching it once and sharing it is what
   * keeps that to a single request rather than two.
   */
  currentBusinessLogo: string | null;
  /**
   * Re-reads that logo.
   *
   * Called after an upload or a removal, so the chrome reflects a new image
   * without the person having to reload the page.
   */
  refreshBusinessLogo: () => Promise<void>;
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

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
