import { bytesToBase64 } from './codec.js';
import { LIMITS, mockAnalysis, normalizeAnalysis, parseModelJson } from './model.js';

export const CATEGORY_LIST = ['運鏡', '燈光氛圍', '風格', '節奏剪輯', '情緒'];

export const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    一句感覺: { type: 'string', description: '一句話，繁體中文' },
    風格: { type: 'string' },
    鏡頭與構圖: { type: 'string' },
    運鏡: { type: 'string' },
    燈光氛圍: { type: 'string' },
    節奏剪輯: { type: 'string' },
    情緒: { type: 'string', description: '沒有明確情緒就留空字串' },
    何時用: { type: 'string' },
    提示詞片段: { type: 'string', description: '可直接複製的繁體中文提示詞，包含收集者在意的重點' },
    建議口語叫法: { type: 'string', description: '短標題，大約十個字' },
    標籤: { type: 'array', items: { type: 'string', enum: CATEGORY_LIST } },
    自由標籤: { type: 'array', items: { type: 'string' } },
  },
  required: [
    '一句感覺',
    '風格',
    '鏡頭與構圖',
    '運鏡',
    '燈光氛圍',
    '節奏剪輯',
    '情緒',
    '何時用',
    '提示詞片段',
    '建議口語叫法',
    '標籤',
    '自由標籤',
  ],
};

export function buildPrompt({ description, title }) {
  return [
    '你是影像風格分析助手。請依照畫面，以及收集者自己的描述，產出分類。',
    '收集者的描述權重最高。若畫面與描述有落差，以收集者說的用途與判斷為準；畫面只用來補充他沒寫到、而且看得到的特徵。',
    '不要編造畫面上看不到、描述裡也沒提到的焦段、光圈、器材或劇情。不知道就留空字串。',
    '所有文字使用繁體中文。',
    '只回傳一個 JSON 物件，不要 markdown。',
    '',
    `收集者的描述（權重最高）：\n${description}`,
    '',
    `收集者給的標題（可空）：\n${title || '（無）'}`,
  ].join('\n');
}

export function buildGenerateBody({ model, prompt, media, withSchema = true, withThinking = true }) {
  const parts = [];
  if (media?.fileUri) {
    parts.push({ fileData: { mimeType: media.mimeType, fileUri: media.fileUri } });
  } else if (media?.data) {
    parts.push({ inlineData: { mimeType: media.mimeType, data: media.data } });
  }
  parts.push({ text: prompt });
  const generationConfig = { maxOutputTokens: 4096, responseMimeType: 'application/json' };
  if (withSchema) generationConfig.responseJsonSchema = ANALYSIS_SCHEMA;
  if (withThinking && /^gemini-[34]/.test(model || '')) {
    generationConfig.thinkingConfig = { thinkingLevel: 'LOW' };
  }
  return { contents: [{ role: 'user', parts }], generationConfig };
}

export function extractCandidateText(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  const visible = parts.filter((part) => typeof part.text === 'string' && !part.thought).map((part) => part.text);
  if (visible.join('').trim()) return visible.join('');
  return parts.filter((part) => typeof part.text === 'string').map((part) => part.text).join('');
}

function explainGeminiStatus(status, bodyText) {
  const body = String(bodyText || '');
  if (status === 400 && /API_KEY_INVALID|API key/i.test(body)) return 'Gemini 金鑰無效。請到 AI Studio 重新複製。';
  if (status === 400 && /thinking/i.test(body)) return '這個模型不接受目前的思考設定。';
  if (status === 404) return '找不到這個模型。請把設定裡的模型改成 gemini-4-hydrogen。';
  if (status === 429) return 'Gemini 目前額度用完了。等一下再試，或換一把金鑰。';
  const extra = body.replace(/\s+/g, ' ').trim().slice(0, 180);
  return extra ? `Gemini 回應 ${status}：${extra}` : `Gemini 回應 ${status}。`;
}

async function postGenerate({ apiKey, model, body, fetchImpl }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, text, json };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function uploadVideoToFilesApi({ apiKey, bytes, mimeType, name, fetchImpl = fetch, sleepImpl = sleep }) {
  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify({ file: { display_name: name || 'reference' } })], { type: 'application/json' }),
  );
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mimeType });
  form.append('file', blob, name || 'clip');
  const res = await fetchImpl('https://generativelanguage.googleapis.com/upload/v1beta/files', {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'X-Goog-Upload-Protocol': 'multipart' },
    body: form,
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`${explainGeminiStatus(res.status, raw)} 若影片超過 12MB，可先壓小再分析。`);
  }
  const data = JSON.parse(raw);
  let file = data.file || data;
  const deadline = Date.now() + 180000;
  while (file.state && file.state !== 'ACTIVE') {
    if (file.state === 'FAILED') throw new Error('Gemini 讀不了這支影片。');
    if (Date.now() > deadline) throw new Error('等 Gemini 處理影片逾時。請改用較短的影片。');
    await sleepImpl(2000);
    const statusRes = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, {
      headers: { 'x-goog-api-key': apiKey },
    });
    if (!statusRes.ok) throw new Error('無法確認影片是否處理完成。');
    file = await statusRes.json();
  }
  if (!file.uri) throw new Error('Gemini 沒有回傳影片位址。');
  return file.uri;
}

export async function analyzeMedia({
  apiKey,
  model,
  description,
  title,
  bytes,
  mimeType,
  filename,
  mock = false,
  fetchImpl = fetch,
  sleepImpl = sleep,
}) {
  if (mock) return mockAnalysis({ description, title });
  if (!apiKey) throw new Error('尚未貼上 Gemini 金鑰。');
  const prompt = buildPrompt({ description, title });
  const isVideo = (mimeType || '').startsWith('video/');
  if (isVideo && bytes && bytes.length > LIMITS.maxVideoBytes) {
    throw new Error('影片超過 50MB。請先壓短或降低解析度。');
  }
  let media;
  if (isVideo && bytes && bytes.byteLength > LIMITS.inlineVideoBytes) {
    const fileUri = await uploadVideoToFilesApi({
      apiKey,
      bytes,
      mimeType,
      name: filename,
      fetchImpl,
      sleepImpl,
    });
    media = { fileUri, mimeType };
  } else if (bytes) {
    media = { data: bytesToBase64(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)), mimeType };
  }
  const attempts = [
    { withSchema: true, withThinking: true },
    { withSchema: true, withThinking: false },
    { withSchema: false, withThinking: false },
  ];
  let lastError = null;
  for (const attempt of attempts) {
    const body = buildGenerateBody({ model, prompt, media, ...attempt });
    const result = await postGenerate({ apiKey, model, body, fetchImpl });
    if (!result.ok) {
      lastError = new Error(explainGeminiStatus(result.status, result.text));
      const retryThinking = attempt.withThinking && /thinking/i.test(result.text || '');
      const retrySchema = attempt.withSchema && result.status === 400 && /schema|responseJson|INVALID/i.test(result.text || '');
      if (retryThinking || retrySchema) continue;
      throw lastError;
    }
    const block = result.json?.promptFeedback?.blockReason;
    if (block) throw new Error('這則內容被 Gemini 擋下，沒有分析結果。');
    const text = extractCandidateText(result.json);
    if (!text.trim()) {
      lastError = new Error('Gemini 沒有回傳文字。');
      continue;
    }
    try {
      return normalizeAnalysis(parseModelJson(text));
    } catch (error) {
      lastError = new Error('Gemini 的回覆不是可讀的 JSON。可先手動填下面的欄位再儲存。');
      lastError.raw = text;
    }
  }
  throw lastError || new Error('分析失敗。');
}
