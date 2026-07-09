import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { api, type User } from '../lib/api';

export function RequireAuth() {
  const [status, setStatus] = useState<'checking' | 'authed' | 'anon'>('checking');
  const [user, setUser] = useState<User | null>(null);
  const location = useLocation();

  useEffect(() => {
    api
      .me()
      .then(({ user }) => {
        setUser(user);
        setStatus(user ? 'authed' : 'anon');
      })
      .catch(() => setStatus('anon'));
  }, []);

  if (status === 'checking') return <p style={{ padding: 32, color: 'var(--text-faint)' }}>Loading…</p>;
  if (status === 'anon') return <Navigate to="/login" replace />;

  // Land people on the dashboard for their own role rather than making
  // designers manually type /designer after logging in.
  if (user?.role === 'designer' && location.pathname === '/dashboard') {
    return <Navigate to="/designer" replace />;
  }

  return <Outlet />;
}
