# PharmaTrack

MERN-based pharmacy medicine availability and reservation system.

## Current flow

- Separate Patient and Pharmacy registration/login.
- Pharmacies add and update real stock in MongoDB.
- Patients search medicine by name/generic name.
- Search uses the patient's browser location and MongoDB's 2dsphere index to return nearby pharmacies with stock, including distance.
- Google Maps shows the patient's location and pharmacy markers and provides directions.
- Patient reservations atomically reduce stock.
- Socket.IO broadcasts inventory and reservation changes in real time.
- Pharmacy dashboards receive new reservations without refresh.
- Reserved stock is held for `HOLD_MINUTES` and returned automatically if the hold expires.

## Setup

### Server

Create `server/.env`:

```env
MONGO_URI=your-atlas-connection-string
JWT_SECRET=your-long-random-secret
PORT=5000
HOLD_MINUTES=120
CLIENT_URL=http://localhost:5173
```

Then:

```powershell
cd server
npm install
npm run dev
```

### Client

Create `client/.env`:

```env
VITE_GOOGLE_MAPS_API_KEY=your-google-maps-key
VITE_API_URL=http://localhost:5000/api
```

Then:

```powershell
cd client
npm install
npm run dev
```

## Google Maps

Enable the Maps JavaScript API for the Google Cloud project used by the client API key. Restrict the key to your local/deployed web origins when possible.

## Important

Create real pharmacy accounts and add medicines through the pharmacy dashboard. Patient search results are read from MongoDB; there are no hardcoded pharmacy or stock results.

## Deployment

Socket.IO needs a long-running server, so host the pieces separately:

| Part | Where | Notes |
| --- | --- | --- |
| Database | MongoDB Atlas | Network Access: allow `0.0.0.0/0` (Render/Railway IPs change). Use a dedicated DB user. |
| API + Socket.IO | Render (Web Service) | Root dir `server`, build `npm install`, start `npm start`. Not Vercel/Netlify functions. |
| React client | Vercel or Netlify | Root dir `client`, build `npm run build`, output `dist`. |

### 1. API (Render)
Set these environment variables: `MONGO_URI`, `JWT_SECRET` (generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`), `HOLD_MINUTES=120`, and `CLIENT_URL` (your client URL, no trailing slash; comma-separate several). Check `https://<api>/api/health` returns `{"ok":true,"db":true}`.

### 2. Client (Vercel)
Set `VITE_API_URL=https://<api>/api` and `VITE_GOOGLE_MAPS_API_KEY`, then deploy. After you know the final URL, put it in the API's `CLIENT_URL` and redeploy the API.

### 3. Google Maps key
Restrict the key to HTTP referrers (your Vercel domain and `http://localhost:5173/*`) and to the Maps JavaScript API only.

### Notes
- Geolocation only works on HTTPS (or localhost); Vercel/Netlify provide this.
- Render's free tier sleeps after inactivity, which pauses the hold-expiry worker and drops sockets. Use a paid instance, or ping `/api/health` on a schedule, for a real launch.
- Never commit `.env` files; `.gitignore` already excludes them.
