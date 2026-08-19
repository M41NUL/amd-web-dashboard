import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { addLog } from './logger.js';

const API_BASE = 'https://all-media-downloader-api.onrender.com';
const API_KEY = 'm41nul';

const authDir = path.join(process.cwd(), 'session');
if (!fs.existsSync(authDir)) {
  fs.mkdirSync(authDir, { recursive: true });
}

let sock = null;
let latestQr = null;
let connected = false;
let connecting = false;
let downloadCount = 0;
const seenUsers = new Set();

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

async function handleMessage(m) {
  const msg = m.messages[0];
  if (!msg.message || msg.key.fromMe) return;

  const jid = msg.key.remoteJid;
  const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
  if (!text) return;

  const url = extractUrl(text);

  if (!url) {
    if (!seenUsers.has(jid)) {
      seenUsers.add(jid);
      await sock.sendMessage(
        jid,
        { text: 'Welcome to AMD - All Media Downloader Bot.\n\nSend a TikTok, Instagram, or Facebook video link and I will download it for you.' },
        { quoted: msg }
      );
    } else {
      await sock.sendMessage(jid, { text: 'Please send a video link only.' }, { quoted: msg });
    }
    return;
  }

  seenUsers.add(jid);
  const platform = detectPlatform(url);
  if (!platform) {
    await sock.sendMessage(
      jid,
      { text: 'This link is not supported. Send a TikTok, Instagram, or Facebook video link.' },
      { quoted: msg }
    );
    return;
  }

  try {
    await sock.sendPresenceUpdate('composing', jid);
    await sock.sendMessage(jid, { text: 'Downloading, please wait.' }, { quoted: msg });

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

    await sock.sendPresenceUpdate('paused', jid);
    await sock.sendMessage(jid, { video: videoBuffer, caption: captionText, mimetype: 'video/mp4' }, { quoted: msg });

    downloadCount++;
    addLog({ platform, status: 'Success', user: jid });
  } catch (err) {
    await sock.sendPresenceUpdate('paused', jid).catch(() => {});
    addLog({ platform, status: 'Failed', user: jid });
    await sock.sendMessage(jid, { text: `Download failed. Reason: ${err.message || 'Unknown error'}` }, { quoted: msg });
  }
}

export function getStatus() {
  return {
    connected,
    account: sock?.user?.id || null,
    downloadCount,
  };
}

export async function startConnection() {
  if (connecting) return;
  connecting = true;
  latestQr = null;

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
  });

  let openedThisSession = false;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQr = qr;
    }

    if (connection === 'open') {
      if (openedThisSession) return;
      openedThisSession = true;
      connected = true;
      connecting = false;
      latestQr = null;
    } else if (connection === 'close') {
      connected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      connecting = false;
      if (shouldReconnect) {
        setTimeout(() => startConnection(), 1500);
      }
    }
  });

  sock.ev.on('messages.upsert', (m) => {
    if (m.type !== 'notify') return;
    handleMessage(m).catch(() => {});
  });
}

export async function requestPairingCode(phoneNumber) {
  if (!sock) throw new Error('Connection not initialized');
  const code = await sock.requestPairingCode(phoneNumber);
  return code;
}

export async function getQrDataUrl() {
  if (!latestQr) return null;
  return QRCode.toDataURL(latestQr);
}

export async function reconnect() {
  if (sock) {
    try { sock.end(undefined); } catch (e) {}
  }
  connected = false;
  connecting = false;
  await startConnection();
}

export async function disconnect() {
  if (sock) {
    try { await sock.logout(); } catch (e) {}
  }
  connected = false;
  latestQr = null;
}
