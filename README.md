## AMD Web Dashboard (Multi-User)

> **Before you deploy:** `SESSION_SECRET` must be set on Render or the app
> will refuse to start. This is what you're hitting right now if you're
> seeing "Session expired" right after logging in, "Uptime: NaNs", or
> "Add User" silently failing — see the section below.

WhatsApp media downloader bot with a browser-based control panel. One admin
(you) signs in with Google and manages multiple WhatsApp bot accounts, each
tied to a user (name + phone number).

### What this is

- Express server managing multiple WhatsApp connections (Baileys), one per
  added user
- A web login page (Google Sign-In via Firebase, one allowed admin email)
- A dashboard to add/search/remove users, pair each user's WhatsApp
  (pairing code or QR), ban/unban, reconnect/disconnect per user, and view
  download logs
- Light-mode UI

### Local setup

```bash
npm install
npm start
```

Open `http://localhost:3000` in a browser.

### IMPORTANT — required environment variables for security

Two env vars must be set on Render (Dashboard → your service → Environment)
for the login/session system to be secure. Without them the app still runs,
but with weaker protection (details below).

**`SESSION_SECRET`**
A long random string used to cryptographically sign your login session
cookie, so nobody can forge a cookie that says "I'm the admin" without
knowing this secret. Generate one, e.g.:

```bash
openssl rand -hex 32
```

Set it as `SESSION_SECRET` in Render's environment variables. If you don't
set this, the server generates a random secret at boot — sessions still
can't be forged, but everyone gets logged out on every restart.

**`ALLOWED_ORIGIN`**
Your exact Render URL, e.g. `https://your-app-name.onrender.com`. This
stops someone who copies this code, hosts it elsewhere (their own domain,
their own Firebase project or not), and tries to call *your* server's API
from their copy — their requests get rejected because their site's origin
doesn't match. If you don't set this, origin checking is skipped (fine for
local development, not recommended in production).

### Why this is safe from "code theft" login

- Previously, the session cookie was just base64-encoded JSON — anyone
  could construct a fake "I am the admin" cookie by hand. This is now
  fixed: sessions are HMAC-signed with `SESSION_SECRET`, so a forged
  cookie is rejected.
- Google Sign-In only ever succeeds for the one allowed admin email
  (`devmainulislam@gmail.com`), checked both on the client and re-verified
  on the server from the real Firebase ID token — a stolen copy of the
  frontend code cannot forge a valid ID token for that email without
  access to that Google account.
- `ALLOWED_ORIGIN` blocks a copy of this app hosted on a different domain
  from calling back into your live server's API.
- If someone forks this code and deploys it to **their own Firebase
  project and their own hosting**, that's fine and expected — they'd be
  running their own independent instance, not touching your data or your
  server.

### Firebase config

Firebase client config lives in its own file: `public/firebase-config.js`.
Firebase web config is not a secret by design (Google's own docs confirm
this) — real protection comes from Firebase's **Authorized Domains**
setting (Firebase Console → Authentication → Settings → Authorized
domains: only your Render domain and localhost should be listed) plus the
server-side `ALLOWED_EMAIL` + `ALLOWED_ORIGIN` checks described above.

If you fork this project onto your own Firebase project, just replace the
values in that one file.

### Render deployment

1. Push this project to a GitHub repository
2. On Render, create a new **Web Service** from that repository
3. Build command: `npm install`
4. Start command: `npm start`
5. Set `SESSION_SECRET` and `ALLOWED_ORIGIN` environment variables (see above)
6. In Google Cloud Console, add the Render URL to **Authorized JavaScript
   origins** in the OAuth client if sign-in fails
7. In Firebase Console → Authentication → Settings → Authorized domains,
   make sure only your Render domain (and localhost) are listed

### Session persistence

Each user's WhatsApp session is stored in `sessions/<phone-number>/` on
disk. Render's free tier filesystem is **not persistent** across restarts
or deploys, so every user will need to be re-paired (pairing code or QR)
after a restart/redeploy unless you attach a paid Persistent Disk.

The dashboard's "Uptime" reflects how long the **server process** has been
running (resets on restart) — this tells you at a glance whether a restart
happened and users may need re-pairing.

### Multi-user model

- Admin adds a user with **name + WhatsApp phone number**
- That creates a dedicated WhatsApp bot session for that number
- The user links their own WhatsApp app to that session via pairing code
  or QR (WhatsApp → Linked Devices → Link with phone number)
- Once linked, links (TikTok/Instagram/Facebook) sent to that WhatsApp
  number get downloaded and sent back automatically
- Admin can search the user list by name/number, disconnect any user's
  session, ban a user (disconnects them and sends "You have been banned"
  on their next message attempt, blocks reconnecting), or remove them
  entirely (wipes their session data)

### Restricted admin access

Only `devmainulislam@gmail.com` can sign in and reach the dashboard. Any
other Google account is rejected after sign-in.
