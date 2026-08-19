import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { verifyIdToken, requireAuth, createSessionValue, isOriginAllowed } from './auth.js';
import {
  startSession,
  startFreshSession,
  getSessionStatus,
  getAllStatuses,
  requestPairingCode,
  getQrDataUrl,
  disconnectSession,
  destroySession,
} from './whatsapp.js';
import { getLogs, getLogsForUser, clearLogs, getServerUptimeSeconds } from './logger.js';
import { listUsers, getUser, addUser, removeUser, setBanned, searchUsers } from './userStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((req, res, next) => {
  if (req.method !== 'GET' && !isOriginAllowed(req)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  next();
});

app.post('/auth/session', async (req, res) => {
  try {
    const { idToken } = req.body;
    const decoded = await verifyIdToken(idToken);
    const sessionValue = createSessionValue(decoded.email, decoded.picture, decoded.name);
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
  res.json({ ok: true, user: req.adminUser });
});

app.post('/auth/logout', (req, res) => {
  res.clearCookie('amd_session');
  res.json({ ok: true });
});

app.get('/api/server-info', requireAuth, (req, res) => {
  res.json({ uptimeSeconds: getServerUptimeSeconds() });
});

app.get('/api/users', requireAuth, (req, res) => {
  const q = req.query.q || '';
  const users = q ? searchUsers(q) : listUsers();
  const withStatus = users.map((u) => ({
    ...u,
    ...getSessionStatus(u.id),
    banned: u.banned,
  }));
  res.json({ users: withStatus });
});

app.post('/api/users', requireAuth, async (req, res) => {
  try {
    const { name, phone } = req.body;
    const user = addUser({ name, phone });
    res.json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to add user' });
  }
});

app.delete('/api/users/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await destroySession(id);
    removeUser(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to remove user' });
  }
});

app.post('/api/users/:id/ban', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user = setBanned(id, true);
    await disconnectSession(id);
    res.json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to ban user' });
  }
});

app.post('/api/users/:id/unban', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user = setBanned(id, false);
    res.json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to unban user' });
  }
});

function requireUser(req, res, next) {
  const user = getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  req.targetUser = user;
  next();
}

app.get('/api/users/:id/status', requireAuth, requireUser, (req, res) => {
  res.json(getSessionStatus(req.params.id));
});

app.post('/api/users/:id/pair', requireAuth, requireUser, async (req, res) => {
  try {
    if (req.targetUser.banned) {
      return res.status(403).json({ error: 'User is banned' });
    }
    await startFreshSession(req.params.id);
    await new Promise((r) => setTimeout(r, 800));
    const code = await requestPairingCode(req.params.id, req.targetUser.phone);
    res.json({ code });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to get pairing code' });
  }
});

app.get('/api/users/:id/qr', requireAuth, requireUser, async (req, res) => {
  try {
    if (req.targetUser.banned) {
      return res.status(403).json({ error: 'User is banned' });
    }
    await startFreshSession(req.params.id);

    let qr = null;
    for (let i = 0; i < 10; i++) {
      qr = await getQrDataUrl(req.params.id);
      if (qr) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!qr) {
      return res.status(404).json({ error: 'QR not available yet, try again' });
    }
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR' });
  }
});

app.post('/api/users/:id/disconnect', requireAuth, requireUser, async (req, res) => {
  try {
    await disconnectSession(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Disconnect failed' });
  }
});

app.get('/api/users/:id/logs', requireAuth, requireUser, (req, res) => {
  res.json({ logs: getLogsForUser(req.params.id) });
});

app.get('/api/logs', requireAuth, (req, res) => {
  res.json({ logs: getLogs() });
});

app.post('/api/logs/clear', requireAuth, (req, res) => {
  clearLogs();
  res.json({ ok: true });
});

app.listen(PORT, async () => {
  console.log(`AMD web dashboard running on port ${PORT}`);
  const users = listUsers();
  for (const user of users) {
    if (!user.banned) {
      startSession(user.id).catch((err) =>
        console.error(`Failed to resume session for ${user.name}:`, err.message)
      );
    }
  }
});
