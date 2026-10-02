import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { Patient, Pharmacy, Stock, Reservation } from './models/index.js';

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.CLIENT_URL || 'http://localhost:5173', methods: ['GET', 'POST', 'PATCH', 'PUT'] }
});

app.use(cors());
app.use(express.json());

const HOLD_MS = (+process.env.HOLD_MINUTES || 120) * 60000;
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error(e);
  res.status(e.status || 400).json({ error: e.message || 'Request failed' });
});

const makeToken = (id, role) =>
  jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '7d' });

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

io.on('connection', socket => {
  socket.on('join:patient', patientId => {
    if (patientId) socket.join(`patient:${patientId}`);
  });
  socket.on('join:pharmacy', pharmacyId => {
    if (pharmacyId) socket.join(`pharmacy:${pharmacyId}`);
  });
});

// ---------- Patient auth ----------
app.post('/api/auth/patient/register', wrap(async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password || !phone) throw new Error('Name, email, phone and password are required');
  const exists = await Patient.findOne({ email: cleanEmail(email) });
  if (exists) throw new Error('A patient account with this email already exists');
  const patient = await Patient.create({
    name, email: cleanEmail(email), phone, password: await bcrypt.hash(password, 10)
  });
  res.status(201).json({ token: makeToken(patient._id, 'patient'), role: 'patient', name: patient.name, id: patient._id });
}));

app.post('/api/auth/patient/login', wrap(async (req, res) => {
  const patient = await Patient.findOne({ email: cleanEmail(req.body.email) });
  if (!patient || !(await bcrypt.compare(req.body.password || '', patient.password))) {
    const e = new Error('Invalid email or password'); e.status = 401; throw e;
  }
  res.json({ token: makeToken(patient._id, 'patient'), role: 'patient', name: patient.name, id: patient._id });
}));

// ---------- Pharmacy auth ----------
app.post('/api/auth/pharmacy/register', wrap(async (req, res) => {
  const { name, ownerName, email, password, phone, address, lat, lng } = req.body;
  if (!name || !email || !password || !address || !lat || !lng) {
    throw new Error('Pharmacy name, email, password, address, latitude and longitude are required');
  }
  const exists = await Pharmacy.findOne({ email: cleanEmail(email) });
  if (exists) throw new Error('A pharmacy account with this email already exists');
  const latNum = Number(lat), lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum) || latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
    throw new Error('Enter valid latitude and longitude');
  }
  const pharmacy = await Pharmacy.create({
    name, ownerName, email: cleanEmail(email), phone, address,
    password: await bcrypt.hash(password, 10),
    location: { type: 'Point', coordinates: [lngNum, latNum] }
  });
  res.status(201).json({ token: makeToken(pharmacy._id, 'pharmacy'), role: 'pharmacy', name: pharmacy.name, id: pharmacy._id });
}));

app.post('/api/auth/pharmacy/login', wrap(async (req, res) => {
  const pharmacy = await Pharmacy.findOne({ email: cleanEmail(req.body.email) });
  if (!pharmacy || !(await bcrypt.compare(req.body.password || '', pharmacy.password))) {
    const e = new Error('Invalid email or password'); e.status = 401; throw e;
  }
  res.json({ token: makeToken(pharmacy._id, 'pharmacy'), role: 'pharmacy', name: pharmacy.name, id: pharmacy._id });
}));

// ---------- Pharmacy inventory ----------
app.get('/api/pharmacy/stock', auth(['pharmacy']), wrap(async (req, res) => {
  res.json(await Stock.find({ pharmacy: req.userId }).sort('medicine'));
}));

app.put('/api/pharmacy/stock', auth(['pharmacy']), wrap(async (req, res) => {
  const { medicine, generic, quantity, price } = req.body;
  if (!medicine) throw new Error('Medicine name is required');
  const stock = await Stock.findOneAndUpdate(
    { pharmacy: req.userId, medicine: medicine.trim() },
    { generic, quantity: Number(quantity) || 0, price: price === '' ? undefined : Number(price) },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
  io.to(`pharmacy:${req.userId}`).emit('stock:updated', { stock });
  io.emit('inventory:updated', { stockId: stock._id, pharmacyId: req.userId, quantity: stock.quantity });
  res.json(stock);
}));

app.get('/api/pharmacy/reservations', auth(['pharmacy']), wrap(async (req, res) => {
  res.json(await Reservation.find({ pharmacy: req.userId }).populate('stock', 'medicine price').sort('-createdAt'));
}));

app.patch('/api/pharmacy/reservations/:id/status', auth(['pharmacy']), wrap(async (req, res) => {
  const allowed = ['confirmed', 'ready', 'collected', 'cancelled'];
  const { status } = req.body;
  if (!allowed.includes(status)) throw new Error('Invalid reservation status');
  const reservation = await Reservation.findOne({ _id: req.params.id, pharmacy: req.userId, status: { $nin: ['expired', 'collected', 'cancelled'] } }).populate('stock', 'medicine');
  if (!reservation) throw new Error('Reservation not found or already closed');

  reservation.status = status;
  await reservation.save();

  io.to(`patient:${reservation.patient}`).emit('reservation:updated', {
    reservationId: reservation._id,
    status,
    medicine: reservation.stock?.medicine
  });
  io.to(`pharmacy:${req.userId}`).emit('reservation:updated', { reservationId: reservation._id, status });
  res.json(reservation);
}));

// Backward-compatible endpoints for the current UI
app.get('/api/stock', auth(['pharmacy']), wrap(async (req, res) => res.json(await Stock.find({ pharmacy: req.userId }).sort('medicine'))));
app.put('/api/stock', auth(['pharmacy']), wrap(async (req, res) => {
  const { medicine, generic, quantity, price } = req.body;
  const stock = await Stock.findOneAndUpdate({ pharmacy: req.userId, medicine },
    { generic, quantity, price }, { upsert: true, new: true, runValidators: true });
  io.emit('inventory:updated', { stockId: stock._id, pharmacyId: req.userId, quantity: stock.quantity });
  res.json(stock);
}));

// ---------- Patient search ----------
app.get('/api/search', wrap(async (req, res) => {
  const { q = '', lat, lng, radiusKm = 10 } = req.query;
  if (!q.trim()) throw new Error('Enter a medicine name');
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) throw new Error('Patient location is required');

  const near = await Pharmacy.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
        distanceField: 'distanceMeters',
        maxDistance: Number(radiusKm) * 1000,
        spherical: true
      }
    },
    { $project: { password: 0, email: 0 } },
    { $limit: 50 }
  ]);

  const pharmacyIds = near.map(p => p._id);
  const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const stock = await Stock.find({
    pharmacy: { $in: pharmacyIds },
    quantity: { $gt: 0 },
    $or: [{ medicine: rx }, { generic: rx }]
  });

  const results = stock.map(s => {
    const p = near.find(x => String(x._id) === String(s.pharmacy));
    return {
      stock: s,
      pharmacy: p,
      distanceKm: p ? +(p.distanceMeters / 1000).toFixed(2) : null
    };
  }).filter(x => x.pharmacy);

  res.json(results);
}));

// ---------- Patient reservations ----------
app.post('/api/reservations', auth(['patient']), wrap(async (req, res) => {
  const { stockId, quantity } = req.body;
  const qty = Number(quantity);
  if (!stockId || !Number.isInteger(qty) || qty < 1) throw new Error('Enter a valid reservation quantity');

  const patient = await Patient.findById(req.userId);
  if (!patient) throw new Error('Patient account not found');

  const stock = await Stock.findOneAndUpdate(
    { _id: stockId, quantity: { $gte: qty } },
    { $inc: { quantity: -qty } },
    { new: true }
  );
  if (!stock) throw new Error('Not enough stock left at this pharmacy');

  try {
    const reservation = await Reservation.create({
      stock: stock._id,
      pharmacy: stock.pharmacy,
      patient: patient._id,
      patientName: patient.name,
      patientPhone: patient.phone,
      quantity: qty,
      expiresAt: new Date(Date.now() + HOLD_MS)
    });

    io.emit('inventory:updated', {
      stockId: stock._id,
      pharmacyId: stock.pharmacy,
      quantity: stock.quantity
    });
    io.to(`pharmacy:${stock.pharmacy}`).emit('reservation:new', {
      reservationId: reservation._id,
      medicine: stock.medicine,
      quantity: qty,
      patientName: patient.name
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

app.patch('/api/patient/reservations/:id/cancel', auth(['patient']), wrap(async (req, res) => {
  const reservation = await Reservation.findOne({
    _id: req.params.id, patient: req.userId, status: 'held'
  });
  if (!reservation) throw new Error('Reservation cannot be cancelled');

  reservation.status = 'cancelled';
  await reservation.save();
  await Stock.updateOne({ _id: reservation.stock }, { $inc: { quantity: reservation.quantity } });

  io.emit('inventory:updated', {
    stockId: reservation.stock,
    pharmacyId: reservation.pharmacy,
    quantity: (await Stock.findById(reservation.stock))?.quantity
  });
  io.to(`pharmacy:${reservation.pharmacy}`).emit('reservation:updated', {
    reservationId: reservation._id, status: 'cancelled'
  });
  res.json(reservation);
}));

// Return expired holds to stock every minute
setInterval(async () => {
  try {
    const expired = await Reservation.find({ status: 'held', expiresAt: { $lt: new Date() } });
    for (const r of expired) {
      const changed = await Reservation.updateOne({ _id: r._id, status: 'held' }, { status: 'expired' });
      if (changed.modifiedCount) {
        const stock = await Stock.findByIdAndUpdate(r.stock, { $inc: { quantity: r.quantity } }, { new: true });
        if (stock) io.emit('inventory:updated', { stockId: stock._id, pharmacyId: stock.pharmacy, quantity: stock.quantity });
        io.to(`patient:${r.patient}`).emit('reservation:updated', { reservationId: r._id, status: 'expired' });
        io.to(`pharmacy:${r.pharmacy}`).emit('reservation:updated', { reservationId: r._id, status: 'expired' });
      }
    }
  } catch (e) {
    console.error('Expiry worker:', e.message);
  }
}, 60000);

await mongoose.connect(process.env.MONGO_URI);
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => console.log(`API + Socket.IO running on http://localhost:${PORT}`));
