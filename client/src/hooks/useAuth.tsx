import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchMe, login as apiLogin, logout as apiLogout, signup as apiSignup, type PublicUser } from '../lib/auth';

interface AuthValue {
  user: PublicUser | null;
  /** False until the first /me call settles — routes must not redirect before then. */
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, displayName: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(false);

  // The session cookie is httpOnly, so the only way to know whether we are
  // signed in is to ask the server once on boot.
  useEffect(() => {
    let alive = true;
    void fetchMe().then((u) => {
      if (!alive) return;
      setUser(u);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { user: u } = await apiLogin({ username, password });
    setUser(u);
  }, []);

  const signup = useCallback(async (username: string, displayName: string, password: string) => {
    const { user: u } = await apiSignup({ username, displayName, password });
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
