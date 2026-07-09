import { useRef, useState } from 'react';

// Native <audio controls> collapses into a "..." overflow menu once the
// element is narrower than the browser needs for its full control bar —
// useless in a ~100px tile. A single play/pause button avoids that, and a
// module-level reference means starting one clip always pauses whichever
// other clip (anywhere on the page) was already playing.
let currentlyPlaying: HTMLAudioElement | null = null;

export function AudioPlayButton({ src, size = 28 }: { src: string; size?: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (currentlyPlaying && currentlyPlaying !== audio) currentlyPlaying.pause();
      audio.play();
      currentlyPlaying = audio;
    } else {
      audio.pause();
    }
  }

  return (
    <>
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        style={{ display: 'none' }}
      />
      <button
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          border: '1px solid var(--line)',
          background: playing ? 'var(--teal)' : 'var(--surface)',
          color: playing ? '#f0f6f4' : 'var(--text-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          fontSize: Math.round(size * 0.4),
          flexShrink: 0,
        }}
      >
        {playing ? '⏸' : '▶'}
      </button>
    </>
  );
}
