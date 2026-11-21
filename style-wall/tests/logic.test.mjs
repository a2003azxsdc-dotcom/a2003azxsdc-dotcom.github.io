import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import { decodeBase64Utf8, encodeUtf8Base64 } from '../js/codec.js';
import { DEFAULTS, contentPath } from '../js/config.js';
import {
  buildGenerateBody,
  buildPrompt,
  extractCandidateText,
} from '../js/gemini.js';
import { rawUrl } from '../js/images.js';
import {
  buildPutRequest,
  explainGitHubStatus,
  putFile,
  toBase64Payload,
} from '../js/github.js';
import {
  CATEGORIES,
  filterItems,
  mergeItems,
  mockAnalysis,
  normalizeAnalysis,
  parseModelJson,
  unwrapItems,
} from '../js/model.js';

const doc = JSON.parse(readFileSync(new URL('../data/items.json', import.meta.url), 'utf8'));
const items = unwrapItems(doc);

describe('種子資料', () => {
  it('有 13 張圖，而且檔案都在', () => {
    assert.equal(items.length, 13);
    const files = new Set(readdirSync(new URL('../media/', import.meta.url)));
    for (const item of items) {
      assert.equal(item.type, 'image');
      assert.equal(item.reason, '（舊資料，未記錄收集理由）');
      assert.ok(files.has(item.src.split('/')[1]));
      for (const tag of item.tags) assert.ok(CATEGORIES.includes(tag));
      assert.ok(item.feeling && item.style && item.camera && item.movement && item.lighting && item.rhythm && item.when);
    }
  });

  it('Simon 直接上傳的沒有貼文連結，其餘用模組裡的 X 連結', () => {
    const uploaded = new Set(['01-video1', '02-video2', '03-video5', '04-video6', '05-video8', '10-video7']);
    for (const item of items) {
      if (uploaded.has(item.id)) {
        assert.equal(item.sourceUrl, '');
        assert.match(item.sourceDetail, /原貼文連結：未記錄/);
      } else {
        assert.match(item.sourceUrl, /^https:\/\/x\.com\//);
      }
    }
  });
});

describe('分類與合併', () => {
  it('情緒篩選只留下有這個標籤的', () => {
    const found = filterItems(items, { category: '情緒', query: '' });
    assert.ok(found.length >= 1);
    assert.ok(found.every((item) => item.tags.includes('情緒')));
  });

  it('搜尋找得到收集理由與標題', () => {
    const found = filterItems(items, { category: '全部', query: '火車' });
    assert.ok(found.some((item) => item.id === '06-video12'));
  });

  it('本機較新的項目蓋過遠端，刪除標記會藏起舊資料', () => {
    const remote = [{ id: 'a', title: '舊', updatedAt: '2020-01-01T00:00:00.000Z' }];
    const overlay = [{ id: 'a', title: '新', updatedAt: '2026-01-01T00:00:00.000Z' }, { id: 'b', title: '只在本機', updatedAt: '2026-02-01T00:00:00.000Z' }];
    const merged = mergeItems(remote, overlay, {});
    assert.equal(merged.find((item) => item.id === 'a').title, '新');
    assert.ok(merged.some((item) => item.id === 'b'));
    const hidden = mergeItems(remote, [], { a: '2026-03-01T00:00:00.000Z' });
    assert.equal(hidden.length, 0);
  });
});

describe('Gemini 組裝', () => {
  it('描述會進提示，而且要求繁體 JSON', () => {
    const prompt = buildPrompt({ description: '我想學這個窗光', title: '窗邊' });
    assert.match(prompt, /我想學這個窗光/);
    assert.match(prompt, /權重最高/);
    assert.match(prompt, /繁體中文/);
  });

  it('圖片走 inline，新模型帶思考等級，舊模型不帶', () => {
    const modern = buildGenerateBody({
      model: 'gemini-4-hydrogen',
      prompt: 'hi',
      media: { data: 'YQ==', mimeType: 'image/jpeg' },
    });
    assert.equal(modern.contents[0].parts[0].inlineData.mimeType, 'image/jpeg');
    assert.equal(modern.generationConfig.thinkingConfig.thinkingLevel, 'LOW');
    assert.equal(modern.generationConfig.responseMimeType, 'application/json');
    const legacy = buildGenerateBody({
      model: 'gemini-2.5-flash',
      prompt: 'hi',
      media: { fileUri: 'https://example.test/file', mimeType: 'video/mp4' },
    });
    assert.equal(legacy.generationConfig.thinkingConfig, undefined);
    assert.equal(legacy.contents[0].parts[0].fileData.fileUri, 'https://example.test/file');
  });

  it('可以解析包在 markdown 裡的 JSON，並把不該出現的標籤撥到自由標籤', () => {
    const parsed = parseModelJson('```json\n{"一句感覺":"安靜","標籤":["風格","不存在"],"自由標籤":["窗"]}\n```');
    const norm = normalizeAnalysis(parsed);
    assert.equal(norm.feeling, '安靜');
    assert.deepEqual(norm.tags, ['風格']);
    assert.deepEqual(norm.freeTags, ['窗', '不存在']);
  });

  it('模擬分析會帶入收集者的描述', () => {
    const result = mockAnalysis({ description: '因為這個回頭', title: '' });
    assert.match(result.when, /因為這個回頭/);
    assert.match(result.prompt, /因為這個回頭/);
  });

  it('略過思考段落，只取正式回答', () => {
    const text = extractCandidateText({
      candidates: [{ content: { parts: [{ thought: true, text: '思考' }, { text: '{"一句感覺":"好"}' }] } }],
    });
    assert.match(text, /一句感覺/);
    assert.doesNotMatch(text, /思考/);
  });
});

describe('GitHub 寫入', () => {
  it('中文 JSON 可以來回編碼', () => {
    const text = JSON.stringify({ title: '室內日常' });
    assert.equal(decodeBase64Utf8(encodeUtf8Base64(text)), text);
    assert.equal(decodeBase64Utf8(toBase64Payload({ text })), text);
  });

  it('新建檔不帶 sha，衝突時會用新的 sha 再寫一次', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
      if (init.method === 'PUT' && calls.filter((call) => call.init.method === 'PUT').length === 1) {
        return { ok: false, status: 422, text: async () => 'mismatch', json: async () => ({}) };
      }
      if (init.method === 'PUT') {
        return { ok: true, status: 200, json: async () => ({ content: { path: 'media/a.jpg' } }), text: async () => '' };
      }
      const gets = calls.filter((call) => !call.init.method || call.init.method === 'GET').length;
      if (gets === 1) return { ok: false, status: 404, text: async () => 'missing', json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ sha: 'def', content: '' }), text: async () => '' };
    };
    await putFile({
      token: 'test-token',
      owner: 'simon',
      repo: 'style-wall',
      branch: 'main',
      path: 'media/a.jpg',
      bytes: new Uint8Array([1, 2, 3]),
      message: '新增參考：測試',
      fetchImpl,
    });
    const puts = calls.filter((call) => call.init.method === 'PUT');
    assert.equal(puts.length, 2);
    assert.equal(puts[0].body.sha, undefined);
    assert.equal(puts[1].body.sha, 'def');
    assert.equal(puts[0].init.headers.Authorization, 'Bearer test-token');
    assert.match(puts[0].url, /\/contents\/media\/a\.jpg$/);
    const request = buildPutRequest({
      token: 't',
      owner: 'simon',
      repo: 'style-wall',
      branch: 'main',
      path: 'data/items.json',
      base64: 'YQ==',
      message: '更新目錄',
    });
    assert.match(request.url, /contents\/data\/items\.json$/);
  });

  it('遠端讀寫指向主網站倉庫的 style-wall 路徑', () => {
    assert.equal(DEFAULTS.repo, 'a2003azxsdc-dotcom.github.io');
    assert.equal(DEFAULTS.branch, 'main');
    assert.equal(contentPath('data/items.json'), 'style-wall/data/items.json');
    assert.equal(contentPath('media/a.jpg'), 'style-wall/media/a.jpg');
    assert.equal(contentPath('style-wall/media/a.jpg'), 'style-wall/media/a.jpg');
    assert.equal(
      rawUrl(DEFAULTS, 'media/a.jpg', '1'),
      'https://raw.githubusercontent.com/a2003azxsdc-dotcom/a2003azxsdc-dotcom.github.io/main/style-wall/media/a.jpg?t=1',
    );
  });

  it('權限錯誤有中文說明', () => {
    assert.match(explainGitHubStatus(401, ''), /token/);
    assert.match(explainGitHubStatus(403, ''), /Contents/);
  });
});

describe('介面文字', () => {
  it('頁面與程式沒有常見簡體字', () => {
    const forbidden = ['这', '个', '们', '国', '时', '过', '还', '东', '样', '门', '开', '关', '长', '后', '为', '说', '来', '册', '体', '发', '会', '对', '经'];
    const files = [
      'index.html', 'admin.html', 'README.md', 'css/app.css', 'data/items.json',
      ...readdirSync(new URL('../js/', import.meta.url)).map((name) => `js/${name}`),
    ];
    for (const file of files) {
      let text = '';
      try {
        text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      } catch {
        continue;
      }
      for (const word of forbidden) {
        assert.equal(text.includes(word), false, `${file} 含有「${word}」`);
      }
    }
  });
});
