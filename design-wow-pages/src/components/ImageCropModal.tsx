import { useCallback, useEffect, useMemo, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { cropImageToFile } from '../lib/cropImage';

// Lets a designer step through a batch of just-picked images, crop each to
// the portrait frame the picker expects, or skip ones that are already
// framed correctly — so they don't have to pre-crop random internet photos
// in another tool first.
export function ImageCropModal({
  files,
  aspect = 3 / 4,
  onDone,
  onCancel,
}: {
  files: File[];
  aspect?: number;
  onDone: (files: File[]) => void;
  onCancel: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<number, File>>({});
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);

  const objectUrls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => objectUrls.forEach((u) => URL.revokeObjectURL(u)), [objectUrls]);

  // Reset the live crop position whenever the viewed image changes.
  useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
  }, [index]);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => setCroppedAreaPixels(areaPixels), []);

  function finish(finalDecisions: Record<number, File>) {
    onDone(files.map((f, i) => finalDecisions[i] ?? f));
  }

  function advance(next: Record<number, File>) {
    setDecisions(next);
    if (index + 1 >= files.length) {
      finish(next);
    } else {
      setIndex(index + 1);
    }
  }

  async function handleUseCrop() {
    if (!croppedAreaPixels) return;
    setProcessing(true);
    try {
      const cropped = await cropImageToFile(objectUrls[index], croppedAreaPixels, files[index].name);
      advance({ ...decisions, [index]: cropped });
    } finally {
      setProcessing(false);
    }
  }

  function handleSkip() {
    advance(decisions);
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,11,14,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div style={{ background: 'var(--surface)', borderRadius: 12, width: 420, maxWidth: '100%', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <strong style={{ fontSize: 14 }}>
            Crop image {index + 1} of {files.length}
          </strong>
          <button onClick={onCancel} aria-label="Cancel" style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-faint)' }}>
            ×
          </button>
        </div>

        <div style={{ position: 'relative', width: '100%', height: 360, background: '#111', borderRadius: 8, overflow: 'hidden' }}>
          <Cropper
            image={objectUrls[index]}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        <input
          type="range"
          min={1}
          max={3}
          step={0.05}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          style={{ width: '100%', margin: '12px 0' }}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <button className="btn" disabled={index === 0} onClick={() => setIndex(index - 1)} style={{ fontSize: 12.5 }}>
            ← Prev
          </button>
          <button className="btn" disabled={index + 1 >= files.length} onClick={() => setIndex(index + 1)} style={{ fontSize: 12.5 }}>
            Next →
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" style={{ flex: 1 }} onClick={handleSkip} disabled={processing}>
            Skip (use as-is)
          </button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleUseCrop} disabled={processing || !croppedAreaPixels}>
            {processing ? 'Cropping…' : 'Use this crop'}
          </button>
        </div>

        <button
          onClick={() => finish(decisions)}
          disabled={processing}
          style={{ display: 'block', margin: '14px auto 0', border: 'none', background: 'none', color: 'var(--text-faint)', fontSize: 12, cursor: 'pointer' }}
        >
          Done — add all {files.length} images as-is from here
        </button>
      </div>
    </div>
  );
}
