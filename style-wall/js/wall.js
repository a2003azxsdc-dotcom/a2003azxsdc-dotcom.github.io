import { DEFAULTS, loadConfig, resolveRepo } from './config.js';
import { el, clear, copyText } from './dom.js';
import { attachImage, attachVideo } from './images.js';
import { CATEGORIES, TABS, filterItems, mergeItems, unwrapItems } from './model.js';
import { loadRemoteDocument } from './github.js';
import { getBlob, getSecrets, readOverlay, readTombstones } from './storage.js';

const chips = document.querySelector('#chips');
const search = document.querySelector('#search');
const grid = document.querySelector('#grid');
const note = document.querySelector('#note');
const modal = document.querySelector('#modal');

let cfg = { ...DEFAULTS };
let items = [];
let category = '全部';
let query = '';
let openId = '';
let tab = 'feel';
let lastFocus = null;

function visibleItems() {
  return filterItems(items, { category, query });
}

function playIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', 'M8 5v14l11-7z');
  svg.append(path);
  return svg;
}

function renderChips() {
  clear(chips);
  for (const name of ['全部', ...CATEGORIES]) {
    chips.append(
      el('button', {
        class: 'chip',
        type: 'button',
        'aria-pressed': name === category ? 'true' : 'false',
        onclick: () => {
          category = name;
          renderChips();
          renderGrid();
        },
      }, name),
    );
  }
}

function renderGrid() {
  clear(grid);
  const list = visibleItems();
  if (!list.length) {
    grid.append(el('p', { class: 'empty' }, '沒有符合的參考。'));
    return;
  }
  for (const item of list) {
    const path = item.type === 'video' ? item.poster || item.src : item.src;
    const img = el('img', {
      alt: item.title || '參考圖',
      width: item.width || 1200,
      height: item.height || 800,
      loading: 'lazy',
      decoding: 'async',
    });
    attachImage(img, path, cfg, item.updatedAt);
    const media = el('span', { class: 'card-media' }, [
      img,
      item.type === 'video' ? el('span', { class: 'play', 'aria-hidden': 'true' }, playIcon()) : null,
    ]);
    const card = el('button', {
      class: 'card',
      type: 'button',
      'data-id': item.id,
      onclick: () => openItem(item.id, card),
    }, [media, el('span', { class: 'card-title' }, item.title || item.spokenName || '未命名')]);
    grid.append(card);
  }
}

function fieldBlock(label, value, prompt) {
  if (!value) return null;
  if (prompt) {
    const box = el('pre', { class: 'prompt', id: 'prompt-text' }, value);
    const hint = el('p', { class: 'note', id: 'copy-hint' }, '');
    return el('div', { class: 'block' }, [
      el('span', { class: 'k' }, label),
      el('div', { class: 'copy-row' }, [
        el('button', {
          class: 'btn',
          type: 'button',
          onclick: async () => {
            const ok = await copyText(value);
            hint.textContent = ok ? '已複製。' : '無法自動複製，請直接選取上面的文字。';
            if (!ok) {
              const range = document.createRange();
              range.selectNodeContents(box);
              const selection = getSelection();
              selection.removeAllRanges();
              selection.addRange(range);
            }
          },
        }, '複製提示詞'),
      ]),
      box,
      hint,
    ]);
  }
  return el('div', { class: 'block' }, [el('span', { class: 'k' }, label), el('p', { class: 'v' }, value)]);
}

function renderModal({ focusClose = false } = {}) {
  clear(modal);
  const list = visibleItems();
  const index = list.findIndex((item) => item.id === openId);
  const item = list[index];
  if (!item) {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    return;
  }
  modal.hidden = false;
  document.body.classList.add('modal-open');
  const media = el('div', { class: 'sheet-media' });
  if (item.type === 'video' && item.src) {
    const video = el('video', { controls: 'true', playsinline: 'true', preload: 'metadata' });
    video.playsInline = true;
    if (item.poster) {
      video.poster = item.poster;
      getBlob(item.poster).then((record) => {
        if (record?.blob) video.poster = URL.createObjectURL(record.blob);
      }).catch(() => {});
    }
    attachVideo(video, item.src, cfg, item.updatedAt);
    media.append(video);
  } else {
    const img = el('img', { alt: item.title || '參考圖' });
    attachImage(img, item.src, cfg, item.updatedAt);
    media.append(img);
  }
  const current = TABS.find((entry) => entry.id === tab) || TABS[0];
  const blocks = current.fields
    .map(([key, label]) => fieldBlock(label, item[key], key === 'prompt'))
    .filter(Boolean);
  const panel = blocks.length ? blocks : [el('p', { class: 'note' }, '這則沒有記下這部分。')];
  const sourceBits = [];
  if (item.sourceUrl) {
    sourceBits.push(el('p', {}, [
      '原貼文：',
      el('a', { href: item.sourceUrl, target: '_blank', rel: 'noopener' }, item.sourceUrl),
    ]));
  }
  if (item.sourceDetail) sourceBits.push(el('p', {}, item.sourceDetail));
  const metaLine = [
    item.module ? `模組 ${item.module}` : '',
    item.videoLabel || '',
    item.src ? `檔案 ${item.src}` : '',
  ].filter(Boolean).join(' · ');
  if (metaLine) sourceBits.push(el('p', {}, metaLine));
  const tagLine = [...(item.tags || []), ...(item.freeTags || [])].join('、');
  if (tagLine) sourceBits.push(el('p', {}, `標籤：${tagLine}`));

  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' }, [
    el('button', { class: 'close', type: 'button', onclick: closeModal }, '關閉'),
    media,
    el('div', { class: 'pager' }, [
      el('button', { type: 'button', onclick: () => step(-1) }, '上一則'),
      el('button', { type: 'button', onclick: () => step(1) }, '下一則'),
    ]),
    el('h2', { id: 'sheet-title' }, item.title || item.spokenName || '未命名'),
    el('div', { class: 'reason' }, [
      el('span', { class: 'k' }, '我為什麼收'),
      el('p', { class: 'v' }, item.reason || '（沒有記下收集理由）'),
    ]),
    el('div', { class: 'tabs', role: 'tablist' }, TABS.map((entry) => el('button', {
      class: 'tab',
      type: 'button',
      role: 'tab',
      'aria-selected': entry.id === current.id ? 'true' : 'false',
      onclick: () => {
        tab = entry.id;
        renderModal();
      },
    }, entry.label))),
    el('div', {}, panel),
    el('div', { class: 'meta' }, sourceBits),
  ]);
  modal.append(sheet);
  if (focusClose) sheet.querySelector('.close').focus();
  else sheet.querySelector('.tab[aria-selected="true"]')?.focus();
  const touch = { x: 0 };
  media.addEventListener('touchstart', (event) => {
    touch.x = event.changedTouches[0].clientX;
  }, { passive: true });
  media.addEventListener('touchend', (event) => {
    const dx = event.changedTouches[0].clientX - touch.x;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
  }, { passive: true });
}

function openItem(id, focusNode) {
  openId = id;
  lastFocus = focusNode || document.activeElement;
  const params = new URLSearchParams(location.search);
  params.set('id', id);
  history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
  renderModal({ focusClose: true });
}

function closeModal() {
  openId = '';
  modal.hidden = true;
  clear(modal);
  document.body.classList.remove('modal-open');
  const params = new URLSearchParams(location.search);
  params.delete('id');
  const next = params.toString();
  history.replaceState(null, '', next ? `${location.pathname}?${next}` : location.pathname);
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

function step(delta) {
  const list = visibleItems();
  const index = list.findIndex((item) => item.id === openId);
  if (index < 0 || !list.length) return;
  const next = list[(index + delta + list.length) % list.length];
  openId = next.id;
  renderModal();
}

document.addEventListener('keydown', (event) => {
  if (!openId) return;
  if (event.key === 'Escape') closeModal();
  if (event.key === 'ArrowRight') step(1);
  if (event.key === 'ArrowLeft') step(-1);
});

modal.addEventListener('click', (event) => {
  if (event.target === modal) closeModal();
});

search.addEventListener('input', () => {
  query = search.value;
  renderGrid();
  if (openId && !visibleItems().some((item) => item.id === openId)) closeModal();
});

async function loadItems() {
  const secrets = getSecrets();
  let remote = [];
  let remoteOk = false;
  let missingOnGitHub = false;
  try {
    const { doc } = await loadRemoteDocument({
      token: secrets.token,
      owner: cfg.owner,
      repo: cfg.repo,
      branch: cfg.branch,
    });
    remote = unwrapItems(doc);
    remoteOk = true;
  } catch (error) {
    missingOnGitHub = error?.status === 404;
    try {
      const res = await fetch(`data/items.json?_=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('static');
      remote = unwrapItems(await res.json());
    } catch {
      remote = [];
    }
  }
  items = mergeItems(remote, readOverlay(), readTombstones());
  if (!items.length) {
    note.hidden = false;
    note.textContent = '讀不到參考資料。';
  } else if (!remoteOk && !missingOnGitHub) {
    note.hidden = false;
    note.textContent = '最新目錄暫時讀不到，先顯示網站裡的版本。這台裝置剛存過的仍會出現。';
  } else {
    note.hidden = true;
    note.textContent = '';
  }
  renderGrid();
  const wanted = new URLSearchParams(location.search).get('id');
  if (wanted && items.some((item) => item.id === wanted)) openItem(wanted);
}

async function main() {
  const file = await loadConfig();
  cfg = resolveRepo(file);
  renderChips();
  await loadItems();
}

main();
