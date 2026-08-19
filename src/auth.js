import { createRemoteJWKSet, jwtVerify } from 'jose';
import crypto from 'crypto';

const ALLOWED_EMAIL = 'devmainulislam@gmail.com';
const FIREBASE_PROJECT_ID = 'amd-whatsapp-bot';

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error(
    '[auth] FATAL: SESSION_SECRET environment variable is not set. ' +
    'Generate one with `openssl rand -hex 32` and set it in Render > Environment. ' +
    'Without it, every restart invalidates all sessions (Session expired / login loop).'
  );
  process.exit(1);
}

const configuredOrigins = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export function isOriginAllowed(req) {
  if (configuredOrigins.length === 0) return true;
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return false;
  return configuredOrigins.some((allowed) => origin.startsWith(allowed));
}

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

export async function verifyIdToken(idToken) {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    audience: FIREBASE_PROJECT_ID,
  });

  if (!payload.email || payload.email_verified !== true) {
    throw new Error('Email not verified');
  }
  if (payload.email !== ALLOWED_EMAIL) {
    throw new Error('Unauthorized account');
  }
  return payload;
}

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

export function createSessionValue(email, picture, name) {
  const payload = {
    email,
    picture: picture || null,
    name: name || null,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign(body);
  return `${body}.${sig}`;
}

function decodeSession(cookieValue) {
  try {
    const [body, sig] = cookieValue.split('.');
    if (!body || !sig) return null;

    const expectedSig = sign(body);
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }

    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }
}

export function requireAuth(req, res, next) {
  if (!isOriginAllowed(req)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  const sessionCookie = req.cookies?.amd_session;
  if (!sessionCookie) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const decoded = decodeSession(sessionCookie);
  if (!decoded || decoded.email !== ALLOWED_EMAIL || decoded.exp < Date.now()) {
    return res.status(401).json({ error: 'Session expired' });
  }
  req.adminUser = decoded;
  next();
}

export { ALLOWED_EMAIL };
