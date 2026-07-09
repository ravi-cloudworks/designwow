import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type DesignerRow } from '../lib/api';
import { Avatar } from '../components/Avatar';
import { useToast } from '../components/ToastProvider';

const STEPS = [
  { n: '1', title: 'Submit your brief', body: 'Product, goal, platform, references — once, not re-explained every time.' },
  { n: '2', title: 'A designer picks it up', body: 'Matched to your queue and working to a guaranteed turnaround.' },
  { n: '3', title: 'Track progress & add notes', body: 'Ask questions, share files, get updates — all in one place.' },
  { n: '4', title: 'Approve and it’s yours', body: 'Request a revision or approve — done.' },
];

const FAQS = [
  {
    q: 'What if I need more than one video at a time?',
    a: 'One active request at a time keeps quality and turnaround honest — the moment your current brief is approved, you can queue the next one.',
  },
  {
    q: "What happens if it's running late?",
    a: 'Your turnaround countdown is visible the whole time, and it only pauses while a question is waiting on you — never silently.',
  },
  {
    q: 'How do revisions work?',
    a: 'Request a revision after delivery and get a fresh full turnaround window on the same brief.',
  },
  {
    q: 'How do I pay my designer?',
    a: "Once work is delivered, your designer sends a UPI payment request with a QR code or link — no card details stored anywhere, no extra app.",
  },
];

export function HomePage() {
  const navigate = useNavigate();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [designers, setDesigners] = useState<DesignerRow[]>([]);
  const [waitlistRole, setWaitlistRole] = useState<'customer' | 'designer' | null>(null);

  useEffect(() => {
    api
      .me()
      .then(({ user }) => {
        if (user?.role === 'customer') {
          navigate('/dashboard', { replace: true });
          return;
        }
        if (user?.role === 'designer') {
          navigate('/designer', { replace: true });
          return;
        }
        setCheckingAuth(false);
      })
      .catch(() => setCheckingAuth(false));

    api.designers.list().then(({ designers }) => setDesigners(designers)).catch(() => {});
  }, [navigate]);

  if (checkingAuth) return null;

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '0 24px' }}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 0', flexWrap: 'wrap', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--teal)', flex: 'none' }} />
          <span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em' }}>Design Wow</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <a href="/login" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-soft)', textDecoration: 'none' }}>
            Log in
          </a>
          <button className="btn btn-primary" onClick={() => setWaitlistRole('customer')}>
            Join Waitlist
          </button>
        </div>
      </header>

      {/* Hero */}
      <section style={{ padding: '56px 0 48px', textAlign: 'center' }}>
        <p style={{ margin: '0 0 10px', fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--teal)' }}>
          UGC video ads, productized
        </p>
        <h1 style={{ margin: '0 0 16px', fontFamily: 'var(--display)', fontSize: 44, fontWeight: 700, lineHeight: 1.15, textWrap: 'balance' }}>
          UGC video ads, on tap. Flat fee. One designer. Always on time.
        </h1>
        <p style={{ margin: '0 auto 28px', fontSize: 16, color: 'var(--text-soft)', maxWidth: 560, lineHeight: 1.5 }}>
          Submit a brief, get matched with a dedicated video editor, and track everything in one place — no chasing
          freelancers, no re-explaining your brand every time.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" style={{ fontSize: 14.5, padding: '11px 22px' }} onClick={() => setWaitlistRole('customer')}>
            Join customer waitlist
          </button>
          <button className="btn" style={{ fontSize: 14.5, padding: '11px 22px' }} onClick={() => setWaitlistRole('designer')}>
            Join designer waitlist
          </button>
        </div>
      </section>

      {/* How it works */}
      <section style={{ padding: '40px 0' }}>
        <h2 style={sectionTitleStyle()}>How it works</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18 }}>
          {STEPS.map((s) => (
            <div key={s.n} className="card" style={{ padding: 18 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'var(--teal-soft)',
                  color: 'var(--teal)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--mono)',
                  fontWeight: 700,
                  fontSize: 13,
                  marginBottom: 12,
                }}
              >
                {s.n}
              </div>
              <h3 style={{ margin: '0 0 6px', fontSize: 14.5, fontWeight: 700 }}>{s.title}</h3>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-faint)', lineHeight: 1.5 }}>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Plans */}
      <section style={{ padding: '40px 0' }}>
        <h2 style={sectionTitleStyle()}>Plans</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <PlanCard tier="Standard" price="₹2,999" sla="78h turnaround" onClick={() => setWaitlistRole('customer')} />
          <PlanCard tier="Priority" price="₹6,999" sla="48h turnaround" highlight onClick={() => setWaitlistRole('customer')} />
        </div>
        <p style={{ margin: '14px 0 0', fontSize: 12.5, color: 'var(--text-faint)', textAlign: 'center' }}>
          Unlimited requests, one active at a time. Pick your designer.
        </p>
      </section>

      {/* For designers */}
      <section className="card" style={{ padding: 28, margin: '40px 0', display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2 style={{ margin: '0 0 8px', fontFamily: 'var(--display)', fontSize: 22, fontWeight: 700 }}>
            Spend less time chasing clients, more time editing.
          </h2>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              'Steady, matched work — no cold outreach',
              'Your own public portfolio page, shareable anywhere',
              'Get paid directly via UPI/WhatsApp — no payment platform cut',
            ].map((line) => (
              <li key={line} style={{ display: 'flex', gap: 8, fontSize: 14, color: 'var(--text-soft)' }}>
                <span style={{ color: 'var(--teal)' }}>&#10003;</span> {line}
              </li>
            ))}
          </ul>
        </div>
        <button className="btn btn-primary" style={{ flex: 'none' }} onClick={() => setWaitlistRole('designer')}>
          Join designer waitlist
        </button>
      </section>

      {/* Meet the designers */}
      {designers.length > 0 && (
        <section style={{ padding: '40px 0' }}>
          <h2 style={sectionTitleStyle()}>Meet the designers</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            {designers.map((d) => {
              const tags: string[] = d.specialty_tags ? JSON.parse(d.specialty_tags) : [];
              return (
                <a
                  key={d.id}
                  href={`/d/${d.id}`}
                  className="card"
                  style={{ width: 200, padding: 16, textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  <Avatar name={d.name} avatarUrl={d.avatar_url} size={44} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{d.name}</div>
                    {tags.length > 0 && <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{tags.slice(0, 2).join(' · ')}</div>}
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {/* FAQ */}
      <section style={{ padding: '40px 0' }}>
        <h2 style={sectionTitleStyle()}>Questions</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {FAQS.map((f) => (
            <div key={f.q} className="card" style={{ padding: '16px 18px' }}>
              <p style={{ margin: '0 0 6px', fontSize: 14.5, fontWeight: 700 }}>{f.q}</p>
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-faint)', lineHeight: 1.5 }}>{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ padding: '28px 0 40px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 18, height: 18, borderRadius: 5, background: 'var(--teal)', flex: 'none' }} />
          <span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 13.5 }}>Design Wow</span>
        </div>
        <a href="/login" style={{ fontSize: 12.5, color: 'var(--text-faint)', textDecoration: 'none' }}>
          Log in
        </a>
      </footer>

      {waitlistRole && <WaitlistModal role={waitlistRole} onClose={() => setWaitlistRole(null)} />}
    </div>
  );
}

function sectionTitleStyle(): React.CSSProperties {
  return {
    fontFamily: 'var(--display)',
    fontSize: 13,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--text-soft)',
    margin: '0 0 18px',
  };
}

function PlanCard({
  tier,
  price,
  sla,
  highlight,
  onClick,
}: {
  tier: string;
  price: string;
  sla: string;
  highlight?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className="card"
      style={{
        padding: 22,
        border: highlight ? '1.5px solid var(--teal)' : undefined,
        background: highlight ? 'var(--teal-soft)' : undefined,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>{tier}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 30, fontWeight: 700, marginBottom: 4 }}>
        {price}
        <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-faint)' }}>/mo</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-faint)', marginBottom: 16 }}>{sla}</div>
      <button className={highlight ? 'btn btn-primary' : 'btn'} style={{ width: '100%' }} onClick={onClick}>
        Join waitlist — {tier}
      </button>
    </div>
  );
}

function WaitlistModal({ role, onClose }: { role: 'customer' | 'designer'; onClose: () => void }) {
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [alreadyOnList, setAlreadyOnList] = useState(false);

  async function handleSubmit() {
    if (!name.trim() || !email.trim()) return;
    setSubmitting(true);
    try {
      const { alreadyOnList } = await api.waitlist.submit({ role, name: name.trim(), email: email.trim(), details: details.trim() || undefined });
      setAlreadyOnList(alreadyOnList);
      setSubmitted(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Something went wrong', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(10, 11, 14, 0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}
    >
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 420, width: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {submitted ? (
          <>
            <h2 style={{ margin: 0, fontFamily: 'var(--display)', fontSize: 20 }}>
              {alreadyOnList ? "You're already on the list" : "You're on the list!"}
            </h2>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-faint)' }}>
              {alreadyOnList
                ? `${email} is already on the ${role} waitlist — no need to sign up again, we'll be in touch.`
                : `We'll reach out at ${email} to get you set up.`}
            </p>
            <button className="btn btn-primary" onClick={onClose}>
              Close
            </button>
          </>
        ) : (
          <>
            <span
              style={{
                display: 'inline-flex',
                width: 'fit-content',
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                background: 'var(--teal-soft)',
                color: 'var(--teal)',
                padding: '3px 9px',
                borderRadius: 999,
              }}
            >
              {role === 'customer' ? 'Customer waitlist' : 'Designer waitlist'}
            </span>
            <h2 style={{ margin: 0, fontFamily: 'var(--display)', fontSize: 20 }}>
              {role === 'customer' ? 'Get started' : 'Apply as a designer'}
            </h2>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-faint)' }}>
              {role === 'customer'
                ? "Tell us a bit about what you need — we'll reach out to get you set up."
                : "Tell us about your work — we'll review and follow up."}
            </p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', fontSize: 14 }}
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', fontSize: 14 }}
            />
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder={role === 'customer' ? 'What kind of videos do you need? (brand, product, platform...)' : 'Portfolio link, specialty, availability...'}
              style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', fontSize: 14, minHeight: 74, resize: 'vertical' }}
            />
            <button className="btn btn-primary" disabled={submitting || !name.trim() || !email.trim()} onClick={handleSubmit}>
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
