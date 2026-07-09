import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, type User } from '../lib/api';
import { Avatar } from './Avatar';

const tabs = [
  { to: '/dashboard', label: 'My Requests' },
  { to: '/account', label: 'Account' },
];

export function CustomerShell() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    api.me().then(({ user }) => setUser(user));
  }, []);

  async function handleLogout() {
    await api.logout();
    navigate('/login', { replace: true });
  }

  return (
    <div>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 32px',
          borderBottom: '1px solid var(--line)',
          flexWrap: 'wrap',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                background: 'var(--teal)',
                flex: 'none',
              }}
            />
            <span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 15.5, letterSpacing: '-0.01em' }}>
              Design Wow
            </span>
          </div>
          <nav style={{ display: 'flex', gap: 4 }}>
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.to === '/dashboard'}
                style={({ isActive }) => ({
                  padding: '8px 12px',
                  borderRadius: 7,
                  fontSize: 13.5,
                  fontWeight: 600,
                  textDecoration: 'none',
                  color: isActive ? 'var(--teal)' : 'var(--text-faint)',
                  background: isActive ? 'var(--teal-soft)' : 'transparent',
                })}
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </div>
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{user.name}</span>
            <Avatar name={user.name} avatarUrl={user.avatar_url} size={30} />
            <button
              onClick={handleLogout}
              style={{ border: 'none', background: 'none', color: 'var(--text-faint)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}
            >
              Log out
            </button>
          </div>
        )}
      </header>
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px' }}>
        <Outlet />
      </main>
    </div>
  );
}
