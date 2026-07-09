// Captures a JPEG frame from a video — used because mobile browsers
// frequently won't render a <video preload="metadata"> frame at all
// (especially over cellular or with data-saver on), so a real stored
// thumbnail is the only reliable preview across devices.
function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    function onSeeked() {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Thumbnail capture failed'))),
        'image/jpeg',
        0.8
      );
    }

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('loadeddata', () => {
      video.currentTime = Math.min(1, video.duration / 2 || 0);
    }, { once: true });
    video.addEventListener('error', () => reject(new Error('Video failed to load')), { once: true });
  });
}

export function captureVideoThumbnailFromFile(file: File): Promise<Blob> {
  const video = document.createElement('video');
  const url = URL.createObjectURL(file);
  video.src = url;
  return captureFrame(video).finally(() => URL.revokeObjectURL(url));
}

export function captureVideoThumbnailFromUrl(url: string): Promise<Blob> {
  const video = document.createElement('video');
  video.src = url;
  return captureFrame(video);
}
