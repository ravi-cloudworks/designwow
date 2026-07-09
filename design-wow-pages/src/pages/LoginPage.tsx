import { useEffect, useState } from 'react';
import { api, type User } from '../lib/api';

export function LoginPage() {
  const [status, setStatus] = useState<'checking' | 'signed-in' | 'signed-out' | 'api-unreachable'>('checking');
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    api
      .me()
      .then(({ user }) => {
        setUser(user);
        setStatus(user ? 'signed-in' : 'signed-out');
      })
      .catch(() => setStatus('api-unreachable'));
  }, []);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 380,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: 22,
          padding: '36px 32px',
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 11,
            background: 'var(--teal)',
          }}
        />

        <div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 21, fontWeight: 700, margin: '0 0 6px' }}>
            Sign in to continue
          </h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-faint)', margin: 0, lineHeight: 1.5 }}>
            Track your active request, or manage your queue if you're a designer.
          </p>
        </div>

        <a
          href={api.googleLoginUrl()}
          className="btn"
          style={{ width: '100%', textAlign: 'center', textDecoration: 'none' }}
        >
          Continue with Google
        </a>

        <p style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
          {status === 'checking' && 'Checking session…'}
          {status === 'signed-out' && 'Not signed in yet.'}
          {status === 'signed-in' && user && `Signed in as ${user.name} (${user.role}).`}
          {status === 'api-unreachable' && 'Could not reach design-wow-api — is it running?'}
        </p>
      </div>
    </div>
  );
}
