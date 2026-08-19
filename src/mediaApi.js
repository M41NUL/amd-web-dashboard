const API_BASE = 'https://all-media-downloader-api.onrender.com';
const API_KEY = 'm41nul';

export function detectPlatform(url) {
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/facebook\.com|fb\.watch/i.test(url)) return 'facebook';
  return null;
}

export async function fetchMediaInfo(url) {
  const platform = detectPlatform(url);
  const endpoint = platform ? `/api/${platform}` : '/api/download';
  const res = await fetch(`${API_BASE}${endpoint}?url=${encodeURIComponent(url)}`, {
    headers: { 'x-api-key': API_KEY },
  });
  if (!res.ok) throw new Error(`API status ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'API request failed');
  return data;
}

export async function fetchProxyVideo(proxyToken) {
  const res = await fetch(`${API_BASE}/api/proxy-video?proxy_token=${proxyToken}`, {
    headers: { 'x-api-key': API_KEY },
  });
  if (!res.ok) throw new Error(`Proxy video fetch status ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function fetchDirectVideo(videoUrl) {
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`Direct video fetch status ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
