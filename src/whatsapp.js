import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { addLog } from './logger.js';
import { updateUserState } from './userStore.js';

const API_BASE = 'https://all-media-downloader-api.onrender.com';
const API_KEY = 'm41nul';

const SESSIONS_ROOT = path.join(process.cwd(), 'sessions');
if (!fs.existsSync(SESSIONS_ROOT)) {
  fs.mkdirSync(SESSIONS_ROOT, { recursive: true });
}

const sessions = new Map();

function sessionDir(userId) {
  const dir = path.join(SESSIONS_ROOT, userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getOrCreateSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      sock: null,
      latestQr: null,
      connected: false,
      connecting: false,
      downloadCount: 0,
      seenUsers: new Set(),
    });
  }
  return sessions.get(userId);
}

function detectPlatform(url) {
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/facebook\.com|fb\.watch/i.test(url)) return 'facebook';
  return null;
}

function extractUrl(text) {
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : null;
}

async function fetchMediaInfo(url) {
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

async function fetchProxyVideo(proxyToken) {
  const res = await fetch(`${API_BASE}/api/proxy-video?proxy_token=${proxyToken}`, {
    headers: { 'x-api-key': API_KEY },
  });
  if (!res.ok) throw new Error(`Proxy video fetch status ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchDirectVideo(videoUrl) {
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`Direct video fetch status ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function handleMessage(userId, m) {
  const session = getOrCreateSession(userId);
  const msg = m.messages[0];
  if (!msg.message || msg.key.fromMe) return;

  const jid = msg.key.remoteJid;
  const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
  if (!text) return;

  const url = extractUrl(text);

  if (!url) {
    if (!session.seenUsers.has(jid)) {
      session.seenUsers.add(jid);
      await session.sock.sendMessage(
        jid,
        { text: 'Welcome to AMD - All Media Downloader Bot.\n\nSend a TikTok, Instagram, or Facebook video link and I will download it for you.' },
        { quoted: msg }
      );
    } else {
      await session.sock.sendMessage(jid, { text: 'Please send a video link only.' }, { quoted: msg });
    }
    return;
  }

  session.seenUsers.add(jid);
  const platform = detectPlatform(url);
  if (!platform) {
    await session.sock.sendMessage(
      jid,
      { text: 'This link is not supported. Send a TikTok, Instagram, or Facebook video link.' },
      { quoted: msg }
    );
    return;
  }

  try {
    await session.sock.sendPresenceUpdate('composing', jid);
    await session.sock.sendMessage(jid, { text: 'Downloading, please wait.' }, { quoted: msg });

    const data = await fetchMediaInfo(url);
    let videoBuffer;
    if (platform === 'tiktok' && data.proxy_token) {
      videoBuffer = await fetchProxyVideo(data.proxy_token);
    } else {
      videoBuffer = await fetchDirectVideo(data.video_url);
    }

    const captionText = [
      data.caption ? `Caption: ${data.caption}` : '',
      '',
      `Platform: ${data.platform}`,
      `Size: ${data.size || 'N/A'}`,
      `Duration: ${data.duration || 'N/A'}`,
    ].join('\n').trim();

    await session.sock.sendPresenceUpdate('paused', jid);
    await session.sock.sendMessage(jid, { video: videoBuffer, caption: captionText, mimetype: 'video/mp4' }, { quoted: msg });

    session.downloadCount++;
    addLog({ platform, status: 'Success', user: jid, ownerUserId: userId });
  } catch (err) {
    await session.sock.sendPresenceUpdate('paused', jid).catch(() => {});
    addLog({ platform, status: 'Failed', user: jid, ownerUserId: userId });
    await session.sock.sendMessage(jid, { text: `Download failed. Reason: ${err.message || 'Unknown error'}` }, { quoted: msg });
  }
}

export function getSessionStatus(userId) {
  const session = sessions.get(userId);
  if (!session) {
    return { connected: false, account: null, downloadCount: 0 };
  }
  return {
    connected: session.connected,
    account: session.sock?.user?.id || null,
    downloadCount: session.downloadCount,
  };
}

export function getAllStatuses() {
  const out = {};
  for (const [userId, session] of sessions.entries()) {
    out[userId] = {
      connected: session.connected,
      account: session.sock?.user?.id || null,
      downloadCount: session.downloadCount,
    };
  }
  return out;
}

export async function startSession(userId) {
  const session = getOrCreateSession(userId);
  if (session.connecting) return;
  session.connecting = true;
  session.latestQr = null;

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir(userId));

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
  });
  session.sock = sock;

  let openedThisSession = false;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      session.latestQr = qr;
    }

    if (connection === 'open') {
      if (openedThisSession) return;
      openedThisSession = true;
      session.connected = true;
      session.connecting = false;
      session.latestQr = null;
      updateUserState(userId, { connected: true, account: sock?.user?.id || null });
    } else if (connection === 'close') {
      session.connected = false;
      updateUserState(userId, { connected: false });
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      session.connecting = false;

      if (shouldReconnect) {
        setTimeout(() => startSession(userId).catch(() => {}), 1500);
      }
    }
  });

  sock.ev.on('messages.upsert', (m) => {
    if (m.type !== 'notify') return;
    handleMessage(userId, m).catch(() => {});
  });
}

export async function startFreshSession(userId) {
  const session = sessions.get(userId);
  if (session?.sock) {
    try { session.sock.end(undefined); } catch (e) {}
  }
  if (session) {
    session.sock = null;
    session.connected = false;
    session.connecting = false;
    session.latestQr = null;
  }

  const dir = sessionDir(userId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {}
  fs.mkdirSync(dir, { recursive: true });

  await startSession(userId);
}

export async function requestPairingCode(userId, phoneNumber) {
  const session = getOrCreateSession(userId);
  if (!session.sock) throw new Error('Connection not initialized');
  const code = await session.sock.requestPairingCode(phoneNumber);
  return code;
}

export async function getQrDataUrl(userId) {
  const session = sessions.get(userId);
  if (!session?.latestQr) return null;
  return QRCode.toDataURL(session.latestQr);
}

export async function disconnectSession(userId) {
  const session = sessions.get(userId);
  if (session?.sock) {
    try { await session.sock.logout(); } catch (e) {}
  }
  if (session) {
    session.connected = false;
    session.latestQr = null;
  }
  updateUserState(userId, { connected: false });
}

export async function destroySession(userId) {
  const session = sessions.get(userId);
  if (session?.sock) {
    try { await session.sock.logout(); } catch (e) {}
    try { session.sock.end(undefined); } catch (e) {}
  }
  sessions.delete(userId);
  const dir = sessionDir(userId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {}
}
