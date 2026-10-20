import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { Patient, Pharmacy, Stock, Reservation, Branch, Staff, TransferRequest, ActivityLog } from './models/index.js';
import {
  ensureMainBranchForPharmacy,
  getOwnerBranches,
  createSecondaryBranch,
  updateOwnerBranch,
  createBranchStaff,
  getBranchStaff,
  authenticateStaff
} from './services/branchService.js';
import { resolveActorInfo, logActivity, getActivityLogs } from './services/activityLogService.js';
import axios from 'axios';

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

const auth = (roles = []) => async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (roles.length && !roles.includes(payload.role)) return res.status(403).json({ error: 'Access denied' });
    req.userId = payload.id;
    req.role = payload.role;

    if (payload.role === 'staff') {
      const staff = await Staff.findById(payload.id);
      if (!staff || !staff.isActive) {
        return res.status(403).json({ error: 'Staff account is inactive or not found' });
      }
      const branch = await Branch.findById(staff.branch);
      if (!branch || !branch.isActive) {
        return res.status(403).json({ error: 'Assigned branch is inactive or not found' });
      }
      req.staff = staff;
      req.branch = branch;
      req.branchId = staff.branch;
      req.pharmacyId = staff.pharmacy;
    } else if (payload.role === 'pharmacy') {
      req.pharmacyId = payload.id;
    }

    next();
  } catch {
    res.status(401).json({ error: 'Login required' });
  }
};

const cleanEmail = email => String(email || '').trim().toLowerCase();

// ---------- Socket.IO: authenticated, users only join their own room ----------
io.use(async (socket, next) => {
  try {
    const { id, role } = jwt.verify(socket.handshake.auth?.token || '', process.env.JWT_SECRET);
    socket.data.userId = id;
    socket.data.role = role;

    if (role === 'staff') {
      const staff = await Staff.findById(id);
      if (!staff || !staff.isActive) return next(new Error('Unauthorized'));
      const branch = await Branch.findById(staff.branch);
      if (!branch || !branch.isActive) return next(new Error('Unauthorized'));
      socket.data.branchId = String(staff.branch);
      socket.data.pharmacyId = String(staff.pharmacy);
    }

    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});
io.on('connection', socket => {
  socket.join(`${socket.data.role}:${socket.data.userId}`); // patient:<id>, pharmacy:<id>, or staff:<id>
  if (socket.data.role === 'staff' && socket.data.branchId) {
    socket.join(`branch:${socket.data.branchId}`);
  }
  if (socket.data.role === 'pharmacy') {
    socket.on('join:branch', async branchId => {
      if (mongoose.Types.ObjectId.isValid(branchId)) {
        const b = await Branch.findOne({ _id: branchId, pharmacy: socket.data.userId });
        if (b) socket.join(`branch:${branchId}`);
      }
    });
  }
});

// ---------- Helpers ----------
const emitInventory = stock => {
  if (!stock) return;
  const payload = {
    stockId: stock._id,
    pharmacyId: stock.pharmacy,
    branchId: stock.branch,
    quantity: stock.quantity
  };
  io.emit('inventory:updated', payload);
  if (stock.branch) {
    io.to(`branch:${stock.branch}`).emit('stock:updated', { stock });
  }
  if (stock.pharmacy) {
    io.to(`pharmacy:${stock.pharmacy}`).emit('stock:updated', { stock });
  }
};

// Give reserved units back to stock. Callers must only call this once per reservation,
// right after atomically moving it into cancelled/expired.
const releaseStock = async reservation => {
  const stockId = reservation.stock?._id || reservation.stock;
  const stock = await Stock.findByIdAndUpdate(stockId, { $inc: { quantity: reservation.quantity } }, { new: true });
  emitInventory(stock);
  return stock;
};

const notifyReservation = (reservation, status, medicine) => {
  const payload = {
    reservationId: reservation._id,
    status,
    medicine,
    branchId: reservation.branch,
    pharmacyId: reservation.pharmacy
  };
  io.to(`patient:${reservation.patient}`).emit('reservation:updated', payload);
  io.to(`pharmacy:${reservation.pharmacy}`).emit('reservation:updated', payload);
  if (reservation.branch) {
    io.to(`branch:${reservation.branch}`).emit('reservation:updated', payload);
  }
};

app.get('/api/health', (req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));

const geocodeAddress = async (address, role = 'pharmacy') => {
  const response = await axios.get('https://nominatim.openstreetmap.org/search', {
    params: {
      q: address,
      format: 'json',
      limit: 1
    },
    headers: {
      'User-Agent': 'PharmaTrack/1.0'
    }
  });

  if (!response.data?.length) {
    const roleLabel = role === 'patient' ? 'patient ' : role === 'pharmacy' ? 'pharmacy ' : '';
    throw new Error(`Could not find this address. Please enter a more complete ${roleLabel}address.`);
  }

  return {
    lat: Number(response.data[0].lat),
    lng: Number(response.data[0].lon)
  };
};

// ---------- Patient auth ----------
app.post('/api/auth/patient/register', wrap(async (req, res) => {
  const {
    name,
    email,
    password,
    phone,
    address,
    lat,
    lng,
    locationMode
  } = req.body;

  if (!name || !email || !password || !phone || !address || !String(address).trim()) {
    throw new Error('Name, email, phone, password and address are required');
  }

  if (String(password).length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  const exists = await Patient.findOne({ email: cleanEmail(email) });

  if (exists) {
    throw new Error('A patient account with this email already exists');
  }

  let latNum;
  let lngNum;
  const cleanAddress = String(address).trim();

  // Option 1: use browser's current location
  if (String(locationMode || '').trim().toLowerCase() === 'current') {
    if (
      lat === undefined ||
      lat === null ||
      String(lat).trim() === '' ||
      lng === undefined ||
      lng === null ||
      String(lng).trim() === ''
    ) {
      throw new Error('Could not get a valid current location');
    }

    latNum = Number(lat);
    lngNum = Number(lng);

    if (
      !Number.isFinite(latNum) ||
      !Number.isFinite(lngNum) ||
      latNum < -90 ||
      latNum > 90 ||
      lngNum < -180 ||
      lngNum > 180
    ) {
      throw new Error('Could not get a valid current location');
    }
  }

  // Option 2: find coordinates from the entered address
  else {
    const location = await geocodeAddress(cleanAddress, 'patient');
    latNum = Number(location.lat);
    lngNum = Number(location.lng);

    if (
      !Number.isFinite(latNum) ||
      !Number.isFinite(lngNum) ||
      latNum < -90 ||
      latNum > 90 ||
      lngNum < -180 ||
      lngNum > 180
    ) {
      throw new Error('Could not determine valid coordinates from the address');
    }
  }

  const patient = await Patient.create({
    name: String(name).trim(),
    email: cleanEmail(email),
    phone: String(phone).trim(),
    address: cleanAddress,
    password: await bcrypt.hash(password, 10),
    location: {
      type: 'Point',
      coordinates: [lngNum, latNum]
    }
  });

  res.status(201).json({
    token: makeToken(patient._id, 'patient'),
    role: 'patient',
    name: patient.name,
    id: patient._id
  });
}));

app.post('/api/auth/patient/login', wrap(async (req, res) => {
  const patient = await Patient.findOne({ email: cleanEmail(req.body.email) });
  if (!patient || !(await bcrypt.compare(req.body.password || '', patient.password))) throw httpError(401, 'Invalid email or password');
  res.json({ token: makeToken(patient._id, 'patient'), role: 'patient', name: patient.name, id: patient._id });
}));

// ---------- Pharmacy auth ----------
app.post('/api/auth/pharmacy/register', wrap(async (req, res) => {
  const {
    name,
    ownerName,
    email,
    password,
    phone,
    address,
    lat,
    lng,
    locationMode
  } = req.body;

  if (!name || !email || !password || !address || !String(address).trim()) {
    throw new Error('Pharmacy name, email, password and address are required');
  }

  if (String(password).length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  const exists = await Pharmacy.findOne({ email: cleanEmail(email) });

  if (exists) {
    throw new Error('A pharmacy account with this email already exists');
  }

  let latNum;
  let lngNum;
  const cleanAddress = String(address).trim();

  // Option 1: use browser's current location
  if (String(locationMode || '').trim().toLowerCase() === 'current') {
    if (
      lat === undefined ||
      lat === null ||
      String(lat).trim() === '' ||
      lng === undefined ||
      lng === null ||
      String(lng).trim() === ''
    ) {
      throw new Error('Could not get a valid current location');
    }

    latNum = Number(lat);
    lngNum = Number(lng);

    if (
      !Number.isFinite(latNum) ||
      !Number.isFinite(lngNum) ||
      latNum < -90 ||
      latNum > 90 ||
      lngNum < -180 ||
      lngNum > 180
    ) {
      throw new Error('Could not get a valid current location');
    }
  }

  // Option 2: find coordinates from the entered address
  else {
    const location = await geocodeAddress(cleanAddress);
    latNum = Number(location.lat);
    lngNum = Number(location.lng);

    if (
      !Number.isFinite(latNum) ||
      !Number.isFinite(lngNum) ||
      latNum < -90 ||
      latNum > 90 ||
      lngNum < -180 ||
      lngNum > 180
    ) {
      throw new Error('Could not determine valid coordinates from the address');
    }
  }

  const pharmacy = await Pharmacy.create({
    name: String(name).trim(),
    ownerName: ownerName ? String(ownerName).trim() : '',
    email: cleanEmail(email),
    phone: phone ? String(phone).trim() : '',
    address: cleanAddress,
    password: await bcrypt.hash(password, 10),
    location: {
      type: 'Point',
      coordinates: [lngNum, latNum]
    }
  });

  await ensureMainBranchForPharmacy(pharmacy);

  res.status(201).json({
    token: makeToken(pharmacy._id, 'pharmacy'),
    role: 'pharmacy',
    name: pharmacy.name,
    id: pharmacy._id
  });
}));

app.post('/api/auth/pharmacy/login', wrap(async (req, res) => {
  const pharmacy = await Pharmacy.findOne({ email: cleanEmail(req.body.email) });
  if (!pharmacy || !(await bcrypt.compare(req.body.password || '', pharmacy.password))) throw httpError(401, 'Invalid email or password');
  res.json({ token: makeToken(pharmacy._id, 'pharmacy'), role: 'pharmacy', name: pharmacy.name, id: pharmacy._id });
}));

// ---------- Staff auth ----------
app.post('/api/auth/staff/login', wrap(async (req, res) => {
  const { staff, branch } = await authenticateStaff(req.body);
  const token = jwt.sign(
    { id: staff._id, role: 'staff', branchId: staff.branch, pharmacyId: staff.pharmacy },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({
    token,
    role: 'staff',
    id: staff._id,
    name: staff.name,
    email: staff.email,
    pharmacy: {
      id: staff.pharmacy
    },
    branch: {
      id: branch._id,
      name: branch.name,
      address: branch.address,
      isMain: branch.isMain
    }
  });
}));

app.post('/api/auth/staff/register', wrap(async (req, res) => {
  throw httpError(403, 'Public staff registration is disabled. Staff accounts must be created by the pharmacy owner.');
}));

// ---------- Pharmacy inventory ----------
app.get('/api/pharmacy/stock', auth(['pharmacy', 'staff']), wrap(async (req, res) => {
  if (req.role === 'staff') {
    return res.json(await Stock.find({ branch: req.branchId }).sort('medicine'));
  }

  // Pharmacy owner
  if (req.query.branchId) {
    if (!mongoose.Types.ObjectId.isValid(req.query.branchId)) {
      throw httpError(400, 'Invalid branch ID');
    }
    const branch = await Branch.findOne({ _id: req.query.branchId, pharmacy: req.userId });
    if (!branch) {
      throw httpError(403, 'Access denied: You do not have permission to view stock for this branch');
    }
    return res.json(await Stock.find({ branch: branch._id }).sort('medicine'));
  }

  // Backward-compatible fallback: Main Branch stock
  let mainBranch = await Branch.findOne({ pharmacy: req.userId, isMain: true });
  if (!mainBranch) {
    const prov = await ensureMainBranchForPharmacy(req.userId);
    mainBranch = prov.branch;
  }
  const branchFilter = mainBranch
    ? { $or: [{ branch: mainBranch._id }, { branch: { $exists: false } }, { branch: null }] }
    : {};
  res.json(await Stock.find({ pharmacy: req.userId, ...branchFilter }).sort('medicine'));
}));

app.put('/api/pharmacy/stock', auth(['pharmacy', 'staff']), wrap(async (req, res) => {
  const { medicine, generic, quantity, price } = req.body;
  if (!medicine || !String(medicine).trim()) throw new Error('Medicine name is required');
  const qty = Math.floor(Number(quantity) || 0);
  if (qty < 0) throw new Error('Quantity cannot be negative');

  let targetPharmacyId;
  let targetBranchId;

  if (req.role === 'staff') {
    targetPharmacyId = req.pharmacyId;
    targetBranchId = req.branchId;
  } else {
    targetPharmacyId = req.userId;
    const requestedBranchId = req.body.branchId || req.query.branchId;
    if (requestedBranchId) {
      if (!mongoose.Types.ObjectId.isValid(requestedBranchId)) {
        throw httpError(400, 'Invalid branch ID');
      }
      const branch = await Branch.findOne({ _id: requestedBranchId, pharmacy: req.userId });
      if (!branch) {
        throw httpError(403, 'Access denied: You do not have permission to modify stock for this branch');
      }
      targetBranchId = branch._id;
    } else {
      let mainBranch = await Branch.findOne({ pharmacy: req.userId, isMain: true });
      if (!mainBranch) {
        const prov = await ensureMainBranchForPharmacy(req.userId);
        mainBranch = prov.branch;
      }
      if (!mainBranch) throw new Error('Could not resolve main branch for pharmacy');
      targetBranchId = mainBranch._id;
    }
  }

  const cleanMed = String(medicine).trim();
  const existingStock = await Stock.findOne({ branch: targetBranchId, medicine: cleanMed });

  const stock = await Stock.findOneAndUpdate(
    { branch: targetBranchId, medicine: cleanMed },
    {
      $set: {
        pharmacy: targetPharmacyId,
        branch: targetBranchId,
        generic: generic ? String(generic).trim() : '',
        quantity: qty,
        price: price === '' || price == null ? undefined : Number(price)
      }
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );

  emitInventory(stock);

  // Activity Audit Log
  const actor = await resolveActorInfo(req);
  let actionType = 'medicine_added';
  let description = `${actor.displayName} added ${cleanMed} (${qty} units) to branch inventory`;
  if (existingStock) {
    if (existingStock.quantity !== qty) {
      actionType = qty > existingStock.quantity ? 'stock_increased' : 'stock_decreased';
      description = `${actor.displayName} updated ${cleanMed} stock quantity from ${existingStock.quantity} to ${qty}`;
    } else {
      actionType = 'medicine_updated';
      description = `${actor.displayName} updated details for ${cleanMed}`;
    }
  }

  await logActivity({
    pharmacyId: targetPharmacyId,
    branchId: targetBranchId,
    actor,
    actionType,
    targetEntityType: 'Stock',
    targetEntityId: stock._id,
    description,
    details: {
      medicine: cleanMed,
      quantity: qty,
      before: existingStock
        ? { quantity: existingStock.quantity, price: existingStock.price, generic: existingStock.generic }
        : null,
      after: { quantity: qty, price: stock.price, generic: stock.generic }
    }
  });

  res.json(stock);
}));

app.delete('/api/pharmacy/stock/:id', auth(['pharmacy', 'staff']), wrap(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw httpError(400, 'Invalid stock ID');
  }

  let stock;
  if (req.role === 'staff') {
    stock = await Stock.findOneAndDelete({
      _id: req.params.id,
      branch: req.branchId
    });
  } else {
    stock = await Stock.findOneAndDelete({
      _id: req.params.id,
      pharmacy: req.userId
    });
  }

  if (!stock) {
    throw httpError(404, 'Medicine not found');
  }

  io.to(`pharmacy:${stock.pharmacy}`).emit('stock:deleted', {
    stockId: stock._id,
    branchId: stock.branch
  });
  if (stock.branch) {
    io.to(`branch:${stock.branch}`).emit('stock:deleted', {
      stockId: stock._id
    });
  }
  emitInventory({ ...stock.toObject(), quantity: 0 });

  const actor = await resolveActorInfo(req);
  await logActivity({
    pharmacyId: stock.pharmacy,
    branchId: stock.branch,
    actor,
    actionType: 'medicine_removed',
    targetEntityType: 'Stock',
    targetEntityId: stock._id,
    description: `${actor.displayName} removed ${stock.medicine} from branch inventory`,
    details: {
      medicine: stock.medicine,
      quantity: stock.quantity,
      before: { medicine: stock.medicine, quantity: stock.quantity, price: stock.price, generic: stock.generic },
      after: null
    }
  });

  res.json({
    ok: true,
    message: 'Medicine deleted successfully'
  });
}));
app.get('/api/pharmacy/profile', auth(['pharmacy', 'staff']), wrap(async (req, res) => {
  const pharmacyId = req.role === 'staff' ? req.pharmacyId : req.userId;
  const pharmacy = await Pharmacy.findById(pharmacyId).select('-password');

  if (!pharmacy) {
    throw httpError(404, 'Pharmacy not found');
  }

  res.json(pharmacy);
}));

app.get('/api/staff/profile', auth(['staff']), wrap(async (req, res) => {
  const staff = await Staff.findById(req.userId).select('-password');
  if (!staff) {
    throw httpError(404, 'Staff account not found');
  }

  const [pharmacy, branch] = await Promise.all([
    Pharmacy.findById(staff.pharmacy).select('name ownerName email phone address location'),
    Branch.findById(staff.branch).select('name address phone location isMain isActive')
  ]);

  res.json({
    staff: {
      id: staff._id,
      name: staff.name,
      email: staff.email,
      role: staff.role,
      isActive: staff.isActive,
      createdAt: staff.createdAt
    },
    branch,
    pharmacy: {
      id: pharmacy?._id,
      name: pharmacy?.name,
      ownerName: pharmacy?.ownerName,
      email: pharmacy?.email,
      phone: pharmacy?.phone,
      address: pharmacy?.address
    }
  });
}));
app.put('/api/pharmacy/profile', auth(['pharmacy']), wrap(async (req, res) => {
  const { address, location } = req.body;

  if (!address || !String(address).trim()) {
    throw new Error('Address is required');
  }

  const cleanAddress = String(address).trim();
  let lngNum;
  let latNum;

  if (
    location?.coordinates &&
    Array.isArray(location.coordinates) &&
    location.coordinates.length === 2 &&
    Number.isFinite(Number(location.coordinates[0])) &&
    Number.isFinite(Number(location.coordinates[1]))
  ) {
    lngNum = Number(location.coordinates[0]);
    latNum = Number(location.coordinates[1]);
  } else {
    // Convert the new address into new coordinates if none provided
    const geo = await geocodeAddress(cleanAddress);
    latNum = Number(geo.lat);
    lngNum = Number(geo.lng);
  }

  if (
    !Number.isFinite(latNum) ||
    !Number.isFinite(lngNum) ||
    latNum < -90 ||
    latNum > 90 ||
    lngNum < -180 ||
    lngNum > 180
  ) {
    throw new Error('Valid coordinates are required (latitude between -90 and 90, longitude between -180 and 180)');
  }

  const pharmacy = await Pharmacy.findByIdAndUpdate(
    req.userId,
    {
      address: cleanAddress,
      location: {
        type: 'Point',
        coordinates: [lngNum, latNum]
      }
    },
    {
      new: true,
      runValidators: true
    }
  ).select('-password');

  if (!pharmacy) {
    throw httpError(404, 'Pharmacy not found');
  }

  await Branch.updateOne(
    { pharmacy: req.userId, isMain: true },
    { address: cleanAddress, location: { type: 'Point', coordinates: [lngNum, latNum] } }
  );

  res.json(pharmacy);
}));
app.put('/api/pharmacy/profile/location', auth(['pharmacy']), wrap(async (req, res) => {
  const { address, location } = req.body;

  if (!address || !String(address).trim()) {
    throw new Error('Pharmacy address is required');
  }

  if (
    !location?.coordinates ||
    !Array.isArray(location.coordinates) ||
    location.coordinates.length !== 2
  ) {
    throw new Error('Valid pharmacy location coordinates are required');
  }

  const lngNum = Number(location.coordinates[0]);
  const latNum = Number(location.coordinates[1]);

  if (
    !Number.isFinite(latNum) ||
    !Number.isFinite(lngNum) ||
    latNum < -90 ||
    latNum > 90 ||
    lngNum < -180 ||
    lngNum > 180
  ) {
    throw new Error('Valid coordinates are required (latitude between -90 and 90, longitude between -180 and 180)');
  }

  const cleanAddress = String(address).trim();

  const pharmacy = await Pharmacy.findByIdAndUpdate(
    req.userId,
    {
      address: cleanAddress,
      location: {
        type: 'Point',
        coordinates: [lngNum, latNum]
      }
    },
    { new: true, runValidators: true }
  ).select('-password');

  if (!pharmacy) {
    throw httpError(404, 'Pharmacy not found');
  }

  await Branch.updateOne(
    { pharmacy: req.userId, isMain: true },
    { address: cleanAddress, location: { type: 'Point', coordinates: [lngNum, latNum] } }
  );

  res.json(pharmacy);
}));

const extractCoordinates = body => {
  if (body.location?.coordinates && Array.isArray(body.location.coordinates)) {
    return body.location.coordinates;
  }
  if (body.coordinates && Array.isArray(body.coordinates)) {
    return body.coordinates;
  }
  if (body.lng !== undefined && body.lat !== undefined) {
    return [Number(body.lng), Number(body.lat)];
  }
  if (body.longitude !== undefined && body.latitude !== undefined) {
    return [Number(body.longitude), Number(body.latitude)];
  }
  return undefined;
};

// ---------- Pharmacy Branch Management ----------
app.get('/api/pharmacy/branches', auth(['pharmacy', 'staff']), wrap(async (req, res) => {
  const pharmacyId = req.role === 'staff' ? req.pharmacyId : req.userId;
  const branches = await getOwnerBranches(pharmacyId);
  res.json(branches);
}));

app.post('/api/pharmacy/branches', auth(['pharmacy']), wrap(async (req, res) => {
  const coordinates = extractCoordinates(req.body);
  const branch = await createSecondaryBranch(req.userId, {
    name: req.body.name,
    address: req.body.address,
    phone: req.body.phone,
    coordinates
  });
  res.status(201).json(branch);
}));

app.put('/api/pharmacy/branches/:id', auth(['pharmacy']), wrap(async (req, res) => {
  const coordinates = extractCoordinates(req.body);
  const branch = await updateOwnerBranch(req.userId, req.params.id, {
    name: req.body.name,
    address: req.body.address,
    phone: req.body.phone,
    coordinates,
    isActive: req.body.isActive
  });
  res.json(branch);
}));

app.post('/api/pharmacy/branches/:id/staff', auth(['pharmacy']), wrap(async (req, res) => {
  const staff = await createBranchStaff(req.userId, req.params.id, {
    name: req.body.name,
    email: req.body.email,
    password: req.body.password
  });
  res.status(201).json(staff);
}));

app.get('/api/pharmacy/branches/:id/staff', auth(['pharmacy']), wrap(async (req, res) => {
  const staffList = await getBranchStaff(req.userId, req.params.id);
  res.json(staffList);
}));

app.patch('/api/pharmacy/branches/:id/staff/:staffId/status', auth(['pharmacy']), wrap(async (req, res) => {
  const { id: branchId, staffId } = req.params;
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    throw httpError(400, 'isActive boolean status is required');
  }

  const branch = await Branch.findOne({ _id: branchId, pharmacy: req.userId });
  if (!branch) {
    throw httpError(403, 'Access denied: Branch does not belong to your pharmacy');
  }

  const staff = await Staff.findOneAndUpdate(
    { _id: staffId, branch: branch._id, pharmacy: req.userId },
    { isActive },
    { new: true }
  ).select('-password');

  if (!staff) {
    throw httpError(404, 'Staff member not found for this branch');
  }

  res.json(staff);
}));

// ---------- Inter-Branch Stock Transfers (Task 8) ----------

// 1. Search medicine availability across other branches of the same pharmacy
app.get('/api/pharmacy/transfers/available-stock', auth(['pharmacy', 'staff']), wrap(async (req, res) => {
  let requestingBranchId;
  if (req.role === 'staff') {
    requestingBranchId = req.branchId;
  } else {
    if (req.query.toBranchId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.toBranchId)) {
        throw httpError(400, 'Invalid destination branch ID');
      }
      const b = await Branch.findOne({ _id: req.query.toBranchId, pharmacy: req.pharmacyId });
      if (!b) throw httpError(403, 'Access denied to destination branch');
      requestingBranchId = b._id;
    }
  }

  // Find other active branches of the SAME pharmacy
  const branchFilter = {
    pharmacy: req.pharmacyId,
    isActive: { $ne: false }
  };
  if (requestingBranchId) {
    branchFilter._id = { $ne: requestingBranchId };
  }

  const candidateBranches = await Branch.find(branchFilter).select('_id name address phone isMain');
  if (!candidateBranches.length) {
    return res.json([]);
  }

  const candidateBranchIds = candidateBranches.map(b => b._id);
  const stockFilter = {
    branch: { $in: candidateBranchIds },
    quantity: { $gt: 0 }
  };

  const q = String(req.query.medicine || req.query.q || '').trim();
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    stockFilter.$or = [{ medicine: rx }, { generic: rx }];
  }

  const stockList = await Stock.find(stockFilter)
    .populate('branch', 'name address phone isMain')
    .sort('medicine')
    .limit(100);

  const results = stockList.map(s => ({
    stockId: s._id,
    medicine: s.medicine,
    generic: s.generic,
    availableQuantity: s.quantity,
    price: s.price,
    branch: s.branch
  }));

  res.json(results);
}));

// 2. Create Transfer Request
app.post('/api/pharmacy/transfers', auth(['pharmacy', 'staff']), wrap(async (req, res) => {
  const { fromBranch, toBranch, medicine, requestedQuantity, quantity } = req.body;

  if (!medicine || !String(medicine).trim()) {
    throw httpError(400, 'Medicine name is required');
  }
  const cleanMed = String(medicine).trim();

  const qty = Number(requestedQuantity !== undefined ? requestedQuantity : quantity);
  if (!Number.isInteger(qty) || qty < 1) {
    throw httpError(400, 'Requested quantity must be a positive integer');
  }

  if (!fromBranch || !mongoose.Types.ObjectId.isValid(fromBranch)) {
    throw httpError(400, 'Valid supplying branch ID is required');
  }

  let destBranchId;
  if (req.role === 'staff') {
    if (String(fromBranch) === String(req.branchId) && toBranch && mongoose.Types.ObjectId.isValid(toBranch)) {
      destBranchId = toBranch;
    } else {
      destBranchId = req.branchId;
    }
  } else {
    if (!toBranch || !mongoose.Types.ObjectId.isValid(toBranch)) {
      throw httpError(400, 'Valid destination branch ID is required');
    }
    destBranchId = toBranch;
  }

  if (String(fromBranch) === String(destBranchId)) {
    throw httpError(400, 'Supplying and destination branches cannot be the same');
  }

  // Validate both branches belong to the authenticated pharmacy business and are active
  const [supplyingBranch, destinationBranch] = await Promise.all([
    Branch.findOne({ _id: fromBranch, pharmacy: req.pharmacyId }),
    Branch.findOne({ _id: destBranchId, pharmacy: req.pharmacyId })
  ]);

  if (!supplyingBranch) {
    throw httpError(403, 'Supplying branch does not belong to your pharmacy');
  }
  if (!destinationBranch) {
    throw httpError(403, 'Destination branch does not belong to your pharmacy');
  }
  if (!supplyingBranch.isActive) {
    throw httpError(400, 'Supplying branch is currently inactive');
  }
  if (!destinationBranch.isActive) {
    throw httpError(400, 'Destination branch is currently inactive');
  }

  // Verify supplying branch has the requested medicine with sufficient stock
  const stock = await Stock.findOne({
    branch: supplyingBranch._id,
    medicine: new RegExp(`^${cleanMed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
  });

  if (!stock || stock.quantity < 1) {
    throw httpError(400, `Medicine "${cleanMed}" is not available in ${supplyingBranch.name}`);
  }

  if (qty > stock.quantity) {
    throw httpError(400, `Requested quantity (${qty}) exceeds available stock (${stock.quantity}) at ${supplyingBranch.name}`);
  }

  // Resolve user identity
  let requestedBy;
  if (req.role === 'staff') {
    requestedBy = {
      userId: req.userId,
      role: 'staff',
      name: req.staff.name
    };
  } else {
    const pharmacy = await Pharmacy.findById(req.userId).select('name');
    requestedBy = {
      userId: req.userId,
      role: 'pharmacy',
      name: pharmacy?.name || 'Pharmacy Owner'
    };
  }

  // Direct Transfer support (e.g. initiated directly from Medicine Inventory)
  if (req.body.directTransfer === true) {
    const updatedFromStock = await Stock.findOneAndUpdate(
      { _id: stock._id, quantity: { $gte: qty } },
      { $inc: { quantity: -qty } },
      { new: true }
    );
    if (!updatedFromStock) {
      throw httpError(400, `Insufficient stock (${stock.quantity}) at supplying branch to transfer ${qty} units`);
    }

    const rx = new RegExp(`^${cleanMed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    let destStock = await Stock.findOne({ branch: destinationBranch._id, medicine: rx });
    if (destStock) {
      destStock = await Stock.findByIdAndUpdate(
        destStock._id,
        { $inc: { quantity: qty } },
        { new: true }
      );
    } else {
      destStock = await Stock.create({
        pharmacy: req.pharmacyId,
        branch: destinationBranch._id,
        medicine: stock.medicine,
        generic: stock.generic || '',
        price: stock.price || 0,
        quantity: qty
      });
    }

    const transfer = await TransferRequest.create({
      pharmacy: req.pharmacyId,
      fromBranch: supplyingBranch._id,
      toBranch: destinationBranch._id,
      medicine: stock.medicine,
      requestedQuantity: qty,
      dispatchedQuantity: qty,
      status: 'received',
      requestedBy,
      reviewedBy: {
        userId: req.userId,
        role: req.role,
        name: requestedBy.name,
        reviewedAt: new Date()
      },
      dispatchedBy: {
        userId: req.userId,
        role: req.role,
        name: requestedBy.name,
        dispatchedAt: new Date()
      },
      receivedBy: {
        userId: req.userId,
        role: req.role,
        name: requestedBy.name,
        receivedAt: new Date()
      }
    });

    const populatedTransfer = await TransferRequest.findById(transfer._id)
      .populate('fromBranch', 'name address phone isMain')
      .populate('toBranch', 'name address phone isMain');

    // Real-time Socket.IO inventory & transfer events
    emitInventory(updatedFromStock);
    emitInventory(destStock);
    io.to(`pharmacy:${req.pharmacyId}`).emit('transfer:new', populatedTransfer);
    io.to(`pharmacy:${req.pharmacyId}`).emit('transfer:updated', populatedTransfer);
    io.to(`branch:${supplyingBranch._id}`).emit('transfer:updated', populatedTransfer);
    io.to(`branch:${destinationBranch._id}`).emit('transfer:updated', populatedTransfer);

    const actor = await resolveActorInfo(req);
    await logActivity({
      pharmacyId: req.pharmacyId,
      branchId: destinationBranch._id,
      actor,
      actionType: 'transfer_received',
      targetEntityType: 'TransferRequest',
      targetEntityId: transfer._id,
      description: `Transfer of ${qty} unit(s) of "${stock.medicine}" completed from ${supplyingBranch.name} to ${destinationBranch.name} by ${actor.displayName} (${actor.actorType})`,
      details: {
        medicine: stock.medicine,
        requestedQuantity: qty,
        dispatchedQuantity: qty,
        quantity: qty,
        supplyingBranch: supplyingBranch._id,
        receivingBranch: destinationBranch._id,
        supplyingBranchName: supplyingBranch.name,
        receivingBranchName: destinationBranch.name,
        status: 'received',
        after: { status: 'received', requestedQuantity: qty, dispatchedQuantity: qty }
      }
    });

    const transferObj = populatedTransfer.toObject ? populatedTransfer.toObject() : populatedTransfer;
    transferObj.result = {
      medicineName: stock.medicine,
      quantity: qty,
      sourceBranch: supplyingBranch.name,
      destinationBranch: destinationBranch.name,
      status: 'Completed (Received)'
    };
    transferObj.success = true;

    return res.status(201).json(transferObj);
  }

  const transfer = await TransferRequest.create({
    pharmacy: req.pharmacyId,
    fromBranch: supplyingBranch._id,
    toBranch: destinationBranch._id,
    medicine: stock.medicine,
    requestedQuantity: qty,
    notes: req.body.notes ? String(req.body.notes).trim() : undefined,
    status: 'pending',
    requestedBy
  });

  const populatedTransfer = await TransferRequest.findById(transfer._id)
    .populate('fromBranch', 'name address phone isMain')
    .populate('toBranch', 'name address phone isMain');

  // Emit real-time notification to owner and the two involved branches
  io.to(`pharmacy:${req.pharmacyId}`).emit('transfer:new', populatedTransfer);
  io.to(`branch:${supplyingBranch._id}`).emit('transfer:new', populatedTransfer);
  io.to(`branch:${destinationBranch._id}`).emit('transfer:new', populatedTransfer);

  const actor = await resolveActorInfo(req);
  await logActivity({
    pharmacyId: req.pharmacyId,
    branchId: destinationBranch._id,
    actor,
    actionType: 'transfer_requested',
    targetEntityType: 'TransferRequest',
    targetEntityId: transfer._id,
    description: `Transfer of ${qty} unit(s) of "${stock.medicine}" requested from ${supplyingBranch.name} to ${destinationBranch.name} by ${actor.displayName} (${actor.actorType})`,
    details: {
      medicine: stock.medicine,
      requestedQuantity: qty,
      quantity: qty,
      supplyingBranch: supplyingBranch._id,
      receivingBranch: destinationBranch._id,
      supplyingBranchName: supplyingBranch.name,
      receivingBranchName: destinationBranch.name,
      status: 'pending',
      after: { status: 'pending', requestedQuantity: qty }
    }
  });

  res.status(201).json(populatedTransfer);
}));

// 3. List Transfer Requests
app.get('/api/pharmacy/transfers', auth(['pharmacy', 'staff']), wrap(async (req, res) => {
  const filter = { pharmacy: req.pharmacyId };

  if (req.role === 'staff') {
    filter.$or = [{ fromBranch: req.branchId }, { toBranch: req.branchId }];
  } else {
    if (req.query.branchId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.branchId)) {
        throw httpError(400, 'Invalid branch ID');
      }
      const b = await Branch.findOne({ _id: req.query.branchId, pharmacy: req.pharmacyId });
      if (!b) throw httpError(403, 'Access denied to branch');
      filter.$or = [{ fromBranch: b._id }, { toBranch: b._id }];
    }
  }

  if (req.query.status) {
    const validStatuses = ['pending', 'approved', 'rejected', 'dispatched', 'received', 'cancelled'];
    if (validStatuses.includes(req.query.status)) {
      filter.status = req.query.status;
    }
  }

  const transfers = await TransferRequest.find(filter)
    .populate('fromBranch', 'name address phone isMain')
    .populate('toBranch', 'name address phone isMain')
    .sort('-createdAt')
    .limit(100);

  res.json(transfers);
}));

// Helper for Task 9 transfer actions
const checkTransactionSupport = async () => {
  try {
    const admin = mongoose.connection.db.admin();
    const status = await admin.serverStatus();
    return Boolean(status.repl && status.repl.setName);
  } catch {
    return false;
  }
};

const executeTransferAction = async (req, transferId, action, extra = {}) => {
  if (!mongoose.Types.ObjectId.isValid(transferId)) {
    throw httpError(400, 'Invalid transfer ID');
  }

  const transfer = await TransferRequest.findById(transferId);
  if (!transfer) {
    throw httpError(404, 'Transfer request not found');
  }

  // Cross-pharmacy business guard
  if (String(transfer.pharmacy) !== String(req.pharmacyId)) {
    throw httpError(403, 'Transfer does not belong to your pharmacy');
  }

  // Resolve actor identity
  const actor = await resolveActorInfo(req);
  const actorName = actor.displayName;

  const [supplyingBranchDoc, receivingBranchDoc] = await Promise.all([
    Branch.findById(transfer.fromBranch).select('name'),
    Branch.findById(transfer.toBranch).select('name')
  ]);
  const supplyingBranchName = supplyingBranchDoc?.name || 'Supplying Branch';
  const receivingBranchName = receivingBranchDoc?.name || 'Receiving Branch';

  const isOwner = req.role === 'pharmacy';
  const isSupplyingStaff = req.role === 'staff' && String(transfer.fromBranch) === String(req.branchId);
  const isReceivingStaff = req.role === 'staff' && String(transfer.toBranch) === String(req.branchId);

  const supportsTransactions = await checkTransactionSupport();
  const cleanAction = String(action || '').toLowerCase().trim();

  if (cleanAction === 'approve') {
    if (transfer.status !== 'pending') {
      throw httpError(400, `Cannot approve transfer in '${transfer.status}' status`);
    }
    if (!isOwner && !isSupplyingStaff) {
      throw httpError(403, 'Only supplying branch staff or pharmacy owner can approve this transfer');
    }

    const rx = new RegExp(`^${transfer.medicine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const qty = transfer.requestedQuantity;

    if (supportsTransactions) {
      const session = await mongoose.startSession();
      try {
        session.startTransaction();

        // 1. Lock and update TransferRequest status atomically from pending -> completed
        const updatedTransfer = await TransferRequest.findOneAndUpdate(
          { _id: transfer._id, status: 'pending' },
          {
            status: 'completed',
            reviewedBy: {
              userId: req.userId,
              role: req.role,
              name: actorName,
              reviewedAt: new Date()
            },
            dispatchedQuantity: qty,
            dispatchedBy: {
              userId: req.userId,
              role: req.role,
              name: actorName,
              dispatchedAt: new Date()
            },
            receivedBy: {
              userId: req.userId,
              role: req.role,
              name: actorName,
              receivedAt: new Date()
            }
          },
          { session, new: true }
        );
        if (!updatedTransfer) {
          throw httpError(409, 'Transfer request was already processed or status changed');
        }

        // 2. Decrement supplying branch stock atomically
        const sourceStock = await Stock.findOneAndUpdate(
          {
            branch: transfer.fromBranch,
            medicine: rx,
            quantity: { $gte: qty }
          },
          { $inc: { quantity: -qty } },
          { session, new: true }
        );
        if (!sourceStock) {
          throw httpError(400, `Insufficient stock at supplying branch to fulfill transfer of ${qty} units`);
        }

        // 3. Increment or create receiving branch stock
        let destStock = await Stock.findOne({ branch: transfer.toBranch, medicine: rx }).session(session);
        if (destStock) {
          destStock = await Stock.findOneAndUpdate(
            { _id: destStock._id },
            { $inc: { quantity: qty } },
            { session, new: true }
          );
        } else {
          const created = await Stock.create([
            {
              pharmacy: transfer.pharmacy,
              branch: transfer.toBranch,
              medicine: transfer.medicine,
              generic: sourceStock?.generic || '',
              price: sourceStock?.price || 0,
              quantity: qty
            }
          ], { session });
          destStock = created[0];
        }

        await logActivity({
          pharmacyId: transfer.pharmacy,
          branchId: transfer.fromBranch,
          actor,
          actionType: 'transfer_approved',
          targetEntityType: 'TransferRequest',
          targetEntityId: transfer._id,
          description: `Transfer of ${qty} unit(s) of "${transfer.medicine}" approved and fulfilled from ${supplyingBranchName} to ${receivingBranchName} by ${actor.displayName} (${actor.actorType})`,
          details: {
            medicine: transfer.medicine,
            requestedQuantity: qty,
            quantity: qty,
            supplyingBranch: transfer.fromBranch,
            receivingBranch: transfer.toBranch,
            supplyingBranchName,
            receivingBranchName,
            status: 'completed',
            before: { status: 'pending' },
            after: { status: 'completed' }
          },
          session
        });

        await session.commitTransaction();
        emitInventory(sourceStock);
        emitInventory(destStock);
      } catch (err) {
        await session.abortTransaction().catch(() => {});
        throw err;
      } finally {
        await session.endSession().catch(() => {});
      }
    } else {
      // Standalone execution: Atomic CAS update on transfer status, then atomic stock movement with rollback guard
      const lockedTransfer = await TransferRequest.findOneAndUpdate(
        { _id: transfer._id, status: 'pending' },
        {
          status: 'completed',
          reviewedBy: {
            userId: req.userId,
            role: req.role,
            name: actorName,
            reviewedAt: new Date()
          },
          dispatchedQuantity: qty,
          dispatchedBy: {
            userId: req.userId,
            role: req.role,
            name: actorName,
            dispatchedAt: new Date()
          },
          receivedBy: {
            userId: req.userId,
            role: req.role,
            name: actorName,
            receivedAt: new Date()
          }
        },
        { new: true }
      );
      if (!lockedTransfer) {
        throw httpError(409, 'Transfer request was already processed or status changed');
      }

      // Decrement source stock atomically
      const sourceStock = await Stock.findOneAndUpdate(
        {
          branch: transfer.fromBranch,
          medicine: rx,
          quantity: { $gte: qty }
        },
        { $inc: { quantity: -qty } },
        { new: true }
      );

      if (!sourceStock) {
        // Rollback transfer status back to 'pending'
        await TransferRequest.findByIdAndUpdate(transfer._id, {
          status: 'pending',
          $unset: { reviewedBy: 1, dispatchedBy: 1, receivedBy: 1, dispatchedQuantity: 1 }
        });
        const curr = await Stock.findOne({ branch: transfer.fromBranch, medicine: rx });
        throw httpError(400, `Insufficient stock (${curr ? curr.quantity : 0}) at supplying branch to approve transfer of ${qty} units`);
      }

      // Increment destination stock
      try {
        let destStock = await Stock.findOne({ branch: transfer.toBranch, medicine: rx });
        if (destStock) {
          destStock = await Stock.findOneAndUpdate(
            { _id: destStock._id },
            { $inc: { quantity: qty } },
            { new: true }
          );
        } else {
          try {
            destStock = await Stock.create({
              pharmacy: transfer.pharmacy,
              branch: transfer.toBranch,
              medicine: transfer.medicine,
              generic: sourceStock?.generic || '',
              price: sourceStock?.price || 0,
              quantity: qty
            });
          } catch (createErr) {
            if (createErr.code === 11000) {
              destStock = await Stock.findOneAndUpdate(
                { branch: transfer.toBranch, medicine: rx },
                { $inc: { quantity: qty } },
                { new: true }
              );
            } else {
              throw createErr;
            }
          }
        }

        await logActivity({
          pharmacyId: transfer.pharmacy,
          branchId: transfer.fromBranch,
          actor,
          actionType: 'transfer_approved',
          targetEntityType: 'TransferRequest',
          targetEntityId: transfer._id,
          description: `Transfer of ${qty} unit(s) of "${transfer.medicine}" approved and fulfilled from ${supplyingBranchName} to ${receivingBranchName} by ${actor.displayName} (${actor.actorType})`,
          details: {
            medicine: transfer.medicine,
            requestedQuantity: qty,
            quantity: qty,
            supplyingBranch: transfer.fromBranch,
            receivingBranch: transfer.toBranch,
            supplyingBranchName,
            receivingBranchName,
            status: 'completed',
            before: { status: 'pending' },
            after: { status: 'completed' }
          }
        });

        emitInventory(sourceStock);
        emitInventory(destStock);
      } catch (destErr) {
        // Rollback source stock decrement and transfer status
        await Stock.findOneAndUpdate({ _id: sourceStock._id }, { $inc: { quantity: qty } });
        await TransferRequest.findByIdAndUpdate(transfer._id, {
          status: 'pending',
          $unset: { reviewedBy: 1, dispatchedBy: 1, receivedBy: 1, dispatchedQuantity: 1 }
        });
        throw destErr;
      }
    }
  } else if (cleanAction === 'reject') {
    if (transfer.status !== 'pending') {
      throw httpError(400, `Cannot reject transfer in '${transfer.status}' status`);
    }
    if (!isOwner && !isSupplyingStaff) {
      throw httpError(403, 'Only supplying branch staff or pharmacy owner can reject this transfer');
    }

    const updated = await TransferRequest.findOneAndUpdate(
      { _id: transfer._id, status: 'pending' },
      {
        status: 'rejected',
        reviewedBy: {
          userId: req.userId,
          role: req.role,
          name: actorName,
          reviewedAt: new Date()
        },
        rejectedBy: {
          userId: req.userId,
          role: req.role,
          name: actorName,
          rejectedAt: new Date(),
          reason: String(extra.reason || '').trim()
        }
      },
      { new: true }
    );
    if (!updated) {
      throw httpError(409, 'Transfer status was modified by another operation');
    }

    await logActivity({
      pharmacyId: transfer.pharmacy,
      branchId: transfer.fromBranch,
      actor,
      actionType: 'transfer_rejected',
      targetEntityType: 'TransferRequest',
      targetEntityId: transfer._id,
      description: `Transfer of ${transfer.requestedQuantity} unit(s) of "${transfer.medicine}" rejected by ${actor.displayName} (${actor.actorType})${extra.reason ? ': ' + extra.reason : ''}`,
      details: {
        medicine: transfer.medicine,
        requestedQuantity: transfer.requestedQuantity,
        quantity: transfer.requestedQuantity,
        supplyingBranch: transfer.fromBranch,
        receivingBranch: transfer.toBranch,
        supplyingBranchName,
        receivingBranchName,
        status: 'rejected',
        reason: String(extra.reason || '').trim(),
        before: { status: 'pending' },
        after: { status: 'rejected' }
      }
    });
  } else if (cleanAction === 'cancel') {
    if (!['pending', 'approved'].includes(transfer.status)) {
      throw httpError(400, `Cannot cancel transfer in '${transfer.status}' status`);
    }

    const isRequesterUser = req.role === 'staff' && String(transfer.requestedBy?.userId) === String(req.userId);
    if (!isOwner && !isRequesterUser && !isReceivingStaff) {
      throw httpError(403, 'Only the requesting party or pharmacy owner can cancel this transfer');
    }

    const updated = await TransferRequest.findOneAndUpdate(
      { _id: transfer._id, status: { $in: ['pending', 'approved'] } },
      {
        status: 'cancelled',
        cancelledBy: {
          userId: req.userId,
          role: req.role,
          name: actorName,
          cancelledAt: new Date(),
          reason: String(extra.reason || '').trim()
        }
      },
      { new: true }
    );
    if (!updated) {
      throw httpError(409, 'Transfer status was modified or already dispatched');
    }

    await logActivity({
      pharmacyId: transfer.pharmacy,
      branchId: transfer.toBranch,
      actor,
      actionType: 'transfer_cancelled',
      targetEntityType: 'TransferRequest',
      targetEntityId: transfer._id,
      description: `Transfer of ${transfer.requestedQuantity} unit(s) of "${transfer.medicine}" cancelled by ${actor.displayName} (${actor.actorType})${extra.reason ? ': ' + extra.reason : ''}`,
      details: {
        medicine: transfer.medicine,
        requestedQuantity: transfer.requestedQuantity,
        quantity: transfer.requestedQuantity,
        supplyingBranch: transfer.fromBranch,
        receivingBranch: transfer.toBranch,
        supplyingBranchName,
        receivingBranchName,
        status: 'cancelled',
        reason: String(extra.reason || '').trim(),
        before: { status: transfer.status },
        after: { status: 'cancelled' }
      }
    });
  } else if (cleanAction === 'dispatch') {
    if (transfer.status === 'pending') {
      throw httpError(400, 'Transfer must be approved before dispatch');
    }
    if (transfer.status !== 'approved') {
      throw httpError(400, `Cannot dispatch transfer in '${transfer.status}' status`);
    }
    if (!isOwner && !isSupplyingStaff) {
      throw httpError(403, 'Only supplying branch staff or pharmacy owner can dispatch this transfer');
    }

    const rx = new RegExp(`^${transfer.medicine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const qty = transfer.requestedQuantity;

    if (supportsTransactions) {
      const session = await mongoose.startSession();
      try {
        session.startTransaction();
        const updatedTransfer = await TransferRequest.findOneAndUpdate(
          { _id: transfer._id, status: 'approved' },
          {
            status: 'dispatched',
            dispatchedQuantity: qty,
            dispatchedBy: {
              userId: req.userId,
              role: req.role,
              name: actorName,
              dispatchedAt: new Date()
            }
          },
          { session, new: true }
        );
        if (!updatedTransfer) {
          throw httpError(409, 'Transfer was already dispatched or status changed');
        }

        const updatedStock = await Stock.findOneAndUpdate(
          {
            branch: transfer.fromBranch,
            medicine: rx,
            quantity: { $gte: qty }
          },
          { $inc: { quantity: -qty } },
          { session, new: true }
        );
        if (!updatedStock) {
          throw httpError(400, `Insufficient stock at supplying branch to dispatch transfer of ${qty} units`);
        }
        await logActivity({
          pharmacyId: transfer.pharmacy,
          branchId: transfer.fromBranch,
          actor,
          actionType: 'transfer_dispatched',
          targetEntityType: 'TransferRequest',
          targetEntityId: transfer._id,
          description: `Transfer dispatched: ${qty} unit(s) of "${transfer.medicine}" dispatched from ${supplyingBranchName} by ${actor.displayName} (${actor.actorType})`,
          details: {
            medicine: transfer.medicine,
            requestedQuantity: transfer.requestedQuantity,
            dispatchedQuantity: qty,
            quantity: qty,
            supplyingBranch: transfer.fromBranch,
            receivingBranch: transfer.toBranch,
            supplyingBranchName,
            receivingBranchName,
            status: 'dispatched',
            before: { status: 'approved' },
            after: { status: 'dispatched', dispatchedQuantity: qty }
          },
          session
        });
        await session.commitTransaction();
        emitInventory(updatedStock);
      } catch (err) {
        await session.abortTransaction().catch(() => {});
        throw err;
      } finally {
        await session.endSession().catch(() => {});
      }
    } else {
      // Standalone execution: Atomic CAS update on transfer status, then atomic deduction with automatic rollback
      const lockedTransfer = await TransferRequest.findOneAndUpdate(
        { _id: transfer._id, status: 'approved' },
        {
          status: 'dispatched',
          dispatchedQuantity: qty,
          dispatchedBy: {
            userId: req.userId,
            role: req.role,
            name: actorName,
            dispatchedAt: new Date()
          }
        },
        { new: true }
      );
      if (!lockedTransfer) {
        throw httpError(409, 'Transfer was already dispatched or status changed');
      }

      const updatedStock = await Stock.findOneAndUpdate(
        {
          branch: transfer.fromBranch,
          medicine: rx,
          quantity: { $gte: qty }
        },
        { $inc: { quantity: -qty } },
        { new: true }
      );

      if (!updatedStock) {
        // Rollback transfer status back to 'approved'
        await TransferRequest.findByIdAndUpdate(transfer._id, {
          status: 'approved',
          $unset: { dispatchedBy: 1, dispatchedQuantity: 1 }
        });
        const curr = await Stock.findOne({ branch: transfer.fromBranch, medicine: rx });
        throw httpError(400, `Insufficient stock (${curr ? curr.quantity : 0}) at supplying branch to dispatch transfer of ${qty} units`);
      }

      await logActivity({
        pharmacyId: transfer.pharmacy,
        branchId: transfer.fromBranch,
        actor,
        actionType: 'transfer_dispatched',
        targetEntityType: 'TransferRequest',
        targetEntityId: transfer._id,
        description: `Transfer dispatched: ${qty} unit(s) of "${transfer.medicine}" dispatched from ${supplyingBranchName} by ${actor.displayName} (${actor.actorType})`,
        details: {
          medicine: transfer.medicine,
          requestedQuantity: transfer.requestedQuantity,
          dispatchedQuantity: qty,
          quantity: qty,
          supplyingBranch: transfer.fromBranch,
          receivingBranch: transfer.toBranch,
          supplyingBranchName,
          receivingBranchName,
          status: 'dispatched',
          before: { status: 'approved' },
          after: { status: 'dispatched', dispatchedQuantity: qty }
        }
      });
      emitInventory(updatedStock);
    }
  } else if (cleanAction === 'receive') {
    if (['pending', 'approved'].includes(transfer.status)) {
      throw httpError(400, 'Transfer must be dispatched before receiving');
    }
    if (transfer.status !== 'dispatched') {
      throw httpError(400, `Cannot receive transfer in '${transfer.status}' status`);
    }
    if (!isOwner && !isReceivingStaff) {
      throw httpError(403, 'Only destination branch staff or pharmacy owner can confirm receipt of this transfer');
    }

    const rx = new RegExp(`^${transfer.medicine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const qty = transfer.dispatchedQuantity || transfer.requestedQuantity;

    if (supportsTransactions) {
      const session = await mongoose.startSession();
      try {
        session.startTransaction();
        const updatedTransfer = await TransferRequest.findOneAndUpdate(
          { _id: transfer._id, status: 'dispatched' },
          {
            status: 'received',
            receivedBy: {
              userId: req.userId,
              role: req.role,
              name: actorName,
              receivedAt: new Date()
            }
          },
          { session, new: true }
        );
        if (!updatedTransfer) {
          throw httpError(409, 'Transfer was already received or status changed');
        }

        let destStock = await Stock.findOne({ branch: transfer.toBranch, medicine: rx }).session(session);
        if (destStock) {
          destStock = await Stock.findOneAndUpdate(
            { _id: destStock._id },
            { $inc: { quantity: qty } },
            { session, new: true }
          );
        } else {
          const sourceStock = await Stock.findOne({ branch: transfer.fromBranch, medicine: rx }).session(session);
          const created = await Stock.create([
            {
              pharmacy: transfer.pharmacy,
              branch: transfer.toBranch,
              medicine: transfer.medicine,
              generic: sourceStock?.generic || '',
              price: sourceStock?.price || 0,
              quantity: qty
            }
          ], { session });
          destStock = created[0];
        }
        await logActivity({
          pharmacyId: transfer.pharmacy,
          branchId: transfer.toBranch,
          actor,
          actionType: 'transfer_received',
          targetEntityType: 'TransferRequest',
          targetEntityId: transfer._id,
          description: `Transfer received: ${qty} unit(s) of "${transfer.medicine}" received at ${receivingBranchName} by ${actor.displayName} (${actor.actorType})`,
          details: {
            medicine: transfer.medicine,
            requestedQuantity: transfer.requestedQuantity,
            dispatchedQuantity: qty,
            quantity: qty,
            supplyingBranch: transfer.fromBranch,
            receivingBranch: transfer.toBranch,
            supplyingBranchName,
            receivingBranchName,
            status: 'received',
            before: { status: 'dispatched' },
            after: { status: 'received' }
          },
          session
        });
        await session.commitTransaction();
        emitInventory(destStock);
      } catch (err) {
        await session.abortTransaction().catch(() => {});
        throw err;
      } finally {
        await session.endSession().catch(() => {});
      }
    } else {
      // Standalone execution: Atomic CAS update on transfer status, then add stock with rollback guard
      const lockedTransfer = await TransferRequest.findOneAndUpdate(
        { _id: transfer._id, status: 'dispatched' },
        {
          status: 'received',
          receivedBy: {
            userId: req.userId,
            role: req.role,
            name: actorName,
            receivedAt: new Date()
          }
        },
        { new: true }
      );
      if (!lockedTransfer) {
        throw httpError(409, 'Transfer was already received or status changed');
      }

      let destStock = await Stock.findOne({ branch: transfer.toBranch, medicine: rx });
      try {
        if (destStock) {
          destStock = await Stock.findOneAndUpdate(
            { _id: destStock._id },
            { $inc: { quantity: qty } },
            { new: true }
          );
        } else {
          const sourceStock = await Stock.findOne({ branch: transfer.fromBranch, medicine: rx });
          try {
            destStock = await Stock.create({
              pharmacy: transfer.pharmacy,
              branch: transfer.toBranch,
              medicine: transfer.medicine,
              generic: sourceStock?.generic || '',
              price: sourceStock?.price || 0,
              quantity: qty
            });
          } catch (createErr) {
            if (createErr.code === 11000) {
              destStock = await Stock.findOneAndUpdate(
                { branch: transfer.toBranch, medicine: rx },
                { $inc: { quantity: qty } },
                { new: true }
              );
            } else {
              throw createErr;
            }
          }
        }
        await logActivity({
          pharmacyId: transfer.pharmacy,
          branchId: transfer.toBranch,
          actor,
          actionType: 'transfer_received',
          targetEntityType: 'TransferRequest',
          targetEntityId: transfer._id,
          description: `Transfer received: ${qty} unit(s) of "${transfer.medicine}" received at ${receivingBranchName} by ${actor.displayName} (${actor.actorType})`,
          details: {
            medicine: transfer.medicine,
            requestedQuantity: transfer.requestedQuantity,
            dispatchedQuantity: qty,
            quantity: qty,
            supplyingBranch: transfer.fromBranch,
            receivingBranch: transfer.toBranch,
            supplyingBranchName,
            receivingBranchName,
            status: 'received',
            before: { status: 'dispatched' },
            after: { status: 'received' }
          }
        });
        emitInventory(destStock);
      } catch (stockErr) {
        // Rollback transfer status back to 'dispatched'
        await TransferRequest.findByIdAndUpdate(transfer._id, {
          status: 'dispatched',
          $unset: { receivedBy: 1 }
        });
        throw stockErr;
      }
    }
  } else {
    throw httpError(400, `Unknown action: ${action}`);
  }

  // Populate updated transfer
  const populatedTransfer = await TransferRequest.findById(transfer._id)
    .populate('fromBranch', 'name address phone isMain')
    .populate('toBranch', 'name address phone isMain');

  const socketPayload = {
    transfer: populatedTransfer,
    status: populatedTransfer.status,
    previousStatus: transfer.status
  };

  io.to(`pharmacy:${transfer.pharmacy}`).emit('transfer:status', socketPayload);
  io.to(`pharmacy:${transfer.pharmacy}`).emit('transfer:updated', populatedTransfer);

  io.to(`branch:${transfer.fromBranch}`).emit('transfer:status', socketPayload);
  io.to(`branch:${transfer.fromBranch}`).emit('transfer:updated', populatedTransfer);

  io.to(`branch:${transfer.toBranch}`).emit('transfer:status', socketPayload);
  io.to(`branch:${transfer.toBranch}`).emit('transfer:updated', populatedTransfer);

  return populatedTransfer;
};

// 4. Update Transfer Status
app.patch('/api/pharmacy/transfers/:id/status', auth(['pharmacy', 'staff']), wrap(async (req, res) => {
  const { status, reason } = req.body;
  if (!status) throw httpError(400, 'Status is required');
  const actionMap = {
    approved: 'approve',
    rejected: 'reject',
    cancelled: 'cancel',
    dispatched: 'dispatch',
    received: 'receive'
  };
  const action = actionMap[status] || status;
  const result = await executeTransferAction(req, req.params.id, action, { reason });
  res.json(result);
}));

// Action endpoints: /api/pharmacy/transfers/:id/:action
app.patch('/api/pharmacy/transfers/:id/:action', auth(['pharmacy', 'staff']), wrap(async (req, res) => {
  const { action } = req.params;
  const validActions = ['approve', 'reject', 'cancel', 'dispatch', 'receive'];
  if (!validActions.includes(action)) {
    throw httpError(400, `Invalid action: ${action}`);
  }
  const result = await executeTransferAction(req, req.params.id, action, req.body);
  res.json(result);
}));

app.post('/api/pharmacy/transfers/:id/:action', auth(['pharmacy', 'staff']), wrap(async (req, res) => {
  const { action } = req.params;
  const validActions = ['approve', 'reject', 'cancel', 'dispatch', 'receive'];
  if (!validActions.includes(action)) {
    throw httpError(400, `Invalid action: ${action}`);
  }
  const result = await executeTransferAction(req, req.params.id, action, req.body);
  res.json(result);
}));


app.get('/api/pharmacy/reservations', auth(['pharmacy', 'staff']), wrap(async (req, res) => {
  if (req.role === 'staff') {
    return res.json(
      await Reservation.find({ branch: req.branchId })
        .populate('stock', 'medicine price')
        .populate('branch', 'name address')
        .sort('-createdAt')
    );
  }

  // Pharmacy owner
  if (req.query.branchId) {
    if (!mongoose.Types.ObjectId.isValid(req.query.branchId)) {
      throw httpError(400, 'Invalid branch ID');
    }
    const branch = await Branch.findOne({ _id: req.query.branchId, pharmacy: req.userId });
    if (!branch) {
      throw httpError(403, 'Access denied: You do not have permission to view reservations for this branch');
    }
    return res.json(
      await Reservation.find({ branch: branch._id, pharmacy: req.userId })
        .populate('stock', 'medicine price')
        .populate('branch', 'name address')
        .sort('-createdAt')
    );
  }

  // Return all reservations for this pharmacy (backward compatibility)
  res.json(
    await Reservation.find({ pharmacy: req.userId })
      .populate('stock', 'medicine price')
      .populate('branch', 'name address')
      .sort('-createdAt')
  );
}));

// Allowed status transitions made by the pharmacy
const PHARMACY_NEXT = {
  held: ['confirmed', 'cancelled'],
  confirmed: ['ready', 'cancelled'],
  ready: ['collected', 'cancelled']
};

app.patch('/api/pharmacy/reservations/:id/status', auth(['pharmacy', 'staff']), wrap(async (req, res) => {
  const { status } = req.body;
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw httpError(400, 'Invalid reservation ID');
  }

  let current;
  if (req.role === 'staff') {
    current = await Reservation.findOne({ _id: req.params.id, branch: req.branchId });
  } else {
    current = await Reservation.findOne({ _id: req.params.id, pharmacy: req.userId });
  }

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

  const actor = await resolveActorInfo(req);
  const branchDoc = await Branch.findById(reservation.branch).select('name');
  const branchName = branchDoc?.name || 'Branch';

  await logActivity({
    pharmacyId: reservation.pharmacy || req.pharmacyId,
    branchId: reservation.branch,
    actor,
    actionType: `reservation_${status}`,
    targetEntityType: 'Reservation',
    targetEntityId: reservation._id,
    description: `Reservation for ${reservation.quantity} unit(s) of "${reservation.stock?.medicine || 'Medicine'}" marked as ${status} at ${branchName} by ${actor.displayName} (${actor.actorType})`,
    details: {
      medicine: reservation.stock?.medicine,
      quantity: reservation.quantity,
      patientName: reservation.patientName,
      status,
      before: { status: current.status },
      after: { status }
    }
  });

  res.json(reservation);
}));

// ---------- Activity History Audit Logs ----------
app.get('/api/pharmacy/activity-logs', auth(['pharmacy', 'staff']), wrap(async (req, res) => {
  const pharmacyId = req.role === 'staff' ? req.pharmacyId : req.userId;
  let branchId = req.role === 'staff' ? req.branchId : (req.query.branchId || undefined);

  if (branchId && !mongoose.Types.ObjectId.isValid(branchId)) {
    throw httpError(400, 'Invalid branch ID');
  }

  if (req.role === 'pharmacy' && branchId) {
    const branch = await Branch.findOne({ _id: branchId, pharmacy: pharmacyId });
    if (!branch) {
      throw httpError(403, 'Branch does not belong to your pharmacy');
    }
  }

  const logs = await getActivityLogs(pharmacyId, {
    branchId,
    limit: req.query.limit,
    skip: req.query.skip
  });

  res.json(logs);
}));

// ---------- Patient search ----------
app.get('/api/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();

  if (!q) {
    throw new Error('Enter a medicine name');
  }

  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    throw new Error('Patient location is required');
  }

  const radiusKm = Math.min(
    Math.max(Number(req.query.radiusKm) || 10, 1),
    50
  );

  // Search nearby physical branches using 2dsphere index on Branch.location
  const nearBranches = await Branch.aggregate([
    {
      $geoNear: {
        near: {
          type: 'Point',
          coordinates: [lng, lat]
        },
        distanceField: 'distanceMeters',
        maxDistance: radiusKm * 1000,
        spherical: true,
        query: { isActive: { $ne: false } }
      }
    },
    {
      $limit: 50
    }
  ]);

  if (!nearBranches.length) {
    return res.json([]);
  }

  const branchById = new Map(
    nearBranches.map(b => [String(b._id), b])
  );
  const branchIds = [...branchById.keys()].map(id => new mongoose.Types.ObjectId(id));

  const rx = new RegExp(
    q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'i'
  );

  const stock = await Stock.find({
    branch: { $in: branchIds },
    quantity: { $gte: 0 },
    $or: [
      { medicine: rx },
      { generic: rx }
    ]
  }).limit(100);

  const results = stock
    .map(s => {
      const b = branchById.get(String(s.branch));
      if (!b) return null;

      return {
        stock: s,
        pharmacy: {
          _id: b.pharmacy,
          name: b.name,
          address: b.address,
          phone: b.phone,
          location: b.location
        },
        branch: {
          _id: b._id,
          name: b.name,
          address: b.address,
          phone: b.phone,
          location: b.location,
          isMain: b.isMain
        },
        distanceKm: +(b.distanceMeters / 1000).toFixed(2)
      };
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

  // Atomic: decrement only if enough stock remains at this specific branch stock record
  const stock = await Stock.findOneAndUpdate(
    { _id: stockId, quantity: { $gte: qty } },
    { $inc: { quantity: -qty } },
    { new: true }
  );
  if (!stock) throw new Error('Not enough stock left at this pharmacy branch');

  try {
    const reservation = await Reservation.create({
      stock: stock._id,
      pharmacy: stock.pharmacy,
      branch: stock.branch,
      patient: patient._id,
      patientName: patient.name,
      patientPhone: patient.phone,
      quantity: qty,
      expiresAt: new Date(Date.now() + HOLD_MS)
    });
    emitInventory(stock);
    notifyReservation(reservation, 'held', stock.medicine);
    io.to(`pharmacy:${stock.pharmacy}`).emit('reservation:new', {
      reservationId: reservation._id,
      branchId: stock.branch,
      medicine: stock.medicine,
      quantity: qty,
      patientName: patient.name
    });
    if (stock.branch) {
      io.to(`branch:${stock.branch}`).emit('reservation:new', {
        reservationId: reservation._id,
        branchId: stock.branch,
        medicine: stock.medicine,
        quantity: qty,
        patientName: patient.name
      });
    }
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
    .populate('branch', 'name address location')
    .sort('-createdAt'));
}));
app.get('/api/patient/profile', auth(['patient']), wrap(async (req, res) => {
  const patient = await Patient.findById(req.userId).select('-password');

  if (!patient) {
    throw httpError(404, 'Patient not found');
  }

  res.json(patient);
}));
app.put('/api/patient/profile', auth(['patient']), wrap(async (req, res) => {
  const { address } = req.body;

  if (!address || !String(address).trim()) {
    throw new Error('Address is required');
  }

  const cleanAddress = String(address).trim();
  const coords = extractCoordinates(req.body);

  let latNum;
  let lngNum;

  if (coords && Array.isArray(coords) && coords.length === 2) {
    lngNum = Number(coords[0]);
    latNum = Number(coords[1]);

    if (
      !Number.isFinite(latNum) ||
      !Number.isFinite(lngNum) ||
      latNum < -90 ||
      latNum > 90 ||
      lngNum < -180 ||
      lngNum > 180
    ) {
      throw new Error('Valid coordinates are required (latitude between -90 and 90, longitude between -180 and 180)');
    }
  } else {
    // Convert the new address into new coordinates using OpenStreetMap Nominatim
    const location = await geocodeAddress(cleanAddress, 'patient');
    latNum = Number(location.lat);
    lngNum = Number(location.lng);

    if (
      !Number.isFinite(latNum) ||
      !Number.isFinite(lngNum) ||
      latNum < -90 ||
      latNum > 90 ||
      lngNum < -180 ||
      lngNum > 180
    ) {
      throw new Error('Could not determine valid coordinates from the address. Please select a valid location on the map.');
    }
  }

  const patient = await Patient.findByIdAndUpdate(
    req.userId,
    {
      address: cleanAddress,
      location: {
        type: 'Point',
        coordinates: [lngNum, latNum]
      }
    },
    { new: true, runValidators: true }
  ).select('-password');

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
