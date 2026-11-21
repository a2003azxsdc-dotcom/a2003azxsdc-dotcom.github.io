import { getBlob } from './storage.js';

export function rawUrl(cfg, path, stamp) {
  const encoded = String(path)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  const mark = encodeURIComponent(stamp || Date.now());
  return `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/${encoded}?t=${mark}`;
}

export function attachImage(img, path, cfg, stamp) {
  if (!path) return;
  img.addEventListener('error', () => fallback(img, path, cfg, stamp, 'src'));
  img.src = path;
}

export function attachVideo(video, path, cfg, stamp) {
  if (!path) return;
  video.addEventListener('error', () => fallback(video, path, cfg, stamp, 'src'));
  video.src = path;
}

async function fallback(node, path, cfg, stamp, prop) {
  if (node.dataset.fb === 'raw') return;
  if (node.dataset.fb !== 'blob') {
    node.dataset.fb = 'blob';
    try {
      const record = await getBlob(path);
      if (record?.blob) {
        node[prop] = URL.createObjectURL(record.blob);
        return;
      }
    } catch {
      // 本機沒有備份就改走原始檔網址。
    }
  }
  node.dataset.fb = 'raw';
  if (cfg?.owner && cfg?.repo) node[prop] = rawUrl(cfg, path, stamp);
}
