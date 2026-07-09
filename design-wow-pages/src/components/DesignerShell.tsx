import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, type User } from '../lib/api';
import { Avatar } from './Avatar';

const navItems = [
  { to: '/designer', label: 'Queue' },
  { to: '/designer/customers', label: 'Customers' },
  { to: '/designer/history', label: 'History' },
  { to: '/designer/profile', label: 'Profile' },
];

export function DesignerShell() {
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
    <div style={{ display: 'flex', alignItems: 'flex-start', minHeight: '100vh' }}>
      <aside
        style={{
          width: 232,
          flex: 'none',
          padding: '28px 20px',
          borderRight: '1px solid var(--line)',
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--teal)', flex: 'none' }} />
            <span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 14.5, letterSpacing: '-0.01em' }}>
              Design Wow
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar name={user?.name ?? ''} avatarUrl={user?.avatar_url} size={38} />
            <div>
              <h2 style={{ margin: 0, fontFamily: 'var(--display)', fontSize: 15, fontWeight: 700 }}>{user?.name ?? ' '}</h2>
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Designer</span>
            </div>
          </div>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/designer'}
              style={({ isActive }) => ({
                padding: '9px 10px',
                borderRadius: 7,
                fontSize: 14,
                textDecoration: 'none',
                fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--teal)' : 'var(--text-soft)',
                background: isActive ? 'var(--teal-soft)' : 'transparent',
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={handleLogout}
          style={{
            marginTop: 'auto',
            border: 'none',
            background: 'none',
            color: 'var(--text-faint)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            textAlign: 'left',
            padding: '9px 10px',
          }}
        >
          Log out
        </button>
      </aside>
      <main style={{ flex: 1, minWidth: 0, padding: '28px 32px 40px' }}>
        <Outlet />
      </main>
    </div>
  );
}
