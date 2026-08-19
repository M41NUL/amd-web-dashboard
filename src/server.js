import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { verifyIdToken, requireAuth, createSessionValue } from './auth.js';
import { startConnection, getStatus, requestPairingCode, getQrDataUrl, reconnect, disconnect } from './whatsapp.js';
import { getLogs, clearLogs } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.post('/auth/session', async (req, res) => {
  try {
    const { idToken } = req.body;
    const decoded = await verifyIdToken(idToken);
    const sessionValue = createSessionValue(decoded.email);
    res.cookie('amd_session', sessionValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

app.get('/auth/verify', requireAuth, (req, res) => {
  res.json({ ok: true });
});

app.post('/auth/logout', (req, res) => {
  res.clearCookie('amd_session');
  res.json({ ok: true });
});

app.get('/api/status', requireAuth, (req, res) => {
  res.json(getStatus());
});

app.post('/api/pair', requireAuth, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || phone.length < 8) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }
    const code = await requestPairingCode(phone);
    res.json({ code });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to get pairing code' });
  }
});

app.get('/api/qr', requireAuth, async (req, res) => {
  try {
    const qr = await getQrDataUrl();
    if (!qr) {
      return res.status(404).json({ error: 'QR not available yet, try again' });
    }
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR' });
  }
});

app.post('/api/reconnect', requireAuth, async (req, res) => {
  try {
    await reconnect();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Reconnect failed' });
  }
});

app.post('/api/disconnect', requireAuth, async (req, res) => {
  try {
    await disconnect();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Disconnect failed' });
  }
});

app.get('/api/logs', requireAuth, (req, res) => {
  res.json({ logs: getLogs() });
});

app.post('/api/logs/clear', requireAuth, (req, res) => {
  clearLogs();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`AMD web dashboard running on port ${PORT}`);
  startConnection().catch((err) => console.error('Failed to start WhatsApp connection:', err));
});
