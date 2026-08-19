import { createRemoteJWKSet, jwtVerify } from 'jose';

const ALLOWED_EMAIL = 'devmainulislam@gmail.com';
const FIREBASE_PROJECT_ID = 'amd-whatsapp-bot';

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

export function requireAuth(req, res, next) {
  const sessionCookie = req.cookies?.amd_session;
  if (!sessionCookie) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const decoded = decodeSession(sessionCookie);
  if (!decoded || decoded.email !== ALLOWED_EMAIL || decoded.exp < Date.now()) {
    return res.status(401).json({ error: 'Session expired' });
  }
  next();
}

export function createSessionValue(email) {
  const payload = {
    email,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function decodeSession(cookieValue) {
  try {
    return JSON.parse(Buffer.from(cookieValue, 'base64').toString('utf8'));
  } catch (err) {
    return null;
  }
}

export { ALLOWED_EMAIL };
