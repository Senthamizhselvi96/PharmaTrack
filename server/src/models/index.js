import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const patientSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, unique: true, required: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true },
  password: { type: String, required: true },
}, { timestamps: true });

const pharmacySchema = new Schema({
  name: { type: String, required: true, trim: true },
  ownerName: { type: String, trim: true },
  email: { type: String, unique: true, required: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  phone: String,
  address: { type: String, required: true },
  location: { type: { type: String, enum: ['Point'], default: 'Point' }, coordinates: { type: [Number], required: true } } // [lng, lat]
}, { timestamps: true });
pharmacySchema.index({ location: '2dsphere' });

const stockSchema = new Schema({
  pharmacy: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true, index: true },
  medicine: { type: String, required: true, trim: true },
  generic: { type: String, trim: true },
  quantity: { type: Number, min: 0, default: 0 },
  price: { type: Number, min: 0 }
}, { timestamps: true });
stockSchema.index({ pharmacy: 1, medicine: 1 }, { unique: true });

const reservationSchema = new Schema({
  stock: { type: Schema.Types.ObjectId, ref: 'Stock', required: true },
  pharmacy: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true, index: true },
  patient: { type: Schema.Types.ObjectId, ref: 'Patient', index: true },
  patientName: { type: String, required: true },
  patientPhone: { type: String, required: true },
  quantity: { type: Number, min: 1, required: true },
  status: { type: String, enum: ['held', 'confirmed', 'ready', 'collected', 'expired', 'cancelled'], default: 'held' },
  expiresAt: Date
}, { timestamps: true });

export const Patient = model('Patient', patientSchema);
export const Pharmacy = model('Pharmacy', pharmacySchema);
export const Stock = model('Stock', stockSchema);
export const Reservation = model('Reservation', reservationSchema);
