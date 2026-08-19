## AMD Web Dashboard

WhatsApp media downloader bot with a browser-based control panel, restricted to a single Google account.

### What this is

- Express server running the WhatsApp connection (Baileys) as a background process
- A web login page (Google Sign-In via Firebase, one allowed email)
- A dashboard to connect WhatsApp (pairing code or QR), view status, view download logs, reconnect, and disconnect

### Local setup

```bash
npm install
npm start
```

Open `http://localhost:3000` in a browser.

### Render deployment

1. Push this project to a GitHub repository
2. On Render, create a new **Web Service** from that repository
3. Build command: `npm install`
4. Start command: `npm start`
5. In Google Cloud Console, add the Render URL to **Authorized JavaScript origins** in the OAuth client if sign-in fails

### Session persistence

The WhatsApp session is stored in a `session/` folder on disk. Render's free tier filesystem is not persistent across restarts or deploys, so the bot will need to be reconnected (pairing code or QR) after every redeploy or restart unless a paid Persistent Disk is attached.

### Restricted access

Only `devmainulislam@gmail.com` can sign in and reach the dashboard. Any other Google account is rejected after sign-in.
