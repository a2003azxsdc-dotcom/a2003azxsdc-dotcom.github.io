import { readRepoOverride, getSecrets } from './storage.js';

export const DEFAULTS = {
  owner: 'a2003azxsdc-dotcom',
  repo: 'a2003azxsdc-dotcom.github.io',
  branch: 'main',
  model: 'gemini-4-hydrogen',
};

export function contentPath(path) {
  const clean = String(path || '').replace(/^\/+/, '');
  if (clean === 'style-wall' || clean.startsWith('style-wall/')) return clean;
  return `style-wall/${clean}`;
}

export async function loadConfig() {
  try {
    const res = await fetch(`data/config.json?_=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(await res.json()) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function resolveRepo(fileConfig) {
  const saved = readRepoOverride() || {};
  return {
    owner: saved.owner || fileConfig.owner || DEFAULTS.owner,
    repo: saved.repo || fileConfig.repo || DEFAULTS.repo,
    branch: saved.branch || fileConfig.branch || DEFAULTS.branch,
    model: getSecrets().model || fileConfig.model || DEFAULTS.model,
  };
}
