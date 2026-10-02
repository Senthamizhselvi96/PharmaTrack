# PharmaFind

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
