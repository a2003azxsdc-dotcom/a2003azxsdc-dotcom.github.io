export const CATEGORIES = ['運鏡', '燈光氛圍', '風格', '節奏剪輯', '情緒'];

export const LIMITS = {
  maxVideoBytes: 50 * 1024 * 1024,
  inlineVideoBytes: 12 * 1024 * 1024,
  warnVideoBytes: 20 * 1024 * 1024,
  maxImageEdge: 1600,
};

export const TABS = [
  {
    id: 'feel',
    label: '感覺',
    fields: [
      ['feeling', '一句感覺'],
      ['style', '風格'],
      ['mood', '情緒'],
      ['when', '何時用'],
      ['spokenName', '建議口語叫法'],
    ],
  },
  {
    id: 'camera',
    label: '鏡頭運鏡',
    fields: [
      ['camera', '鏡頭與構圖'],
      ['movement', '運鏡'],
      ['rhythm', '節奏剪輯'],
    ],
  },
  {
    id: 'light',
    label: '燈光氛圍',
    fields: [['lighting', '燈光氛圍']],
  },
  {
    id: 'prompt',
    label: '提示詞',
    fields: [['prompt', '提示詞片段']],
  },
];

const FIELD_MAP = [
  ['一句感覺', 'feeling'],
  ['風格', 'style'],
  ['鏡頭與構圖', 'camera'],
  ['運鏡', 'movement'],
  ['燈光氛圍', 'lighting'],
  ['節奏剪輯', 'rhythm'],
  ['情緒', 'mood'],
  ['何時用', 'when'],
  ['提示詞片段', 'prompt'],
  ['建議口語叫法', 'spokenName'],
];

export function unwrapItems(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  throw new Error('items.json 格式不對');
}

export function sortItems(items) {
  return [...items].sort((a, b) => {
    const byTime = (b.updatedAt || '').localeCompare(a.updatedAt || '');
    if (byTime) return byTime;
    return (a.order ?? 9999) - (b.order ?? 9999);
  });
}

export function mergeItems(remoteItems, overlayItems, tombstones) {
  const map = new Map();
  for (const item of remoteItems || []) {
    if (item && item.id) map.set(item.id, item);
  }
  for (const item of overlayItems || []) {
    if (!item || !item.id) continue;
    const prev = map.get(item.id);
    if (!prev || (item.updatedAt || '') >= (prev.updatedAt || '')) map.set(item.id, item);
  }
  const tombs = tombstones || {};
  for (const [id, at] of Object.entries(tombs)) {
    const cur = map.get(id);
    if (cur && (cur.updatedAt || '') <= at) map.delete(id);
  }
  return sortItems([...map.values()]);
}

export function filterItems(items, { category, query } = {}) {
  const q = (query || '').trim().toLowerCase();
  return items.filter((item) => {
    if (category && category !== '全部' && !(item.tags || []).includes(category)) return false;
    if (!q) return true;
    const hay = [
      item.title,
      item.spokenName,
      item.feeling,
      item.style,
      item.camera,
      item.movement,
      item.lighting,
      item.rhythm,
      item.mood,
      item.when,
      item.prompt,
      item.reason,
      item.sourceDetail,
      item.module,
      item.videoLabel,
      ...(item.tags || []),
      ...(item.freeTags || []),
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    return hay.includes(q);
  });
}

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeAnalysis(raw) {
  const src = raw || {};
  const out = {};
  for (const [zh, key] of FIELD_MAP) out[key] = asText(src[zh] ?? src[key]);
  const given = Array.isArray(src['標籤']) ? src['標籤'] : src.tags || [];
  const tags = [];
  const spilled = [];
  for (const tag of given) {
    const text = asText(tag);
    if (!text) continue;
    if (CATEGORIES.includes(text)) tags.push(text);
    else spilled.push(text);
  }
  const free = Array.isArray(src['自由標籤']) ? src['自由標籤'] : src.freeTags || [];
  out.tags = [...new Set(tags)];
  out.freeTags = [...new Set([...free, ...spilled].map(asText).filter(Boolean))].slice(0, 8);
  return out;
}

export function parseModelJson(text) {
  let source = String(text || '').trim();
  source = source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start >= 0 && end > start) source = source.slice(start, end + 1);
  return JSON.parse(source);
}

export function mockAnalysis({ description, title } = {}) {
  const reason = asText(description) || '（沒有描述）';
  return normalizeAnalysis({
    一句感覺: '測試分析：一段平靜、可再拍的參考。',
    風格: '測試風格，乾淨、好讀。',
    鏡頭與構圖: '測試構圖，主體清楚。',
    運鏡: '固定後慢慢推近。',
    燈光氛圍: '窗光，不另打硬光。',
    節奏剪輯: '硬切，一鏡一件事。',
    情緒: '平靜。',
    何時用: reason,
    提示詞片段: `測試提示詞。收集理由：${reason}`,
    建議口語叫法: asText(title) || '測試口語',
    標籤: ['風格', '燈光氛圍'],
    自由標籤: ['測試'],
  });
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function kindOfFile(file) {
  const type = file?.type || '';
  const name = (file?.name || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (/\.(jpe?g|png|webp|heic|heif|gif)$/.test(name)) return 'image';
  if (/\.(mp4|mov|webm|m4v)$/.test(name)) return 'video';
  return '';
}

export function videoExtension(file) {
  const name = (file?.name || '').toLowerCase();
  const match = name.match(/\.([a-z0-9]+)$/);
  const ext = match ? match[1] : '';
  if (ext === 'mov' || file?.type === 'video/quicktime') return 'mov';
  if (ext === 'webm' || file?.type === 'video/webm') return 'webm';
  if (ext === 'm4v') return 'm4v';
  return 'mp4';
}

export function newId() {
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function commitTitle(title) {
  return String(title || '未命名').replace(/\s+/g, ' ').trim().slice(0, 40);
}
