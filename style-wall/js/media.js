import { LIMITS } from './model.js';

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('這個圖片格式讀不了。請改存成 JPEG 或 PNG。'));
    };
    image.src = url;
  });
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('圖片壓縮失敗。'));
        else resolve(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}

export async function compressImageFile(file, maxEdge = LIMITS.maxImageEdge) {
  const image = await loadImage(file);
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  let quality = 0.82;
  let blob = await canvasToJpeg(canvas, quality);
  while (blob.size > 1.5 * 1024 * 1024 && quality > 0.55) {
    quality -= 0.12;
    blob = await canvasToJpeg(canvas, quality);
  }
  return { blob, width, height };
}

function once(target, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('讀取影片逾時。')), 12000);
    target.addEventListener(
      event,
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function extractPoster(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.src = url;
  video.style.position = 'fixed';
  video.style.left = '-9999px';
  document.body.appendChild(video);
  try {
    await once(video, 'loadeddata');
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const target = duration > 0.4 ? Math.min(0.8, duration * 0.15) : 0;
    if (target > 0) {
      video.currentTime = target;
      await once(video, 'seeked');
    }
    const maxEdge = LIMITS.maxImageEdge;
    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth || 1, video.videoHeight || 1));
    const width = Math.max(1, Math.round((video.videoWidth || 320) * scale));
    const height = Math.max(1, Math.round((video.videoHeight || 180) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(video, 0, 0, width, height);
    const blob = await canvasToJpeg(canvas, 0.82);
    return { blob, width, height };
  } finally {
    URL.revokeObjectURL(url);
    video.remove();
  }
}

export async function blobToBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}
