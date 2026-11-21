import { contentPath, loadConfig, resolveRepo } from './config.js';
import { el, clear } from './dom.js';
import { analyzeMedia } from './gemini.js';
import { deleteFile, loadRemoteDocument, putFile } from './github.js';
import { attachImage } from './images.js';
import { blobToBytes, compressImageFile, extractPoster } from './media.js';
import {
  CATEGORIES,
  LIMITS,
  commitTitle,
  formatBytes,
  kindOfFile,
  mergeItems,
  newId,
  sortItems,
  unwrapItems,
  videoExtension,
} from './model.js';
import {
  clearSecrets,
  deleteBlob,
  getSecrets,
  putBlob,
  readOverlay,
  readTombstones,
  rememberItems,
  rememberTombstone,
  saveSecrets,
} from './storage.js';

const params = new URLSearchParams(location.search);
const MOCK = params.has('mock');
const DRY = params.has('dry');

const banner = document.querySelector('#banner');
const tokenInput = document.querySelector('#token');
const geminiInput = document.querySelector('#gemini');
const modelInput = document.querySelector('#model');
const ownerInput = document.querySelector('#owner');
const repoInput = document.querySelector('#repo');
const branchInput = document.querySelector('#branch');
const settingsStatus = document.querySelector('#settings-status');
const fileInput = document.querySelector('#file');
const titleInput = document.querySelector('#title');
const reasonInput = document.querySelector('#reason');
const fileNote = document.querySelector('#file-note');
const analyzeBtn = document.querySelector('#analyze');
const cancelEdit = document.querySelector('#cancel-edit');
const formTitle = document.querySelector('#form-title');
const workStatus = document.querySelector('#work-status');
const preview = document.querySelector('#preview');
const previewFields = document.querySelector('#preview-fields');
const saveStatus = document.querySelector('#save-status');
const library = document.querySelector('#library');
const confirmBox = document.querySelector('#confirm');
const confirmText = document.querySelector('#confirm-text');

let cfg = resolveRepo({});
let items = [];
let editing = null;
let analysis = null;
let prepared = null;

const TEXT_FIELDS = [
  ['spokenName', '建議口語叫法', 'input'],
  ['feeling', '一句感覺', 'textarea'],
  ['style', '風格', 'textarea'],
  ['camera', '鏡頭與構圖', 'textarea'],
  ['movement', '運鏡', 'textarea'],
  ['lighting', '燈光氛圍', 'textarea'],
  ['rhythm', '節奏剪輯', 'textarea'],
  ['mood', '情緒', 'textarea'],
  ['when', '何時用', 'textarea'],
  ['prompt', '提示詞片段', 'textarea'],
];

function setStatus(node, text, bad) {
  node.textContent = text || '';
  node.classList.toggle('bad', Boolean(bad));
}

function currentRepo() {
  return {
    owner: ownerInput.value.trim() || cfg.owner,
    repo: repoInput.value.trim() || cfg.repo,
    branch: branchInput.value.trim() || cfg.branch,
    model: modelInput.value.trim() || cfg.model,
  };
}

function showBanner() {
  const bits = [];
  if (MOCK) bits.push('測試模式：分析用內建範例，不會呼叫 Gemini。');
  if (DRY) bits.push('測試模式：儲存只寫進這台瀏覽器，不會推上 GitHub。');
  banner.hidden = bits.length === 0;
  banner.textContent = bits.join('');
}

function fillSettings() {
  const secrets = getSecrets();
  modelInput.value = secrets.model || cfg.model;
  ownerInput.value = cfg.owner;
  repoInput.value = cfg.repo;
  branchInput.value = cfg.branch;
  const saved = [];
  if (secrets.token) saved.push('GitHub token 已存在這台瀏覽器');
  if (secrets.gemini) saved.push('Gemini 金鑰已存在這台瀏覽器');
  setStatus(settingsStatus, saved.join('。') + (saved.length ? '。' : '尚未儲存金鑰。'), false);
}

async function refreshLibrary() {
  const secrets = getSecrets();
  const repo = currentRepo();
  let remote = [];
  try {
    const { doc } = await loadRemoteDocument({
      token: secrets.token,
      owner: repo.owner,
      repo: repo.repo,
      branch: repo.branch,
      path: contentPath('data/items.json'),
    });
    remote = unwrapItems(doc);
  } catch {
    try {
      const res = await fetch(`data/items.json?_=${Date.now()}`, { cache: 'no-store' });
      remote = unwrapItems(await res.json());
    } catch {
      remote = [];
    }
  }
  items = mergeItems(remote, readOverlay(), readTombstones());
  renderLibrary();
}

function renderLibrary() {
  clear(library);
  if (!items.length) {
    library.append(el('p', { class: 'note' }, '還沒有參考。'));
    return;
  }
  for (const item of items) {
    const img = el('img', { alt: '', width: '84', height: '64' });
    attachImage(img, item.type === 'video' ? item.poster || item.src : item.src, currentRepo(), item.updatedAt);
    library.append(el('article', { class: 'item-row' }, [
      img,
      el('div', {}, [
        el('h3', {}, item.title || '未命名'),
        el('p', { class: 'note' }, item.reason || ''),
        el('div', { class: 'row-actions' }, [
          el('button', { class: 'btn-ghost', type: 'button', onclick: () => startEdit(item) }, '編輯'),
          el('button', { class: 'btn-danger', type: 'button', onclick: () => askDelete(item) }, '刪除'),
        ]),
      ]),
    ]));
  }
}

function startEdit(item) {
  editing = item;
  analysis = {
    feeling: item.feeling || '',
    style: item.style || '',
    camera: item.camera || '',
    movement: item.movement || '',
    lighting: item.lighting || '',
    rhythm: item.rhythm || '',
    mood: item.mood || '',
    when: item.when || '',
    prompt: item.prompt || '',
    spokenName: item.spokenName || '',
    tags: [...(item.tags || [])],
    freeTags: [...(item.freeTags || [])],
  };
  titleInput.value = item.title || '';
  reasonInput.value = item.reason || '';
  fileInput.value = '';
  formTitle.textContent = `編輯：${item.title || '未命名'}`;
  cancelEdit.hidden = false;
  analyzeBtn.textContent = '用 Gemini 重分析';
  prepared = null;
  renderPreview(analysis);
  preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetForm() {
  editing = null;
  analysis = null;
  prepared = null;
  titleInput.value = '';
  reasonInput.value = '';
  fileInput.value = '';
  formTitle.textContent = '新增一則';
  cancelEdit.hidden = true;
  analyzeBtn.textContent = '交給 Gemini 分析';
  preview.hidden = true;
  clear(previewFields);
  setStatus(workStatus, '');
  setStatus(saveStatus, '');
  fileNote.textContent = '手機相簿可以直接選。圖片會縮到長邊約 1600 像素。影片上限 50MB，超過 20MB 時 GitHub 有時會拒絕；超過約 12MB 會改走 Gemini 的檔案上傳。';
}

function renderPreview(data) {
  analysis = data;
  preview.hidden = false;
  clear(previewFields);
  for (const [key, label, kind] of TEXT_FIELDS) {
    const control = el(kind === 'input' ? 'input' : 'textarea', { id: `f-${key}` });
    if (kind === 'input') control.type = 'text';
    control.value = data[key] || '';
    previewFields.append(el('label', { class: 'field' }, [el('span', { class: 'k' }, label), control]));
  }
  const checks = el('div', { class: 'checks' });
  for (const name of CATEGORIES) {
    const box = el('input', { type: 'checkbox', value: name });
    box.checked = (data.tags || []).includes(name);
    checks.append(el('label', {}, [box, name]));
  }
  const free = el('input', { id: 'f-free', type: 'text', value: (data.freeTags || []).join('、') });
  previewFields.append(
    el('div', { class: 'field' }, [el('span', { class: 'k' }, '分類標籤'), checks]),
    el('label', { class: 'field' }, [el('span', { class: 'k' }, '自由標籤（用頓號或逗號分開）'), free]),
  );
}

function readPreview() {
  const data = {};
  for (const [key] of TEXT_FIELDS) {
    data[key] = document.querySelector(`#f-${key}`).value.trim();
  }
  data.tags = [...previewFields.querySelectorAll('input[type="checkbox"]:checked')].map((node) => node.value);
  data.freeTags = document.querySelector('#f-free').value.split(/[、,，]/).map((part) => part.trim()).filter(Boolean).slice(0, 8);
  return data;
}

function requireReason() {
  const reason = reasonInput.value.trim();
  if (!reason) {
    setStatus(workStatus, '請寫下你為什麼收這則。', true);
    reasonInput.focus();
    return '';
  }
  return reason;
}

async function prepareFile(file) {
  const kind = kindOfFile(file);
  if (!kind) throw new Error('請選圖片或影片。');
  if (kind === 'video' && file.size > LIMITS.maxVideoBytes) {
    throw new Error('影片超過 50MB。請先壓短或降低解析度。');
  }
  if (kind === 'image') {
    const compressed = await compressImageFile(file);
    const bytes = await blobToBytes(compressed.blob);
    return {
      kind,
      bytes,
      mimeType: 'image/jpeg',
      width: compressed.width,
      height: compressed.height,
      posterBytes: null,
    };
  }
  const poster = await extractPoster(file);
  return {
    kind,
    bytes: new Uint8Array(await file.arrayBuffer()),
    mimeType: file.type || 'video/mp4',
    ext: videoExtension(file),
    width: poster.width,
    height: poster.height,
    posterBytes: await blobToBytes(poster.blob),
    warn: file.size > LIMITS.warnVideoBytes,
  };
}

document.querySelector('#pick').addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  prepared = null;
  const file = fileInput.files?.[0];
  const name = document.querySelector('#file-name');
  if (!file) {
    name.textContent = '尚未選擇';
    return;
  }
  name.textContent = `已選 ${file.name}（${formatBytes(file.size)}）`;
  const kind = kindOfFile(file);
  const size = formatBytes(file.size);
  if (kind === 'video' && file.size > LIMITS.maxVideoBytes) {
    setStatus(workStatus, `已選 ${file.name}（${size}）。超過 50MB，無法分析或上傳。`, true);
    return;
  }
  if (kind === 'video' && file.size > LIMITS.warnVideoBytes) {
    setStatus(workStatus, `已選 ${file.name}（${size}）。超過 20MB，GitHub 有時會拒絕，仍可嘗試。`, true);
    return;
  }
  setStatus(workStatus, file ? `已選 ${file.name}（${size}）。` : '');
});

analyzeBtn.addEventListener('click', async () => {
  const reason = requireReason();
  if (!reason) return;
  const file = fileInput.files?.[0];
  if (!editing && !file) {
    setStatus(workStatus, '請選擇圖片或影片。', true);
    return;
  }
  const secrets = getSecrets();
  if (!MOCK && !secrets.gemini) {
    setStatus(workStatus, '請先在上面貼上 Gemini 金鑰並儲存設定。', true);
    document.querySelector('#settings').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  analyzeBtn.disabled = true;
  setStatus(workStatus, '正在處理檔案…');
  try {
    let bytes;
    let mimeType;
    let filename = file?.name || '';
    if (file) {
      const ready = await prepareFile(file);
      prepared = ready;
      bytes = ready.bytes;
      mimeType = ready.mimeType;
      if (ready.warn) setStatus(workStatus, '影片偏大，正在請 Gemini 分析。請停留在此頁。');
    } else if (editing?.type === 'video') {
      throw new Error('重分析影片時，請再選一次影片。只改文字的話，直接按儲存即可。');
    } else if (editing?.src) {
      setStatus(workStatus, '正在讀取原本的圖片…');
      const res = await fetch(editing.src, { cache: 'no-store' });
      if (!res.ok) throw new Error('讀不到原本的圖片。請重新選檔再分析。');
      bytes = new Uint8Array(await res.arrayBuffer());
      mimeType = res.headers.get('content-type') || 'image/jpeg';
      filename = editing.src;
    }
    setStatus(workStatus, '正在請 Gemini 分析。請停留在此頁。');
    const result = await analyzeMedia({
      apiKey: secrets.gemini,
      model: currentRepo().model,
      description: reason,
      title: titleInput.value.trim(),
      bytes,
      mimeType,
      filename,
      mock: MOCK,
    });
    renderPreview(result);
    setStatus(workStatus, '分析完成。可以改字，再按儲存。');
    preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    setStatus(workStatus, error.message || '分析失敗。', true);
    if (error.raw) renderPreview(analysis || {
      feeling: '', style: '', camera: '', movement: '', lighting: '', rhythm: '', mood: '', when: '', prompt: '', spokenName: titleInput.value.trim(), tags: [], freeTags: [],
    });
  } finally {
    analyzeBtn.disabled = false;
  }
});

document.querySelector('#save-item').addEventListener('click', async () => {
  const reason = reasonInput.value.trim();
  if (!reason) {
    setStatus(saveStatus, '請寫下你為什麼收這則。', true);
    return;
  }
  if (!analysis && !editing) {
    setStatus(saveStatus, '請先按「交給 Gemini 分析」。', true);
    return;
  }
  const secrets = getSecrets();
  const repo = currentRepo();
  if (!DRY && !secrets.token) {
    setStatus(saveStatus, '請先貼上 GitHub token 並儲存設定。', true);
    return;
  }
  const data = readPreview();
  const now = new Date().toISOString();
  const id = editing?.id || newId();
  let src = editing?.src || '';
  let poster = editing?.poster || '';
  let type = editing?.type || 'image';
  let width = editing?.width || 0;
  let height = editing?.height || 0;
  const uploads = [];
  if (prepared) {
    type = prepared.kind;
    width = prepared.width;
    height = prepared.height;
    if (prepared.kind === 'image') {
      src = `media/${id}.jpg`;
      poster = '';
      uploads.push({ path: contentPath(src), bytes: prepared.bytes });
    } else {
      src = `media/${id}.${prepared.ext || 'mp4'}`;
      poster = `media/${id}-poster.jpg`;
      uploads.push({ path: contentPath(src), bytes: prepared.bytes });
      uploads.push({ path: contentPath(poster), bytes: prepared.posterBytes });
    }
  }
  if (!src) {
    setStatus(saveStatus, '沒有檔案可儲存。', true);
    return;
  }
  const item = {
    id,
    order: editing?.order ?? 0,
    title: titleInput.value.trim() || data.spokenName || '未命名',
    spokenName: data.spokenName,
    type,
    src,
    poster,
    width,
    height,
    reason,
    ...data,
    sourceUrl: editing?.sourceUrl || '',
    sourceDetail: editing?.sourceDetail || '由管理頁上傳。',
    module: editing?.module || '',
    videoLabel: editing?.videoLabel || '',
    createdAt: editing?.createdAt || now,
    updatedAt: now,
  };
  const button = document.querySelector('#save-item');
  button.disabled = true;
  try {
    setStatus(saveStatus, '正在把檔案留在這台瀏覽器，讓參考牆立刻看得到…');
    if (prepared?.kind === 'image') await putBlob(src, new Blob([prepared.bytes], { type: 'image/jpeg' }), now);
    if (prepared?.kind === 'video') {
      await putBlob(src, new Blob([prepared.bytes], { type: prepared.mimeType }), now);
      await putBlob(poster, new Blob([prepared.posterBytes], { type: 'image/jpeg' }), now);
    }
    if (!DRY) {
      for (const file of uploads) {
        setStatus(saveStatus, `正在上傳 ${file.path} …`);
        await putFile({
          token: secrets.token,
          owner: repo.owner,
          repo: repo.repo,
          branch: repo.branch,
          path: file.path,
          bytes: file.bytes,
          message: `${editing ? '更新' : '新增'}參考：${commitTitle(item.title)}`,
        });
      }
      setStatus(saveStatus, '正在更新目錄…');
      const remote = await loadRemoteDocument({
        token: secrets.token,
        owner: repo.owner,
        repo: repo.repo,
        branch: repo.branch,
        path: contentPath('data/items.json'),
      });
      const nextItems = unwrapItems(remote.doc).filter((entry) => entry.id !== id);
      nextItems.push(item);
      const doc = { version: 1, items: sortItems(nextItems) };
      await putFile({
        token: secrets.token,
        owner: repo.owner,
        repo: repo.repo,
        branch: repo.branch,
        path: contentPath('data/items.json'),
        text: JSON.stringify(doc, null, 2),
        message: `${editing ? '更新' : '新增'}參考：${commitTitle(item.title)}`,
      });
      if (editing && prepared && editing.src && editing.src !== src) {
        await deleteFile({
          token: secrets.token,
          owner: repo.owner,
          repo: repo.repo,
          branch: repo.branch,
          path: contentPath(editing.src),
          message: `移除舊檔：${commitTitle(item.title)}`,
        }).catch(() => {});
        if (editing.poster && editing.poster !== poster) {
          await deleteFile({
            token: secrets.token,
            owner: repo.owner,
            repo: repo.repo,
            branch: repo.branch,
            path: contentPath(editing.poster),
            message: `移除舊縮圖：${commitTitle(item.title)}`,
          }).catch(() => {});
        }
      }
    }
    rememberItems([item]);
    setStatus(saveStatus, '已儲存。打開參考牆就會看到這則，不用等網站重新部署。');
    previewFields.append(el('p', {}, el('a', { href: `index.html?id=${encodeURIComponent(id)}` }, '到參考牆看這則')));
    await refreshLibrary();
    if (!editing) {
      fileInput.value = '';
      prepared = null;
    }
  } catch (error) {
    setStatus(saveStatus, error.message || '儲存失敗。', true);
  } finally {
    button.disabled = false;
  }
});

function askDelete(item) {
  confirmText.textContent = `確定刪除「${item.title || '未命名'}」？會從倉庫移除這筆資料與檔案。`;
  confirmBox.hidden = false;
  confirmBox.dataset.id = item.id;
}

document.querySelector('#confirm-no').addEventListener('click', () => {
  confirmBox.hidden = true;
});

document.querySelector('#confirm-yes').addEventListener('click', async () => {
  const item = items.find((entry) => entry.id === confirmBox.dataset.id);
  confirmBox.hidden = true;
  if (!item) return;
  const secrets = getSecrets();
  const repo = currentRepo();
  if (!DRY && !secrets.token) {
    setStatus(workStatus, '刪除需要 GitHub token。', true);
    return;
  }
  try {
    const now = new Date().toISOString();
    if (!DRY) {
      const remote = await loadRemoteDocument({
        token: secrets.token,
        owner: repo.owner,
        repo: repo.repo,
        branch: repo.branch,
        path: contentPath('data/items.json'),
      });
      const nextItems = unwrapItems(remote.doc).filter((entry) => entry.id !== item.id);
      await putFile({
        token: secrets.token,
        owner: repo.owner,
        repo: repo.repo,
        branch: repo.branch,
        path: contentPath('data/items.json'),
        text: JSON.stringify({ version: 1, items: sortItems(nextItems) }, null, 2),
        message: `刪除參考：${commitTitle(item.title)}`,
      });
      if (item.src) {
        await deleteFile({
          token: secrets.token,
          owner: repo.owner,
          repo: repo.repo,
          branch: repo.branch,
          path: contentPath(item.src),
          message: `刪除檔案：${commitTitle(item.title)}`,
        }).catch(() => {});
      }
      if (item.poster) {
        await deleteFile({
          token: secrets.token,
          owner: repo.owner,
          repo: repo.repo,
          branch: repo.branch,
          path: contentPath(item.poster),
          message: `刪除縮圖：${commitTitle(item.title)}`,
        }).catch(() => {});
      }
    }
    rememberTombstone(item.id, now);
    if (item.src) await deleteBlob(item.src).catch(() => {});
    if (item.poster) await deleteBlob(item.poster).catch(() => {});
    if (editing?.id === item.id) resetForm();
    await refreshLibrary();
    setStatus(workStatus, '已刪除。');
  } catch (error) {
    setStatus(workStatus, error.message || '刪除失敗。', true);
  }
});

document.querySelector('#save-settings').addEventListener('click', () => {
  const repo = {
    owner: ownerInput.value.trim(),
    repo: repoInput.value.trim(),
    branch: branchInput.value.trim() || 'main',
  };
  saveSecrets({
    token: tokenInput.value.trim(),
    gemini: geminiInput.value.trim(),
    model: modelInput.value.trim() || cfg.model,
    repo,
  });
  tokenInput.value = '';
  geminiInput.value = '';
  cfg = { ...cfg, ...repo, model: modelInput.value.trim() || cfg.model };
  fillSettings();
  refreshLibrary();
});

document.querySelector('#clear-settings').addEventListener('click', () => {
  clearSecrets();
  tokenInput.value = '';
  geminiInput.value = '';
  fillSettings();
  setStatus(settingsStatus, '已清除這台裝置上的金鑰。', false);
});

cancelEdit.addEventListener('click', resetForm);

async function main() {
  showBanner();
  const file = await loadConfig();
  cfg = resolveRepo(file);
  fillSettings();
    await refreshLibrary();
}

main();
