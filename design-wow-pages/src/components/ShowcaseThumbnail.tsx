import { useState } from 'react';
import { api } from '../lib/api';

// Videos show a stored JPEG frame (not the raw <video> element) — mobile
// browsers frequently won't render a <video preload="metadata"> frame at
// all. Falls back to the live <video> tag only if no thumbnail was ever
// generated (e.g. an older item, or capture failed at add-time).
//
// Renders at the media's own natural aspect ratio (portrait/mobile stays
// tall, landscape stays wide) rather than force-cropping everything into a
// square — a 9:16 phone recording squeezed into a square tile looks wrong.
// Only the width is fixed (the caller's column width); height follows the
// image's intrinsic size, capped so an extreme outlier can't blow out the
// grid.
export function ShowcaseThumbnail({
  itemId,
  mimeType,
  fileName,
  width = 160,
}: {
  itemId: string;
  mimeType: string;
  fileName: string;
  width?: number;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const mediaStyle = {
    width: '100%',
    height: 'auto',
    maxHeight: width * 1.8,
    display: 'block',
    objectFit: 'cover' as const,
    borderRadius: 10,
  };

  if (mimeType.startsWith('image/')) {
    return <img src={api.designers.showcase.fileUrl(itemId)} alt={fileName} style={mediaStyle} />;
  }

  if (mimeType.startsWith('video/')) {
    if (!thumbFailed) {
      return (
        <img
          src={api.designers.showcase.thumbnailUrl(itemId)}
          alt={fileName}
          onError={() => setThumbFailed(true)}
          style={mediaStyle}
        />
      );
    }
    // No thumbnail and no known dimensions yet — a reasonable landscape
    // guess beats forcing a square crop on what's likely a 16:9 clip.
    return (
      <video
        src={api.designers.showcase.fileUrl(itemId)}
        muted
        playsInline
        preload="metadata"
        style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 10, background: '#14161b' }}
      />
    );
  }

  return (
    <div
      style={{
        width: '100%',
        aspectRatio: '1',
        borderRadius: 10,
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase' }}>
        {mimeType === 'application/pdf' ? 'PDF' : 'File'}
      </span>
    </div>
  );
}
