import type { ComponentType } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { Screen } from './components/ui';
import Setup from './routes/Setup';
import Scorer from './routes/Scorer';
import Viewer from './routes/Viewer';
import Login from './routes/Login';
import Profile from './routes/Profile';
import Tournaments from './routes/Tournaments';
import Tournament from './routes/Tournament';

/**
 * Keying on matchId forces a full remount when moving between matches — which a
 * rematch does without leaving the route. Without it the stale-broadcast guard
 * (which only accepts a version higher than the last one seen) would reject the
 * new match's state, since a fresh match starts back at version 0.
 */
function PerMatch({ Component }: { Component: ComponentType }) {
  const { matchId } = useParams();
  return <Component key={matchId} />;
}

/**
 * Everything except the auth screens needs a session. A share link opened by
 * someone signed out lands on /login?next=<the link>, so after signing in they
 * arrive where they were actually going rather than on the home page.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();

  // Redirecting before /me settles would bounce a signed-in user to the login
  // screen on every refresh.
  if (!ready) {
    return (
      <Screen>
        <div className="mx-auto max-w-md px-4 py-24 text-center text-sm text-ink-500">Loading…</div>
      </Screen>
    );
  }
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login mode="login" />} />
      <Route path="/signup" element={<Login mode="signup" />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Setup />
          </RequireAuth>
        }
      />
      <Route
        path="/score/:matchId"
        element={
          <RequireAuth>
            <PerMatch Component={Scorer} />
          </RequireAuth>
        }
      />
      <Route
        path="/tournaments"
        element={
          <RequireAuth>
            <Tournaments />
          </RequireAuth>
        }
      />
      <Route
        path="/tournaments/:tournamentId"
        element={
          <RequireAuth>
            <Tournament />
          </RequireAuth>
        }
      />
      <Route
        path="/players/:username"
        element={
          <RequireAuth>
            <Profile />
          </RequireAuth>
        }
      />
      <Route
        path="/live/:matchId"
        element={
          <RequireAuth>
            <PerMatch Component={Viewer} />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
