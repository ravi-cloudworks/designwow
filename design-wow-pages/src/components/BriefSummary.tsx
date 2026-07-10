import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { api, type AssetChoice, type AssetRow, type RequestRow } from '../lib/api';
import { labelFor, parseChoice, titleCase } from '../lib/briefFields';
import {
  ASPECT_RATIOS,
  CTA_STYLES,
  GOALS,
  LANGUAGES,
  LENGTHS,
  PLATFORMS,
  SCRIPT_STYLES,
  SUBTITLE_OPTIONS,
  TARGET_AUDIENCES,
  TONES,
  VOICE_TYPES,
} from '../lib/industries';
import { GOAL_ICONS, TARGET_AUDIENCE_ICONS } from '../lib/pickerIcons';
import { AudioPlayButton } from './AudioPlayButton';
import { captureVideoThumbnailFromUrl } from '../lib/videoThumbnail';
import type { LightboxFile } from './FileLightbox';

function pillStyle(selected: boolean): CSSProperties {
  return {
    border: '1px solid var(--line)',
    background: selected ? 'var(--ink)' : 'var(--surface)',
    color: selected ? 'var(--paper)' : 'var(--text-faint)',
    borderColor: selected ? 'var(--ink)' : 'var(--line)',
    padding: '8px 14px',
    borderRadius: 999,
    fontSize: 13,
    opacity: selected ? 1 : 0.55,
  };
}

export function UpdatedBadge() {
  return (
    <span
      style={{
        fontSize: 9.5,
        fontWeight: 700,
        color: 'var(--teal)',
        background: 'var(--teal-soft)',
        borderRadius: 999,
        padding: '1px 6px',
        textTransform: 'uppercase',
      }}
    >
      Updated
    </span>
  );
}

function SectionCard({
  number,
  title,
  description,
  badge,
  children,
}: {
  number: number;
  title: string;
  description: string;
  badge?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'var(--ink)',
              color: 'var(--paper)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {number}
          </span>
          <h2 style={{ fontFamily: 'var(--display)', fontSize: 16, fontWeight: 700, margin: 0 }}>{title}</h2>
          {badge && <UpdatedBadge />}
        </div>
        <p style={{ margin: '6px 0 0 36px', fontSize: 12, color: 'var(--text-faint)' }}>{description}</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>{children}</div>
    </section>
  );
}

function FieldBlock({ label, badge, children }: { label: string; badge?: boolean; children: ReactNode }) {
  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>
        {label}
        {badge && <UpdatedBadge />}
      </label>
      {children}
    </div>
  );
}

function EmptyNote() {
  return <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-faint)', fontStyle: 'italic' }}>Not specified</p>;
}

function PlainText({ children }: { children: ReactNode }) {
  return <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{children}</p>;
}

function IconPillGrid({ options, value, icons }: { options: { value: string; label: string }[]; value: string | null; icons: Record<string, import('lucide-react').LucideIcon> }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      {options.map((o) => {
        const Icon = icons[o.value];
        const selected = value === o.value;
        return (
          <div
            key={o.value}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              border: `1.5px solid ${selected ? 'var(--teal)' : 'var(--line)'}`,
              background: selected ? 'var(--teal-soft)' : 'var(--surface)',
              borderRadius: 8,
              padding: '10px 6px',
              fontSize: 11.5,
              fontWeight: 600,
              opacity: selected ? 1 : 0.45,
            }}
          >
            {Icon && <Icon size={18} color={selected ? 'var(--teal)' : 'var(--text-faint)'} />}
            <span style={{ textAlign: 'center', color: selected ? 'var(--teal)' : 'var(--text-faint)' }}>{o.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function PillRow({ options, value }: { options: { value: string; label: string }[]; value: string | null }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => (
        <span key={o.value} style={{ ...pillStyle(value === o.value), fontSize: 11.5, padding: '6px 10px' }}>
          {o.label}
        </span>
      ))}
    </div>
  );
}

function choiceUrl(choice: AssetChoice): string {
  return choice.source === 'library' ? api.designers.library.fileUrl(choice.assetId) : api.assets.fileUrl(choice.assetId);
}

function ChoiceTile({ choice, kind, badge }: { choice: AssetChoice; kind: 'image' | 'audio'; badge?: 'Primary' | 'Backup' }) {
  const url = choiceUrl(choice);
  const [loaded, setLoaded] = useState(false);
  const color = badge === 'Backup' ? 'var(--amber)' : 'var(--teal)';
  const soft = badge === 'Backup' ? 'var(--amber-soft)' : 'var(--teal-soft)';
  return (
    <div style={{ width: 110, border: `1.5px solid ${color}`, borderRadius: 8, padding: 6, background: soft }}>
      {badge && (
        <p style={{ margin: '0 0 4px', fontSize: 9.5, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{badge}</p>
      )}
      {kind === 'image' ? (
        <div style={{ position: 'relative', width: '100%', height: 100, marginBottom: 4 }}>
          {!loaded && <div style={{ position: 'absolute', inset: 0, borderRadius: 6, background: 'var(--surface-2)', animation: 'pulse 1.4s ease-in-out infinite' }} />}
          <img
            src={url}
            alt={choice.label}
            onLoad={() => setLoaded(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, display: loaded ? 'block' : 'none', position: 'absolute', inset: 0 }}
          />
        </div>
      ) : (
        <div style={{ width: '100%', height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
          <AudioPlayButton src={url} />
        </div>
      )}
      <p style={{ margin: 0, fontSize: 10.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{choice.label}</p>
    </div>
  );
}

function ChoicePair({ primary, backup, kind }: { primary: AssetChoice | null; backup: AssetChoice | null; kind: 'image' | 'audio' }) {
  if (!primary && !backup) return <EmptyNote />;
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {primary && <ChoiceTile choice={primary} kind={kind} badge={backup ? 'Primary' : undefined} />}
      {backup && <ChoiceTile choice={backup} kind={kind} badge="Backup" />}
    </div>
  );
}

function FileThumb({ asset, onOpen }: { asset: AssetRow; onOpen: () => void }) {
  const isImage = asset.mime_type.startsWith('image/');
  const isVideo = asset.mime_type.startsWith('video/');
  const url = api.assets.fileUrl(asset.id);
  const [videoThumb, setVideoThumb] = useState<string | null>(null);

  useEffect(() => {
    if (!isVideo) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    captureVideoThumbnailFromUrl(url)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setVideoThumb(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, isVideo]);

  return (
    <button
      onClick={onOpen}
      aria-label={asset.file_name}
      style={{ display: 'block', width: 84, border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
    >
      <div
        style={{
          width: 84,
          height: 84,
          borderRadius: 8,
          border: '1px solid var(--line)',
          background: 'var(--surface-2)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isImage ? (
          <img src={url} alt={asset.file_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : isVideo && videoThumb ? (
          <img src={videoThumb} alt={asset.file_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase' }}>
            {asset.mime_type === 'application/pdf' ? 'PDF' : isVideo ? 'Video' : 'File'}
          </span>
        )}
      </div>
      <p style={{ margin: '4px 0 0', fontSize: 10.5, color: 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {asset.file_name}
      </p>
    </button>
  );
}

function FileThumbGrid({ assets, onOpen }: { assets: AssetRow[]; onOpen: (index: number) => void }) {
  if (assets.length === 0) return <EmptyNote />;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {assets.map((a, i) => (
        <FileThumb key={a.id} asset={a} onOpen={() => onOpen(i)} />
      ))}
    </div>
  );
}

// Read-only mirror of NewRequestPage's 11 structured-brief sections, filled
// with this request's actual values — so reviewing a submitted brief looks
// like the same form the customer filled in, not a flat text dump. Approval
// & Revision Rules (section 12 on /new) is static boilerplate, not data, so
// it's intentionally left out here.
export function BriefSummary({
  request,
  assets,
  links,
  onOpenLightbox,
  changedFields = new Set<string>(),
}: {
  request: RequestRow;
  assets: AssetRow[];
  links: { url: string }[];
  onOpenLightbox: (lightbox: { files: LightboxFile[]; index: number }) => void;
  // Field keys that have at least one change-log entry — draws an
  // "Updated" badge next to that field/section so a viewer can spot what
  // moved since the original submission.
  changedFields?: Set<string>;
}) {
  const changed = (key: string) => changedFields.has(key);
  const logoAssets = assets.filter((a) => a.type === 'logo');
  const productAssets = assets.filter((a) => a.type === 'product_file');
  const referenceAssets = assets.filter((a) => a.type === 'reference_file');

  // A freshly-picked "upload my own" choice starts with an empty assetId
  // placeholder that only resolves once the file finishes uploading — if a
  // draft was abandoned mid-upload, that placeholder can persist. Treat it
  // as unset rather than pointing an <img> at a nonexistent asset.
  function resolvedChoice(json: string | null): AssetChoice | null {
    const choice = parseChoice(json);
    return choice && choice.assetId ? choice : null;
  }

  const avatarChoice = resolvedChoice(request.avatar_choice);
  const avatarBackupChoice = resolvedChoice(request.avatar_backup_choice);
  const backgroundChoice = resolvedChoice(request.background_choice);
  const backgroundBackupChoice = resolvedChoice(request.background_backup_choice);
  const moodChoice = resolvedChoice(request.mood_choice);
  const musicChoice = resolvedChoice(request.music_choice);
  const musicBackupChoice = resolvedChoice(request.music_backup_choice);

  const lengthKnown = LENGTHS.includes(request.video_length_sec);

  function openFiles(fileAssets: AssetRow[], index: number) {
    onOpenLightbox({
      files: fileAssets.map((a) => ({ name: a.file_name, mimeType: a.mime_type, url: api.assets.fileUrl(a.id) })),
      index,
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {request.designer_name && (
        <div className="card" style={{ padding: '14px 20px' }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Designer</p>
          <p style={{ margin: '3px 0 0', fontSize: 14 }}>{request.designer_name}</p>
        </div>
      )}

      <SectionCard number={1} title="Brand Details" description="Product or brand name, description, logo, product photos, and brand colors.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <FieldBlock label="Product description" badge={changed('product_description')}>
            <PlainText>{request.product_description}</PlainText>
          </FieldBlock>
          <FieldBlock label="Brand colors" badge={changed('brand_color_primary') || changed('brand_color_secondary')}>
            {request.brand_color_primary || request.brand_color_secondary ? (
              <div style={{ display: 'flex', gap: 16 }}>
                {[
                  { label: 'Primary', hex: request.brand_color_primary },
                  { label: 'Secondary', hex: request.brand_color_secondary },
                ]
                  .filter((c) => c.hex)
                  .map((c) => (
                    <div key={c.label}>
                      <div style={{ width: 44, height: 44, borderRadius: 8, border: '1.5px solid var(--line)', background: c.hex! }} />
                      <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-faint)' }}>{c.label}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-soft)' }}>{c.hex!.toUpperCase()}</p>
                    </div>
                  ))}
              </div>
            ) : (
              <EmptyNote />
            )}
          </FieldBlock>
        </div>
        <FieldBlock label="Logo">
          <FileThumbGrid assets={logoAssets} onOpen={(i) => openFiles(logoAssets, i)} />
        </FieldBlock>
        <FieldBlock label="Product photos / footage">
          <FileThumbGrid assets={productAssets} onOpen={(i) => openFiles(productAssets, i)} />
        </FieldBlock>
      </SectionCard>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
        <SectionCard number={2} title="Campaign Goal" description="What this video needs to achieve." badge={changed('goal')}>
          <IconPillGrid options={GOALS} value={request.goal} icons={GOAL_ICONS} />
        </SectionCard>
        <SectionCard number={3} title="Target Audience" description="Who this video is speaking to." badge={changed('target_audience')}>
          <IconPillGrid options={TARGET_AUDIENCES} value={request.target_audience} icons={TARGET_AUDIENCE_ICONS} />
        </SectionCard>
      </div>

      <SectionCard number={4} title="Script Direction" description="The story, tone, and specific dialogue or beats requested.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <FieldBlock label="Script style" badge={changed('script_style')}>
            <PillRow options={SCRIPT_STYLES} value={request.script_style} />
          </FieldBlock>
          <FieldBlock label="Tone" badge={changed('tone')}>
            <PillRow options={TONES.map((t) => ({ value: t, label: titleCase(t) }))} value={request.tone} />
          </FieldBlock>
        </div>
        <FieldBlock label="Story direction / dialogue" badge={changed('story_direction')}>
          <PlainText>{request.story_direction}</PlainText>
        </FieldBlock>
      </SectionCard>

      <SectionCard number={5} title="Video Settings" description="Platform, length, and technical delivery preferences.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18 }}>
          <FieldBlock label="Platform">
            <PillRow options={PLATFORMS.map((p) => ({ value: p, label: titleCase(p) }))} value={request.platform} />
          </FieldBlock>
          <FieldBlock label="Duration">
            {lengthKnown ? (
              <PillRow options={LENGTHS.map((len) => ({ value: String(len), label: `${len}s` }))} value={String(request.video_length_sec)} />
            ) : (
              <PlainText>{request.video_length_note || `${request.video_length_sec}s`}</PlainText>
            )}
          </FieldBlock>
          <FieldBlock label="Aspect ratio">
            <PlainText>{labelFor(ASPECT_RATIOS, request.aspect_ratio) ?? '—'}</PlainText>
          </FieldBlock>
          <FieldBlock label="Language">
            <PlainText>{labelFor(LANGUAGES, request.language) ?? '—'}</PlainText>
          </FieldBlock>
          <FieldBlock label="Voice type">
            <PlainText>{labelFor(VOICE_TYPES, request.voice_type) ?? '—'}</PlainText>
          </FieldBlock>
          <FieldBlock label="Subtitles">
            <PlainText>{labelFor(SUBTITLE_OPTIONS, request.subtitles) ?? '—'}</PlainText>
          </FieldBlock>
        </div>
      </SectionCard>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
        <SectionCard number={6} title="Avatar Selection" description="Primary + backup avatar preset from the designer's library, or a customer upload.">
          <ChoicePair primary={avatarChoice} backup={avatarBackupChoice} kind="image" />
        </SectionCard>
        <SectionCard number={7} title="Background Selection" description="Primary + backup scene from the designer's library, or a customer upload.">
          <ChoicePair primary={backgroundChoice} backup={backgroundBackupChoice} kind="image" />
        </SectionCard>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
        <SectionCard number={8} title="Visual Style / Mood" description="The overall look and feel of the video.">
          {moodChoice ? <ChoiceTile choice={moodChoice} kind="image" /> : <EmptyNote />}
        </SectionCard>
        <SectionCard number={9} title="Music Selection" description="Primary + backup track from the designer's library, or a customer upload.">
          <ChoicePair primary={musicChoice} backup={musicBackupChoice} kind="audio" />
        </SectionCard>
      </div>

      <SectionCard number={10} title="Call-to-Action" description="How the video should ask viewers to act.">
        <FieldBlock label="Call to action style" badge={changed('cta_style')}>
          <PillRow options={CTA_STYLES} value={request.cta_style} />
        </FieldBlock>
        {/* Picking a style auto-fills this with the same label — only worth a
            second field once it's been customized (e.g. via an Update Brief edit). */}
        {request.cta && request.cta !== labelFor(CTA_STYLES, request.cta_style) && (
          <FieldBlock label="Call to action text" badge={changed('cta')}>
            <PlainText>{request.cta}</PlainText>
          </FieldBlock>
        )}
      </SectionCard>

      <SectionCard number={11} title="References & Notes" description="Anything else that doesn't fit above — competitor examples, brand guidelines, do's and don'ts.">
        <FieldBlock label="Reference files">
          <FileThumbGrid assets={referenceAssets} onOpen={(i) => openFiles(referenceAssets, i)} />
        </FieldBlock>
        <FieldBlock label="Reference links">
          {links.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {links.map((l, i) => (
                <a key={i} href={l.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: 'var(--teal)', wordBreak: 'break-all' }}>
                  {l.url}
                </a>
              ))}
            </div>
          ) : (
            <EmptyNote />
          )}
        </FieldBlock>
        <FieldBlock label="Do's and don'ts" badge={changed('restrictions')}>
          {request.restrictions ? <PlainText>{request.restrictions}</PlainText> : <EmptyNote />}
        </FieldBlock>
        <FieldBlock label="Additional notes" badge={changed('additional_notes')}>
          {request.additional_notes ? <PlainText>{request.additional_notes}</PlainText> : <EmptyNote />}
        </FieldBlock>
      </SectionCard>
    </div>
  );
}
