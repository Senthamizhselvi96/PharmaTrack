import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { Patient, Pharmacy, Stock, Reservation } from './models/index.js';

for (const key of ['MONGO_URI', 'JWT_SECRET']) {
  if (!process.env[key]) { console.error(`Missing required environment variable: ${key}`); process.exit(1); }
}

// CLIENT_URL may hold several comma-separated origins (e.g. production + preview)
const origins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: origins, methods: ['GET', 'POST'] } });

app.use(cors({ origin: origins }));
app.use(express.json({ limit: '100kb' }));

const HOLD_MS = (+process.env.HOLD_MINUTES || 120) * 60000;
const httpError = (status, message) => Object.assign(new Error(message), { status });
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error(e.message);
  res.status(e.status || 400).json({ error: e.message || 'Request failed' });
});

const makeToken = (id, role) => jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '7d' });

const auth = (roles = []) => (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (roles.length && !roles.includes(payload.role)) return res.status(403).json({ error: 'Access denied' });
    req.userId = payload.id;
    req.role = payload.role;
    next();
  } catch {
    res.status(401).json({ error: 'Login required' });
  }
};

const cleanEmail = email => String(email || '').trim().toLowerCase();

// ---------- Socket.IO: authenticated, users only join their own room ----------
io.use((socket, next) => {
  try {
    const { id, role } = jwt.verify(socket.handshake.auth?.token || '', process.env.JWT_SECRET);
    socket.data.userId = id;
    socket.data.role = role;
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});
io.on('connection', socket => {
  socket.join(`${socket.data.role}:${socket.data.userId}`); // patient:<id> or pharmacy:<id>
});

// ---------- Helpers ----------
const emitInventory = stock => stock && io.emit('inventory:updated', {
  stockId: stock._id, pharmacyId: stock.pharmacy, quantity: stock.quantity
});

// Give reserved units back to stock. Callers must only call this once per reservation,
// right after atomically moving it into cancelled/expired.
const releaseStock = async reservation => {
  const stockId = reservation.stock?._id || reservation.stock;
  const stock = await Stock.findByIdAndUpdate(stockId, { $inc: { quantity: reservation.quantity } }, { new: true });
  emitInventory(stock);
  return stock;
};

const notifyReservation = (reservation, status, medicine) => {
  const payload = { reservationId: reservation._id, status, medicine };
  io.to(`patient:${reservation.patient}`).emit('reservation:updated', payload);
  io.to(`pharmacy:${reservation.pharmacy}`).emit('reservation:updated', payload);
};

app.get('/api/health', (req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));

// ---------- Patient auth ----------
app.post('/api/auth/patient/register', wrap(async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password || !phone) throw new Error('Name, email, phone and password are required');
  if (String(password).length < 6) throw new Error('Password must be at least 6 characters');
  const exists = await Patient.findOne({ email: cleanEmail(email) });
  if (exists) throw new Error('A patient account with this email already exists');
  const patient = await Patient.create({
    name, email: cleanEmail(email), phone, password: await bcrypt.hash(password, 10)
  });
  res.status(201).json({ token: makeToken(patient._id, 'patient'), role: 'patient', name: patient.name, id: patient._id });
}));

app.post('/api/auth/patient/login', wrap(async (req, res) => {
  const patient = await Patient.findOne({ email: cleanEmail(req.body.email) });
  if (!patient || !(await bcrypt.compare(req.body.password || '', patient.password))) throw httpError(401, 'Invalid email or password');
  res.json({ token: makeToken(patient._id, 'patient'), role: 'patient', name: patient.name, id: patient._id });
}));

// ---------- Pharmacy auth ----------
app.post('/api/auth/pharmacy/register', wrap(async (req, res) => {
  const { name, ownerName, email, password, phone, address, lat, lng } = req.body;
  if (!name || !email || !password || !address || lat == null || lat === '' || lng == null || lng === '') {
    throw new Error('Pharmacy name, email, password, address, latitude and longitude are required');
  }
  if (String(password).length < 6) throw new Error('Password must be at least 6 characters');
  const exists = await Pharmacy.findOne({ email: cleanEmail(email) });
  if (exists) throw new Error('A pharmacy account with this email already exists');
  const latNum = Number(lat), lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum) || latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
    throw new Error('Enter valid latitude and longitude');
  }
  const pharmacy = await Pharmacy.create({
    name, ownerName, email: cleanEmail(email), phone, address,
    password: await bcrypt.hash(password, 10),
    location: { type: 'Point', coordinates: [lngNum, latNum] } // GeoJSON order: [lng, lat]
  });
  res.status(201).json({ token: makeToken(pharmacy._id, 'pharmacy'), role: 'pharmacy', name: pharmacy.name, id: pharmacy._id });
}));

app.post('/api/auth/pharmacy/login', wrap(async (req, res) => {
  const pharmacy = await Pharmacy.findOne({ email: cleanEmail(req.body.email) });
  if (!pharmacy || !(await bcrypt.compare(req.body.password || '', pharmacy.password))) throw httpError(401, 'Invalid email or password');
  res.json({ token: makeToken(pharmacy._id, 'pharmacy'), role: 'pharmacy', name: pharmacy.name, id: pharmacy._id });
}));

// ---------- Pharmacy inventory ----------
app.get('/api/pharmacy/stock', auth(['pharmacy']), wrap(async (req, res) => {
  res.json(await Stock.find({ pharmacy: req.userId }).sort('medicine'));
}));

app.put('/api/pharmacy/stock', auth(['pharmacy']), wrap(async (req, res) => {
  const { medicine, generic, quantity, price } = req.body;
  if (!medicine || !String(medicine).trim()) throw new Error('Medicine name is required');
  const qty = Math.floor(Number(quantity) || 0);
  if (qty < 0) throw new Error('Quantity cannot be negative');
  const stock = await Stock.findOneAndUpdate(
    { pharmacy: req.userId, medicine: String(medicine).trim() },
    { generic, quantity: qty, price: price === '' || price == null ? undefined : Number(price) },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
  io.to(`pharmacy:${req.userId}`).emit('stock:updated', { stock });
  emitInventory(stock);
  res.json(stock);
}));
app.get('/api/pharmacy/profile', auth(['pharmacy']), wrap(async (req, res) => {
  const pharmacy = await Pharmacy.findById(req.userId).select('-password');

  if (!pharmacy) {
    throw httpError(404, 'Pharmacy not found');
  }

  res.json(pharmacy);
}));

app.get('/api/pharmacy/reservations', auth(['pharmacy']), wrap(async (req, res) => {
  res.json(await Reservation.find({ pharmacy: req.userId }).populate('stock', 'medicine price').sort('-createdAt'));
}));

// Allowed status transitions made by the pharmacy
const PHARMACY_NEXT = {
  held: ['confirmed', 'cancelled'],
  confirmed: ['ready', 'cancelled'],
  ready: ['collected', 'cancelled']
};

app.patch('/api/pharmacy/reservations/:id/status', auth(['pharmacy']), wrap(async (req, res) => {
  const { status } = req.body;
  const current = await Reservation.findOne({ _id: req.params.id, pharmacy: req.userId });
  if (!current) throw httpError(404, 'Reservation not found');
  if (!(PHARMACY_NEXT[current.status] || []).includes(status)) {
    throw new Error(`A ${current.status} reservation cannot be changed to ${status}`);
  }
  // Conditional update: if two requests race, only one wins
  const reservation = await Reservation.findOneAndUpdate(
    { _id: current._id, status: current.status }, { status }, { new: true }
  ).populate('stock', 'medicine');
  if (!reservation) throw httpError(409, 'Reservation was just updated. Refresh and try again');

  if (status === 'cancelled') await releaseStock(reservation);
  notifyReservation(reservation, status, reservation.stock?.medicine);
  res.json(reservation);
}));

// ---------- Patient search ----------
app.get('/api/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) throw new Error('Enter a medicine name');
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new Error('Patient location is required');
  }
  const radiusKm = Math.min(Math.max(Number(req.query.radiusKm) || 10, 1), 50);

  const near = await Pharmacy.aggregate([
    { $geoNear: { near: { type: 'Point', coordinates: [lng, lat] }, distanceField: 'distanceMeters', maxDistance: radiusKm * 1000, spherical: true } },
    { $project: { password: 0, email: 0 } },
    { $limit: 50 }
  ]);
  const byId = new Map(near.map(p => [String(p._id), p]));

  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const stock = await Stock.find({
    pharmacy: { $in: [...byId.keys()] },
    quantity: { $gt: 0 },
    $or: [{ medicine: rx }, { generic: rx }]
  }).limit(100);

  const results = stock
    .map(s => {
      const p = byId.get(String(s.pharmacy));
      return p && { stock: s, pharmacy: p, distanceKm: +(p.distanceMeters / 1000).toFixed(2) };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceKm - b.distanceKm);
  res.json(results);
}));

// ---------- Patient reservations ----------
app.post('/api/reservations', auth(['patient']), wrap(async (req, res) => {
  const { stockId, quantity } = req.body;
  const qty = Number(quantity);
  if (!mongoose.isValidObjectId(stockId) || !Number.isInteger(qty) || qty < 1) throw new Error('Enter a valid reservation quantity');

  const patient = await Patient.findById(req.userId);
  if (!patient) throw new Error('Patient account not found');

  // Atomic: decrement only if enough stock remains, so the last units can't be oversold
  const stock = await Stock.findOneAndUpdate(
    { _id: stockId, quantity: { $gte: qty } },
    { $inc: { quantity: -qty } },
    { new: true }
  );
  if (!stock) throw new Error('Not enough stock left at this pharmacy');

  try {
    const reservation = await Reservation.create({
      stock: stock._id, pharmacy: stock.pharmacy, patient: patient._id,
      patientName: patient.name, patientPhone: patient.phone,
      quantity: qty, expiresAt: new Date(Date.now() + HOLD_MS)
    });
    emitInventory(stock);
    io.to(`pharmacy:${stock.pharmacy}`).emit('reservation:new', {
      reservationId: reservation._id, medicine: stock.medicine, quantity: qty, patientName: patient.name
    });
    res.status(201).json(reservation);
  } catch (error) {
    await Stock.updateOne({ _id: stock._id }, { $inc: { quantity: qty } });
    throw error;
  }
}));

app.get('/api/patient/reservations', auth(['patient']), wrap(async (req, res) => {
  res.json(await Reservation.find({ patient: req.userId })
    .populate('stock', 'medicine generic price')
    .populate('pharmacy', 'name address location')
    .sort('-createdAt'));
}));
app.get('/api/patient/profile', auth(['patient']), wrap(async (req, res) => {
  const patient = await Patient.findById(req.userId).select('-password');

  if (!patient) {
    throw httpError(404, 'Patient not found');
  }

  res.json(patient);
}));
app.patch('/api/patient/reservations/:id/cancel', auth(['patient']), wrap(async (req, res) => {
  // Atomic status change guarantees stock is returned exactly once, even on double-clicks
  const reservation = await Reservation.findOneAndUpdate(
    { _id: req.params.id, patient: req.userId, status: { $in: ['held', 'confirmed'] } },
    { status: 'cancelled' }, { new: true }
  );
  if (!reservation) throw new Error('Reservation cannot be cancelled');
  await releaseStock(reservation);
  notifyReservation(reservation, 'cancelled');
  res.json(reservation);
}));

// ---------- Expiry worker: return expired holds to stock ----------
const expireHolds = async () => {
  const due = await Reservation.find({ status: 'held', expiresAt: { $lt: new Date() } });
  for (const r of due) {
    const changed = await Reservation.updateOne({ _id: r._id, status: 'held' }, { status: 'expired' });
    if (changed.modifiedCount) {
      await releaseStock(r);
      notifyReservation(r, 'expired');
    }
  }
};

await mongoose.connect(process.env.MONGO_URI);
setInterval(() => expireHolds().catch(e => console.error('Expiry worker:', e.message)), 60000);

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => console.log(`API + Socket.IO running on port ${PORT}`));
