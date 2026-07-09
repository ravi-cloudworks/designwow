import { useEffect } from 'react';
import type { CSSProperties } from 'react';

export type LightboxFile = { name: string; mimeType: string; url: string };

export function FileLightbox({
  files,
  index,
  onClose,
  onNavigate,
}: {
  files: LightboxFile[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const file = files[index];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onNavigate((index + 1) % files.length);
      if (e.key === 'ArrowLeft') onNavigate((index - 1 + files.length) % files.length);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, files.length, onClose, onNavigate]);

  if (!file) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10, 11, 14, 0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 12,
      }}
    >
      <button onClick={(e) => { e.stopPropagation(); onClose(); }} aria-label="Close preview" style={closeBtnStyle()}>
        ×
      </button>

      {files.length > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate((index - 1 + files.length) % files.length); }}
          aria-label="Previous file"
          style={navBtnStyle('left')}
        >
          ‹
        </button>
      )}

      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, maxWidth: '96vw' }}>
        {file.mimeType.startsWith('image/') && (
          <img src={file.url} alt={file.name} style={{ maxWidth: '96vw', maxHeight: '90vh', borderRadius: 8, objectFit: 'contain' }} />
        )}
        {file.mimeType.startsWith('video/') && (
          // Height-capped rather than width-capped — a portrait/mobile-format
          // clip's width otherwise follows its own aspect ratio down to a
          // narrow strip against a big dark backdrop, reading as "not really
          // fullscreen" and pushing people to the video's own native
          // fullscreen control as an extra step.
          <video src={file.url} controls autoPlay style={{ maxWidth: '96vw', maxHeight: '90vh', borderRadius: 8, background: '#000' }} />
        )}
        {file.mimeType === 'application/pdf' && (
          <iframe src={file.url} title={file.name} style={{ width: '90vw', height: '90vh', border: 'none', borderRadius: 8, background: '#fff' }} />
        )}
        {!file.mimeType.startsWith('image/') && !file.mimeType.startsWith('video/') && file.mimeType !== 'application/pdf' && (
          <a href={file.url} target="_blank" rel="noreferrer" style={{ color: '#fff', fontSize: 14 }}>
            Can't preview this file type — open in new tab
          </a>
        )}
        <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12.5 }}>
          {file.name}
          {files.length > 1 && ` · ${index + 1} of ${files.length}`}
        </div>
      </div>

      {files.length > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate((index + 1) % files.length); }}
          aria-label="Next file"
          style={navBtnStyle('right')}
        >
          ›
        </button>
      )}
    </div>
  );
}

function closeBtnStyle(): CSSProperties {
  return {
    position: 'absolute',
    top: 20,
    right: 24,
    width: 36,
    height: 36,
    borderRadius: '50%',
    border: 'none',
    background: 'rgba(255,255,255,0.12)',
    color: '#fff',
    fontSize: 18,
    cursor: 'pointer',
  };
}

function navBtnStyle(side: 'left' | 'right'): CSSProperties {
  const base: CSSProperties = {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    width: 44,
    height: 44,
    borderRadius: '50%',
    border: 'none',
    background: 'rgba(255,255,255,0.12)',
    color: '#fff',
    fontSize: 22,
    cursor: 'pointer',
  };
  return side === 'left' ? { ...base, left: 24 } : { ...base, right: 24 };
}
