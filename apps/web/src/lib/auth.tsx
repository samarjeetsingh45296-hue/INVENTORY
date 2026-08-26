'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import type { Principal } from '@inventory/shared';
import { api, tokenStore } from './api';

interface AuthState {
  user: Principal | null;
  loading: boolean;
  /** Returns 'MFA_REQUIRED' when a second factor is still needed. */
  login: (
    email: string,
    password: string,
  ) => Promise<'OK' | 'MFA_REQUIRED' | 'MFA_ENROLMENT_REQUIRED'>;
  /** Set when the account must enrol a second factor before it can sign in. */
  enrolmentNotice: string | null;
  verifyMfa: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (...permissions: string[]) => boolean;
  canAny: (...permissions: string[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [enrolmentNotice, setEnrolmentNotice] = useState<string | null>(null);
  const router = useRouter();

  // Restore the session on first paint using the stored refresh token.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const refreshToken = tokenStore.getRefresh();
      if (!refreshToken) {
        setLoading(false);
        return;
      }
      try {
        const me = await api<Principal>('/auth/me');
        if (!cancelled) setUser(me);
      } catch {
        tokenStore.clear();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<any>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });

    if (res.status === 'MFA_REQUIRED') {
      setChallengeToken(res.challengeToken);
      return 'MFA_REQUIRED' as const;
    }

    if (res.status === 'MFA_ENROLMENT_REQUIRED') {
      // The password was right, but this role cannot hold a session until a
      // second factor exists. The token returned unlocks only the enrolment
      // endpoints.
      tokenStore.setAccess(res.enrolmentToken);
      setEnrolmentNotice(res.message);
      return 'MFA_ENROLMENT_REQUIRED' as const;
    }

    tokenStore.setAccess(res.accessToken);
    tokenStore.setRefresh(res.refreshToken);
    setUser(await api<Principal>('/auth/me'));
    return 'OK' as const;
  }, []);

  const verifyMfa = useCallback(
    async (code: string) => {
      if (!challengeToken) throw new Error('Start the sign-in again');
      const res = await api<any>('/auth/mfa/verify', {
        method: 'POST',
        body: { challengeToken, code },
      });
      tokenStore.setAccess(res.accessToken);
      tokenStore.setRefresh(res.refreshToken);
      setChallengeToken(null);
      setUser(await api<Principal>('/auth/me'));
    },
    [challengeToken],
  );

  const logout = useCallback(async () => {
    await api('/auth/logout', {
      method: 'POST',
      body: { refreshToken: tokenStore.getRefresh() },
    }).catch(() => undefined);
    tokenStore.clear();
    setUser(null);
    router.push('/login');
  }, [router]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login,
      verifyMfa,
      logout,
      enrolmentNotice,
      can: (...permissions) =>
        !!user && permissions.every((p) => user.permissions.includes(p)),
      canAny: (...permissions) =>
        !!user && permissions.some((p) => user.permissions.includes(p)),
    }),
    [user, loading, login, verifyMfa, logout, enrolmentNotice],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
