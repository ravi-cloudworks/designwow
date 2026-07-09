import { useEffect, useRef, useState } from 'react';
import { api, type SubscriptionRow, type User } from '../lib/api';
import { Avatar } from '../components/Avatar';
import { useToast } from '../components/ToastProvider';

function formatInr(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function AccountPage() {
  const { showToast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);

  async function load() {
    const [{ user }, { subscription }] = await Promise.all([api.me(), api.subscriptions.me()]);
    setUser(user);
    setSubscription(subscription);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setAvatarError('Please choose a PNG or JPG image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('Image must be under 5MB.');
      return;
    }
    setAvatarError(null);
    setUploadingAvatar(true);
    try {
      await api.users.uploadAvatar(file);
      window.location.reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setAvatarError(message);
      showToast(message, 'error');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleSwitch(planTier: 'standard' | 'priority') {
    setSwitching(true);
    try {
      await api.subscriptions.switchPlan(planTier);
      await load();
      showToast(`Switched to ${planTier === 'priority' ? 'Priority' : 'Standard'} plan`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to switch plan', 'error');
    } finally {
      setSwitching(false);
    }
  }

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>Loading…</p>;

  return (
    <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div>
        <h1 style={{ margin: '0 0 4px', fontFamily: 'var(--display)', fontSize: 24, fontWeight: 700 }}>Account</h1>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-faint)' }}>Your details, plan, and payment history</p>
      </div>

      <div className="card">
        <h2 style={cardTitle()}>Profile</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Avatar name={user?.name ?? '?'} avatarUrl={user?.avatar_url} size={54} />
          <div>
            <input ref={avatarInput} type="file" accept="image/png,image/jpeg" style={{ display: 'none' }} onChange={handleAvatarChange} />
            <button className="btn" disabled={uploadingAvatar} onClick={() => avatarInput.current?.click()}>
              {uploadingAvatar ? 'Uploading…' : 'Change photo'}
            </button>
            <p style={{ margin: '6px 0 0', fontSize: 13 }}>
              Signed in with Google · {user?.name} · {user?.email}
            </p>
            {avatarError && <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--crimson)' }}>{avatarError}</p>}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={cardTitle()}>Subscription</h2>
        {!subscription ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-faint)' }}>No active subscription found.</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <PlanBox tier="standard" price={299900} sla={78} current={subscription.plan_tier === 'standard'} />
              <PlanBox tier="priority" price={699900} sla={48} current={subscription.plan_tier === 'priority'} />
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-soft)', margin: '0 0 14px' }}>
              {subscription.next_billing_at ? `Next billing: ${new Date(subscription.next_billing_at).toLocaleDateString()}` : 'Billing via Dodo Payments'}
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn" disabled={switching} onClick={() => handleSwitch(subscription.plan_tier === 'priority' ? 'standard' : 'priority')}>
                Switch to {subscription.plan_tier === 'priority' ? 'Standard' : 'Priority'}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h2 style={cardTitle()}>Payment history</h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-faint)' }}>
          Payment history will appear here once Dodo Payments is connected.
        </p>
      </div>
    </div>
  );
}

function PlanBox({ tier, price, sla, current }: { tier: string; price: number; sla: number; current: boolean }) {
  return (
    <div
      style={{
        border: `1.5px solid ${current ? 'var(--teal)' : 'var(--line)'}`,
        background: current ? 'var(--teal-soft)' : 'transparent',
        borderRadius: 8,
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 700, marginBottom: 3, textTransform: 'capitalize' }}>
        {tier}
        {current && (
          <span style={{ fontSize: 10, background: 'var(--teal)', color: '#f0f6f4', padding: '2px 7px', borderRadius: 5, textTransform: 'uppercase' }}>
            Current
          </span>
        )}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700, marginBottom: 5 }}>
        {formatInr(price)}
        <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-faint)' }}>/mo</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{sla}h turnaround · unlimited requests</div>
    </div>
  );
}

function cardTitle(): React.CSSProperties {
  return {
    fontFamily: 'var(--display)',
    fontSize: 13,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--text-soft)',
    margin: '0 0 16px',
  };
}
