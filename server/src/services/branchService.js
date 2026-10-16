import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { Pharmacy, Branch, Staff, Stock, Reservation } from '../models/index.js';

/**
 * Validates GeoJSON Point coordinates [longitude, latitude].
 * Coordinates must be numbers within [-180, 180] for longitude and [-90, 90] for latitude.
 */
export function validateBranchCoordinates(coords) {
  if (!Array.isArray(coords) || coords.length !== 2) {
    return {
      valid: false,
      reason: 'Coordinates must be an array of two numbers: [longitude, latitude]'
    };
  }

  const [lng, lat] = coords.map(Number);

  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return {
      valid: false,
      reason: 'Coordinates contain non-finite or non-numeric values'
    };
  }

  if (lng < -180 || lng > 180) {
    return {
      valid: false,
      reason: `Longitude ${lng} is outside valid range [-180, 180]`
    };
  }

  if (lat < -90 || lat > 90) {
    return {
      valid: false,
      reason: `Latitude ${lat} is outside valid range [-90, 90]`
    };
  }

  return {
    valid: true,
    lng,
    lat
  };
}

/**
 * Safely and idempotently creates or retrieves the Main Branch for a given pharmacy.
 * Never creates duplicate Main Branch records even under concurrent calls.
 * Does NOT generate dummy coordinates if pharmacy coordinates are missing/invalid.
 *
 * @param {import('mongoose').Document|string} pharmacyOrId - Pharmacy document or ObjectId string
 * @returns {Promise<{ success: boolean, branch?: any, created?: boolean, reason?: string, pharmacyId?: any }>}
 */
export async function ensureMainBranchForPharmacy(pharmacyOrId) {
  const pharmacy = typeof pharmacyOrId === 'object' && pharmacyOrId !== null && pharmacyOrId._id
    ? pharmacyOrId
    : await Pharmacy.findById(pharmacyOrId);

  if (!pharmacy) {
    return {
      success: false,
      reason: `Pharmacy not found: ${pharmacyOrId}`
    };
  }

  // Fast check: return existing main branch if already provisioned
  const existing = await Branch.findOne({ pharmacy: pharmacy._id, isMain: true });
  if (existing) {
    return {
      success: true,
      branch: existing,
      created: false
    };
  }

  // Validate coordinates before creating
  const validation = validateBranchCoordinates(pharmacy.location?.coordinates);
  if (!validation.valid) {
    return {
      success: false,
      pharmacyId: pharmacy._id,
      pharmacyName: pharmacy.name,
      reason: validation.reason,
      branch: null
    };
  }

  try {
    // Atomic upsert with $setOnInsert to prevent race conditions
    const branch = await Branch.findOneAndUpdate(
      { pharmacy: pharmacy._id, isMain: true },
      {
        $setOnInsert: {
          pharmacy: pharmacy._id,
          name: pharmacy.name,
          address: pharmacy.address,
          phone: pharmacy.phone || undefined,
          location: {
            type: 'Point',
            coordinates: [validation.lng, validation.lat]
          },
          isMain: true,
          isActive: true
        }
      },
      { upsert: true, new: true, runValidators: true }
    );

    return {
      success: true,
      branch,
      created: true
    };
  } catch (err) {
    // If a concurrent request created the main branch simultaneously, fetch the winner
    if (err.code === 11000) {
      const branch = await Branch.findOne({ pharmacy: pharmacy._id, isMain: true });
      if (branch) {
        return {
          success: true,
          branch,
          created: false
        };
      }
    }
    throw err;
  }
}

/**
 * Backfills branch reference on legacy Stock and Reservation documents for a pharmacy.
 * Only targets records where `branch` is null or undefined to avoid overwriting existing branch assignments.
 *
 * @param {string|import('mongoose').Types.ObjectId} pharmacyId
 * @param {string|import('mongoose').Types.ObjectId} branchId
 * @returns {Promise<{ stocksLinked: number, reservationsLinked: number }>}
 */
export async function linkExistingRecordsToBranch(pharmacyId, branchId) {
  const unlinkedCondition = {
    pharmacy: pharmacyId,
    $or: [{ branch: { $exists: false } }, { branch: null }]
  };

  const stockResult = await Stock.updateMany(
    unlinkedCondition,
    { $set: { branch: branchId } }
  );

  const reservationResult = await Reservation.updateMany(
    unlinkedCondition,
    { $set: { branch: branchId } }
  );

  return {
    stocksLinked: stockResult.modifiedCount || 0,
    reservationsLinked: reservationResult.modifiedCount || 0
  };
}

/**
 * Migration helper to ensure every existing pharmacy has exactly one Main Branch
 * and links unassociated stock/reservation records to it.
 *
 * @returns {Promise<{
 *   totalPharmacies: number,
 *   mainBranchesCreated: number,
 *   mainBranchesExisting: number,
 *   skipped: Array<{ pharmacyId: any, name: string, reason: string }>,
 *   totalStocksLinked: number,
 *   totalReservationsLinked: number
 * }>}
 */
export async function backfillAllPharmaciesMainBranches() {
  const pharmacies = await Pharmacy.find({});
  let mainBranchesCreated = 0;
  let mainBranchesExisting = 0;
  let totalStocksLinked = 0;
  let totalReservationsLinked = 0;
  const skipped = [];

  for (const pharmacy of pharmacies) {
    const result = await ensureMainBranchForPharmacy(pharmacy);

    if (!result.success) {
      skipped.push({
        pharmacyId: pharmacy._id,
        name: pharmacy.name,
        reason: result.reason
      });
      continue;
    }

    if (result.created) {
      mainBranchesCreated++;
    } else {
      mainBranchesExisting++;
    }

    const linked = await linkExistingRecordsToBranch(pharmacy._id, result.branch._id);
    totalStocksLinked += linked.stocksLinked;
    totalReservationsLinked += linked.reservationsLinked;
  }

  return {
    totalPharmacies: pharmacies.length,
    mainBranchesCreated,
    mainBranchesExisting,
    skipped,
    totalStocksLinked,
    totalReservationsLinked
  };
}

/**
 * Retrieves all branches belonging to a pharmacy owner, ensuring the Main Branch
 * is provisioned and listed first, followed by secondary branches.
 */
export async function getOwnerBranches(pharmacyId) {
  // Ensure the main branch exists for this pharmacy
  await ensureMainBranchForPharmacy(pharmacyId);

  return Branch.find({ pharmacy: pharmacyId })
    .select('_id pharmacy name address location phone isMain isActive createdAt updatedAt')
    .sort({ isMain: -1, createdAt: 1 });
}

/**
 * Creates a secondary branch under the authenticated pharmacy.
 * Enforces isMain: false, isActive: true, and prevents duplicates with matching normalized name and address.
 */
export async function createSecondaryBranch(pharmacyId, { name, address, phone, coordinates }) {
  const cleanName = String(name || '').trim();
  if (!cleanName) {
    const err = new Error('Branch name is required');
    err.status = 400;
    throw err;
  }

  const cleanAddress = String(address || '').trim();
  if (!cleanAddress) {
    const err = new Error('Branch address is required');
    err.status = 400;
    throw err;
  }

  const validation = validateBranchCoordinates(coordinates);
  if (!validation.valid) {
    const err = new Error(validation.reason || 'Invalid branch coordinates');
    err.status = 400;
    throw err;
  }

  const escapeRegex = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const duplicate = await Branch.findOne({
    pharmacy: pharmacyId,
    name: { $regex: new RegExp(`^\\s*${escapeRegex(cleanName)}\\s*$`, 'i') },
    address: { $regex: new RegExp(`^\\s*${escapeRegex(cleanAddress)}\\s*$`, 'i') }
  });

  if (duplicate) {
    const err = new Error('A branch with this name and address already exists in your pharmacy business');
    err.status = 409;
    throw err;
  }

  const branch = await Branch.create({
    pharmacy: pharmacyId,
    name: cleanName,
    address: cleanAddress,
    phone: phone ? String(phone).trim() : '',
    location: {
      type: 'Point',
      coordinates: [validation.lng, validation.lat]
    },
    isMain: false,
    isActive: true
  });

  return branch;
}

/**
 * Updates a branch belonging to the authenticated pharmacy owner.
 * Verifies backend branch ownership, validates address and coordinates together,
 * prevents duplicate branches within the business, preserves isMain and pharmacy ownership,
 * and synchronizes the parent Pharmacy profile if updating the Main Branch.
 */
export async function updateOwnerBranch(pharmacyId, branchId, { name, address, phone, coordinates, isActive }) {
  if (!mongoose.Types.ObjectId.isValid(branchId)) {
    const err = new Error('Invalid branch ID');
    err.status = 400;
    throw err;
  }

  const branch = await Branch.findOne({ _id: branchId, pharmacy: pharmacyId });
  if (!branch) {
    const existsOther = await Branch.exists({ _id: branchId });
    if (existsOther) {
      const err = new Error('Access denied: You do not have permission to modify this branch');
      err.status = 403;
      throw err;
    }
    const err = new Error('Branch not found');
    err.status = 404;
    throw err;
  }

  const cleanName = name !== undefined ? String(name).trim() : branch.name;
  if (!cleanName) {
    const err = new Error('Branch name is required');
    err.status = 400;
    throw err;
  }

  const cleanAddress = address !== undefined ? String(address).trim() : branch.address;
  if (!cleanAddress) {
    const err = new Error('Branch address is required');
    err.status = 400;
    throw err;
  }

  const coordsToValidate = coordinates !== undefined ? coordinates : branch.location?.coordinates;
  const validation = validateBranchCoordinates(coordsToValidate);
  if (!validation.valid) {
    const err = new Error(validation.reason || 'Valid branch coordinates are required');
    err.status = 400;
    throw err;
  }

  const escapeRegex = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const duplicate = await Branch.findOne({
    _id: { $ne: branch._id },
    pharmacy: pharmacyId,
    name: { $regex: new RegExp(`^\\s*${escapeRegex(cleanName)}\\s*$`, 'i') },
    address: { $regex: new RegExp(`^\\s*${escapeRegex(cleanAddress)}\\s*$`, 'i') }
  });

  if (duplicate) {
    const err = new Error('Another branch with this name and address already exists in your pharmacy business');
    err.status = 409;
    throw err;
  }

  branch.name = cleanName;
  branch.address = cleanAddress;
  if (phone !== undefined) {
    branch.phone = String(phone).trim();
  }
  branch.location = {
    type: 'Point',
    coordinates: [validation.lng, validation.lat]
  };

  if (isActive !== undefined && typeof isActive === 'boolean' && !branch.isMain) {
    branch.isActive = isActive;
  }

  // isMain and pharmacy ownership remain strictly unchanged
  await branch.save();

  // If Main Branch was updated, keep parent Pharmacy profile in sync
  if (branch.isMain) {
    await Pharmacy.findByIdAndUpdate(pharmacyId, {
      name: branch.name,
      address: branch.address,
      phone: branch.phone,
      location: branch.location
    });
  }

  return branch;
}

/**
 * Creates a staff member for a branch belonging to the authenticated pharmacy owner.
 * Ensures the branch belongs to the owner, enforces password length, hashes password,
 * and rejects duplicate staff emails.
 */
export async function createBranchStaff(pharmacyId, branchId, { name, email, password }) {
  if (!mongoose.Types.ObjectId.isValid(branchId)) {
    const err = new Error('Invalid branch ID');
    err.status = 400;
    throw err;
  }

  const branch = await Branch.findOne({ _id: branchId, pharmacy: pharmacyId });
  if (!branch) {
    const existsOther = await Branch.exists({ _id: branchId });
    if (existsOther) {
      const err = new Error('Access denied: You do not have permission to add staff to this branch');
      err.status = 403;
      throw err;
    }
    const err = new Error('Branch not found');
    err.status = 404;
    throw err;
  }

  const cleanName = String(name || '').trim();
  if (!cleanName) {
    const err = new Error('Staff name is required');
    err.status = 400;
    throw err;
  }

  const cleanStaffEmail = String(email || '').trim().toLowerCase();
  if (!cleanStaffEmail) {
    const err = new Error('Staff email is required');
    err.status = 400;
    throw err;
  }

  if (!password || String(password).length < 6) {
    const err = new Error('Password must be at least 6 characters');
    err.status = 400;
    throw err;
  }

  const existingStaff = await Staff.findOne({ email: cleanStaffEmail });
  if (existingStaff) {
    const err = new Error('A staff account with this email already exists');
    err.status = 409;
    throw err;
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const staff = await Staff.create({
    pharmacy: pharmacyId,
    branch: branch._id,
    name: cleanName,
    email: cleanStaffEmail,
    password: hashedPassword,
    role: 'staff',
    isActive: true
  });

  return {
    _id: staff._id,
    pharmacy: staff.pharmacy,
    branch: staff.branch,
    name: staff.name,
    email: staff.email,
    role: staff.role,
    isActive: staff.isActive,
    createdAt: staff.createdAt,
    updatedAt: staff.updatedAt
  };
}

/**
 * Retrieves the list of staff assigned to a branch belonging to the authenticated pharmacy owner.
 * Returns safe staff information without password hashes.
 */
export async function getBranchStaff(pharmacyId, branchId) {
  if (!mongoose.Types.ObjectId.isValid(branchId)) {
    const err = new Error('Invalid branch ID');
    err.status = 400;
    throw err;
  }

  const branch = await Branch.findOne({ _id: branchId, pharmacy: pharmacyId });
  if (!branch) {
    const existsOther = await Branch.exists({ _id: branchId });
    if (existsOther) {
      const err = new Error('Access denied: You do not have permission to view staff for this branch');
      err.status = 403;
      throw err;
    }
    const err = new Error('Branch not found');
    err.status = 404;
    throw err;
  }

  return Staff.find({ branch: branch._id, pharmacy: pharmacyId })
    .select('-password')
    .sort('name');
}

/**
 * Authenticates a staff member with email and password.
 * Resolves the staff's authorized branch and pharmacy from database records.
 * Rejects inactive staff or inactive branches.
 */
export async function authenticateStaff({ email, password }) {
  const cleanStaffEmail = String(email || '').trim().toLowerCase();
  if (!cleanStaffEmail || !password) {
    const err = new Error('Email and password are required');
    err.status = 400;
    throw err;
  }

  const staff = await Staff.findOne({ email: cleanStaffEmail });
  if (!staff || !(await bcrypt.compare(String(password), staff.password))) {
    const err = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }

  if (!staff.isActive) {
    const err = new Error('Staff account is inactive. Please contact your pharmacy administrator');
    err.status = 403;
    throw err;
  }

  const branch = await Branch.findById(staff.branch);
  if (!branch || !branch.isActive) {
    const err = new Error('Assigned branch is inactive or unavailable');
    err.status = 403;
    throw err;
  }

  return { staff, branch };
}
