export type PixelCrop = { x: number; y: number; width: number; height: number };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Renders just the cropped region to a canvas and re-encodes as JPEG — the
// output is what actually gets uploaded, so a portrait crop from a random
// internet photo lands in the library already framed correctly.
export async function cropImageToFile(imageSrc: string, crop: PixelCrop, fileName: string): Promise<File> {
  const img = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('Failed to encode cropped image');

  const baseName = fileName.replace(/\.[^./]+$/, '');
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
}
