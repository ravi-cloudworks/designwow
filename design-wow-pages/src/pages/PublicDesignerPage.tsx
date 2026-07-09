import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type PublicDesignerProfile, type ShowcaseItem, type User } from '../lib/api';
import { Avatar } from '../components/Avatar';
import { FileLightbox, type LightboxFile } from '../components/FileLightbox';
import { ShowcaseThumbnail } from '../components/ShowcaseThumbnail';

export function PublicDesignerPage() {
  const { id } = useParams();
  const [profile, setProfile] = useState<PublicDesignerProfile | null>(null);
  const [items, setItems] = useState<ShowcaseItem[]>([]);
  const [viewer, setViewer] = useState<User | null | 'unknown'>('unknown');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [lightbox, setLightbox] = useState<{ files: LightboxFile[]; index: number } | null>(null);

  useEffect(() => {
    if (!id) return;
    api.designers
      .public(id)
      .then(({ profile, items }) => {
        setProfile(profile);
        setItems(items);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));

    api.me()
      .then(({ user }) => setViewer(user))
      .catch(() => setViewer(null));
  }, [id]);

  if (loading) return <p style={{ padding: 32, color: 'var(--text-faint)' }}>Loading…</p>;
  if (notFound || !profile) return <p style={{ padding: 32 }}>Designer not found.</p>;

  const tags: string[] = profile.specialty_tags ? JSON.parse(profile.specialty_tags) : [];
  const lightboxFiles: LightboxFile[] = items.map((it) => ({
    name: it.file_name,
    mimeType: it.mime_type,
    url: api.designers.showcase.fileUrl(it.id),
  }));

  const ctaHref =
    viewer === 'unknown'
      ? undefined
      : viewer && viewer.role === 'customer'
      ? `/new?designer=${profile.id}`
      : !viewer
      ? api.googleLoginUrl(`/new?designer=${profile.id}`)
      : undefined; // viewer is a designer themselves — no CTA

  return (
    <div className="public-profile-page" style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: 'inherit', width: 'fit-content' }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--teal)', flex: 'none' }} />
        <span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em' }}>Design Wow</span>
      </Link>

      <div className="public-profile-header">
        <Avatar name={profile.name} avatarUrl={profile.avatar_url} size={84} />
        <div className="public-profile-info">
          <h1 style={{ margin: '0 0 4px', fontFamily: 'var(--display)', fontSize: 26, fontWeight: 700 }}>{profile.name}</h1>
          {profile.bio && <p style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--text-soft)', maxWidth: 480 }}>{profile.bio}</p>}
          {tags.length > 0 && (
            <div className="public-profile-tags">
              {tags.map((t) => (
                <span
                  key={t}
                  style={{ fontSize: 11.5, fontWeight: 600, background: 'var(--surface-2)', padding: '4px 10px', borderRadius: 999 }}
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="public-profile-ctas">
          {ctaHref && (
            <a href={ctaHref} className="btn btn-primary" style={{ textDecoration: 'none', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              Send a request to {profile.name.split(' ')[0]}
            </a>
          )}
          {profile.phone && (
            <a
              href={`https://wa.me/${profile.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
                `Hi ${profile.name.split(' ')[0]}, I found your work on Design Wow and I'd like to talk about a project.`
              )}`}
              target="_blank"
              rel="noreferrer"
              style={{
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '9px 16px',
                borderRadius: 8,
                fontSize: 13.5,
                fontWeight: 600,
                background: '#25D366',
                color: '#0b3d20',
              }}
            >
              <WhatsAppIcon /> WhatsApp
            </a>
          )}
        </div>
      </div>

      <div>
        <h2
          style={{
            fontFamily: 'var(--display)',
            fontSize: 13,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-soft)',
            margin: '0 0 14px',
          }}
        >
          Work
        </h2>
        {items.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-faint)' }}>No showcased work yet.</p>
        ) : (
          <div className="public-profile-gallery">
            {items.map((it, i) => (
              <button
                key={it.id}
                className="public-profile-gallery-item"
                onClick={() => setLightbox({ files: lightboxFiles, index: i })}
                style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
              >
                <ShowcaseThumbnail itemId={it.id} mimeType={it.mime_type} fileName={it.file_name} width={280} />
                {it.caption && <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-soft)' }}>{it.caption}</p>}
              </button>
            ))}
          </div>
        )}
      </div>

      {lightbox && (
        <FileLightbox
          files={lightbox.files}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNavigate={(index) => setLightbox((lb) => (lb ? { ...lb, index } : lb))}
        />
      )}
    </div>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.47 14.38c-.29-.15-1.7-.84-1.97-.93-.26-.1-.46-.15-.65.15-.2.29-.75.93-.92 1.12-.17.2-.34.22-.63.08-.29-.15-1.22-.45-2.32-1.43-.86-.76-1.44-1.71-1.6-2-.17-.29-.02-.45.13-.6.13-.13.29-.34.44-.51.15-.17.2-.29.29-.48.1-.2.05-.37-.02-.51-.08-.15-.65-1.56-.89-2.14-.24-.57-.47-.49-.65-.5h-.56c-.2 0-.51.07-.78.37-.26.29-1.02 1-1.02 2.44 0 1.43 1.05 2.82 1.19 3.01.15.2 2.06 3.15 5 4.42.7.3 1.24.48 1.67.61.7.22 1.34.19 1.84.12.56-.08 1.7-.7 1.95-1.37.24-.68.24-1.26.17-1.38-.07-.12-.26-.2-.55-.34z" />
      <path d="M12.02 2C6.5 2 2 6.5 2 12.02c0 1.87.51 3.66 1.47 5.24L2 22l4.9-1.43a9.97 9.97 0 0 0 5.12 1.42h.01c5.52 0 10-4.48 10-10S17.54 2 12.02 2zm0 18.13h-.01a8.1 8.1 0 0 1-4.14-1.14l-.3-.18-3.08.9.9-3-.2-.31a8.13 8.13 0 0 1-1.24-4.38c0-4.5 3.66-8.16 8.17-8.16 2.18 0 4.23.85 5.77 2.4a8.1 8.1 0 0 1 2.39 5.77c0 4.5-3.66 8.1-8.27 8.1z" />
    </svg>
  );
}
