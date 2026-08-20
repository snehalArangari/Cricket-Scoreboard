import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Btn, Field, Panel, Screen, TextInput } from '../components/ui';

export default function Login({ mode }: { mode: 'login' | 'signup' }) {
  const { user, ready, login, signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Where to land afterwards. A share link that required signing in arrives
  // here as ?next=/live/ABC123, so the person ends up where they were headed.
  const next = params.get('next') || '/';

  if (ready && user) return <Navigate to={next} replace />;

  const isSignup = mode === 'signup';
  const valid =
    username.trim().length >= 3 && password.length >= 8 && (!isSignup || displayName.trim().length > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (isSignup) await signup(username.trim().toLowerCase(), displayName.trim(), password);
      else await login(username.trim().toLowerCase(), password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <Screen>
      <div className="mx-auto w-full max-w-sm px-4 py-10">
        <header className="mb-6 text-center">
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-50">
            CRICKET <span className="text-accent">LIVE</span>
          </h1>
          <p className="mt-1 text-sm text-ink-300">
            {isSignup ? 'Create an account to score and track your stats' : 'Sign in to continue'}
          </p>
        </header>

        <Panel className="p-4">
          <form onSubmit={submit} className="space-y-3">
            <Field
              label="Username"
              hint={isSignup ? 'Lowercase letters, numbers or _ — this is how teammates add you' : undefined}
            >
              <TextInput
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                placeholder="rohit45"
              />
            </Field>

            {isSignup && (
              <Field label="Display name">
                <TextInput
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoComplete="name"
                  placeholder="Rohit Sharma"
                />
              </Field>
            )}

            <Field label="Password" hint={isSignup ? 'At least 8 characters' : undefined}>
              <TextInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                placeholder="••••••••"
              />
            </Field>

            {error && (
              <div className="rounded-xl border border-live/50 bg-live/10 px-3 py-2 text-sm text-live">
                {error}
              </div>
            )}

            <Btn type="submit" variant="primary" className="w-full py-3.5" disabled={!valid || busy}>
              {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
            </Btn>
          </form>
        </Panel>

        <p className="mt-4 text-center text-sm text-ink-300">
          {isSignup ? 'Already have an account? ' : 'New here? '}
          <Link
            to={`${isSignup ? '/login' : '/signup'}${location.search}`}
            className="text-accent underline-offset-2 hover:underline"
          >
            {isSignup ? 'Sign in' : 'Create one'}
          </Link>
        </p>
      </div>
    </Screen>
  );
}
