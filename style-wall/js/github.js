import { bytesToBase64, decodeBase64Utf8, encodeUtf8Base64 } from './codec.js';
import { contentPath } from './config.js';

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

export function githubHeaders(token, write = false) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (write) {
    headers['Content-Type'] = 'application/json';
    headers['X-GitHub-Api-Version'] = '2022-11-28';
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function contentsPath(owner, repo, path) {
  const encoded = String(path)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encoded}`;
}

export function explainGitHubStatus(status, bodyText) {
  if (status === 401) return 'GitHub token 無效或已過期。請重新產生細粒度 token，再貼一次。';
  if (status === 403) {
    return 'GitHub 拒絕寫入。請確認 token 只勾這個倉庫，而且 Contents 是讀與寫。若剛剛傳了很多次，等一分鐘再試。';
  }
  if (status === 404) return '找不到倉庫、分支或檔案。請核對擁有者、倉庫名稱，分支是不是 main。';
  if (status === 409 || status === 422) return '檔案剛被改過。請再按一次儲存。';
  const extra = String(bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  return extra ? `GitHub 回應 ${status}：${extra}` : `GitHub 回應 ${status}。`;
}

async function readError(res) {
  let text = '';
  try {
    text = await res.text();
  } catch {
    text = '';
  }
  return new GitHubError(explainGitHubStatus(res.status, text), res.status);
}

export async function fetchFileMeta({ token, owner, repo, branch, path, fetchImpl = fetch }) {
  const url = new URL(contentsPath(owner, repo, path));
  if (branch) url.searchParams.set('ref', branch);
  const res = await fetchImpl(url.toString(), {
    headers: githubHeaders(token, false),
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function loadRemoteDocument({ token, owner, repo, branch, path = contentPath('data/items.json'), fetchImpl = fetch }) {
  const meta = await fetchFileMeta({ token, owner, repo, branch, path, fetchImpl });
  if (!meta || Array.isArray(meta)) {
    throw new GitHubError('找不到 style-wall/data/items.json。', 404);
  }
  if (meta.content) {
    return { doc: JSON.parse(decodeBase64Utf8(meta.content)), sha: meta.sha };
  }
  if (meta.download_url) {
    const res = await fetchImpl(meta.download_url, { cache: 'no-store' });
    if (!res.ok) throw await readError(res);
    return { doc: await res.json(), sha: meta.sha };
  }
  throw new GitHubError('讀得到檔案資訊，但沒有內容。', 500);
}

export function toBase64Payload({ bytes, text }) {
  if (text !== undefined) return encodeUtf8Base64(text);
  return bytesToBase64(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

export function buildPutRequest({ token, owner, repo, branch, path, base64, message, sha }) {
  const body = { message, content: base64, branch };
  if (sha) body.sha = sha;
  return {
    url: contentsPath(owner, repo, path),
    init: {
      method: 'PUT',
      headers: githubHeaders(token, true),
      body: JSON.stringify(body),
    },
  };
}

async function sendPut(opts, sha, fetchImpl) {
  const req = buildPutRequest({ ...opts, sha });
  return fetchImpl(req.url, req.init);
}

export async function putFile({
  token,
  owner,
  repo,
  branch,
  path,
  bytes,
  text,
  message,
  fetchImpl = fetch,
}) {
  const base64 = toBase64Payload({ bytes, text });
  const opts = { token, owner, repo, branch, path, base64, message };
  let meta = await fetchFileMeta({ token, owner, repo, branch, path, fetchImpl });
  let res = await sendPut(opts, meta?.sha, fetchImpl);
  if (res.status === 409 || res.status === 422) {
    meta = await fetchFileMeta({ token, owner, repo, branch, path, fetchImpl });
    res = await sendPut(opts, meta?.sha, fetchImpl);
  }
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function deleteFile({ token, owner, repo, branch, path, message, fetchImpl = fetch }) {
  const meta = await fetchFileMeta({ token, owner, repo, branch, path, fetchImpl });
  if (!meta?.sha) return { missing: true };
  const res = await fetchImpl(contentsPath(owner, repo, path), {
    method: 'DELETE',
    headers: githubHeaders(token, true),
    body: JSON.stringify({ message, sha: meta.sha, branch }),
  });
  if (res.status === 404) return { missing: true };
  if (!res.ok) throw await readError(res);
  return res.json();
}
