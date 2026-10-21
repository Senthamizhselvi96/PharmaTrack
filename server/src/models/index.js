import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const patientSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, unique: true, required: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true },
  address: { type: String, trim: true, default: '' },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number] } // [lng, lat]
  },
  password: { type: String, required: true },
}, { timestamps: true });
patientSchema.index({ location: '2dsphere' }, { sparse: true });

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

const branchSchema = new Schema({
  pharmacy: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true, index: true },
  name: { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: function(coords) {
          if (!Array.isArray(coords) || coords.length !== 2) return false;
          const [lng, lat] = coords;
          return (
            Number.isFinite(lng) &&
            Number.isFinite(lat) &&
            lng >= -180 &&
            lng <= 180 &&
            lat >= -90 &&
            lat <= 90
          );
        },
        message: 'Branch coordinates must be valid [longitude (-180 to 180), latitude (-90 to 90)]'
      }
    }
  },
  phone: { type: String, trim: true },
  isMain: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });
branchSchema.index({ location: '2dsphere' });
branchSchema.index(
  { pharmacy: 1, isMain: 1 },
  { unique: true, partialFilterExpression: { isMain: true }, name: 'pharmacy_isMain_unique' }
);

const staffSchema = new Schema({
  pharmacy: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true, index: true },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['staff'], default: 'staff' },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

export const PRODUCT_CATEGORIES = [
  'Medicines',
  'Healthcare Devices',
  'First Aid & Medical Supplies',
  'Personal Care & Skincare',
  'Baby & Mother Care',
  'Nutrition & Wellness',
  'Hygiene & Essentials'
];

const stockSchema = new Schema({
  pharmacy: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true, index: true },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
  medicine: { type: String, required: true, trim: true },
  generic: { type: String, trim: true },
  category: {
    type: String,
    enum: PRODUCT_CATEGORIES,
    default: 'Medicines',
    index: true
  },
  brand: { type: String, trim: true, default: '' },
  description: { type: String, trim: true, default: '' },
  quantity: { type: Number, min: 0, default: 0 },
  price: { type: Number, min: 0 }
}, { timestamps: true });
stockSchema.index({ branch: 1, medicine: 1 }, { unique: true });

const reservationSchema = new Schema({
  stock: { type: Schema.Types.ObjectId, ref: 'Stock', required: true },
  pharmacy: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true, index: true },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
  patient: { type: Schema.Types.ObjectId, ref: 'Patient', index: true },
  patientName: { type: String, required: true },
  patientPhone: { type: String, required: true },
  quantity: { type: Number, min: 1, required: true },
  status: { type: String, enum: ['held', 'confirmed', 'ready', 'collected', 'expired', 'cancelled'], default: 'held' },
  expiresAt: Date
}, { timestamps: true });

export const Patient = model('Patient', patientSchema);
export const Pharmacy = model('Pharmacy', pharmacySchema);
export const Branch = model('Branch', branchSchema);
export const Staff = model('Staff', staffSchema);
export const Stock = model('Stock', stockSchema);
export const Reservation = model('Reservation', reservationSchema);

const transferRequestSchema = new Schema({
  pharmacy: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true, index: true },
  fromBranch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
  toBranch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
  medicine: { type: String, required: true, trim: true },
  requestedQuantity: {
    type: Number,
    required: true,
    min: 1,
    validate: {
      validator: Number.isInteger,
      message: '{VALUE} is not an integer quantity'
    }
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'dispatched', 'received', 'completed', 'cancelled'],
    default: 'pending',
    index: true
  },
  notes: { type: String, trim: true },
  requestedBy: {
    userId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, enum: ['pharmacy', 'staff'], required: true },
    name: { type: String, required: true, trim: true }
  },
  reviewedBy: {
    userId: { type: Schema.Types.ObjectId },
    role: { type: String, enum: ['pharmacy', 'staff'] },
    name: { type: String, trim: true },
    reviewedAt: { type: Date }
  },
  dispatchedQuantity: { type: Number },
  dispatchedBy: {
    userId: { type: Schema.Types.ObjectId },
    role: { type: String, enum: ['pharmacy', 'staff'] },
    name: { type: String, trim: true },
    dispatchedAt: { type: Date }
  },
  receivedBy: {
    userId: { type: Schema.Types.ObjectId },
    role: { type: String, enum: ['pharmacy', 'staff'] },
    name: { type: String, trim: true },
    receivedAt: { type: Date }
  },
  rejectedBy: {
    userId: { type: Schema.Types.ObjectId },
    role: { type: String, enum: ['pharmacy', 'staff'] },
    name: { type: String, trim: true },
    rejectedAt: { type: Date },
    reason: { type: String, trim: true }
  },
  cancelledBy: {
    userId: { type: Schema.Types.ObjectId },
    role: { type: String, enum: ['pharmacy', 'staff'] },
    name: { type: String, trim: true },
    cancelledAt: { type: Date },
    reason: { type: String, trim: true }
  }
}, { timestamps: true });

transferRequestSchema.index({ pharmacy: 1, status: 1 });
transferRequestSchema.index({ fromBranch: 1, status: 1 });
transferRequestSchema.index({ toBranch: 1, status: 1 });
transferRequestSchema.index({ pharmacy: 1, createdAt: -1 });

export const TransferRequest = model('TransferRequest', transferRequestSchema);

const activityLogSchema = new Schema({
  pharmacy: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true, index: true },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
  actor: {
    userId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, enum: ['pharmacy', 'staff', 'Owner', 'Staff'], required: true },
    actorType: { type: String, enum: ['Owner', 'Staff'] },
    displayName: { type: String, required: true, trim: true }
  },
  actionType: { type: String, required: true, index: true },
  targetEntityType: { type: String, required: true },
  targetEntityId: { type: Schema.Types.ObjectId, required: true },
  description: { type: String, required: true, trim: true },
  details: new Schema({
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    supplyingBranch: { type: Schema.Types.ObjectId, ref: 'Branch' },
    receivingBranch: { type: Schema.Types.ObjectId, ref: 'Branch' },
    supplyingBranchName: { type: String, trim: true },
    receivingBranchName: { type: String, trim: true },
    medicine: { type: String, trim: true },
    quantity: { type: Number },
    requestedQuantity: { type: Number },
    dispatchedQuantity: { type: Number },
    status: { type: String, trim: true },
    reason: { type: String, trim: true },
    patientName: { type: String, trim: true }
  }, { _id: false, strict: false })
}, { timestamps: true });

activityLogSchema.index({ pharmacy: 1, createdAt: -1 });
activityLogSchema.index({ branch: 1, createdAt: -1 });
activityLogSchema.index({ targetEntityId: 1 });

export const ActivityLog = model('ActivityLog', activityLogSchema);
