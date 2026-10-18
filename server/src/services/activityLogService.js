import { ActivityLog, Pharmacy, Staff, Branch } from '../models/index.js';

/**
 * Resolves the actor's verified identity and display name from the database,
 * ensuring client-provided names cannot forge audit records.
 *
 * @param {object} req - Express request with auth context
 * @returns {Promise<{ userId: any, role: string, displayName: string }>}
 */
export async function resolveActorInfo(req) {
  if (req.role === 'staff') {
    let name = req.staff?.name;
    if (!name) {
      const s = await Staff.findById(req.userId).select('name');
      name = s?.name;
    }
    return {
      userId: req.userId,
      role: 'staff',
      actorType: 'Staff',
      displayName: name || 'Staff Member'
    };
  }

  if (req.role === 'pharmacy') {
    let name;
    if (req.pharmacy?.ownerName || req.pharmacy?.name) {
      name = req.pharmacy.ownerName || req.pharmacy.name;
    } else {
      const p = await Pharmacy.findById(req.userId).select('name ownerName');
      name = p?.ownerName || p?.name;
    }
    return {
      userId: req.userId,
      role: 'pharmacy',
      actorType: 'Owner',
      displayName: name || 'Pharmacy Owner'
    };
  }

  return {
    userId: req.userId,
    role: req.role || 'unknown',
    actorType: req.role === 'pharmacy' ? 'Owner' : 'Staff',
    displayName: 'Unknown'
  };
}

/**
 * Creates an immutable audit log entry for a successful pharmacy business operation.
 * Can be executed within an existing MongoDB transaction session if provided.
 *
 * @param {object} params
 * @param {any} params.pharmacyId - Pharmacy Owner ID
 * @param {any} [params.branchId] - Primary affected Branch ID
 * @param {object} params.actor - Verified actor object ({ userId, role, displayName })
 * @param {string} params.actionType - Action identifier
 * @param {string} params.targetEntityType - 'Stock' | 'Reservation' | 'TransferRequest'
 * @param {any} params.targetEntityId - Entity ID
 * @param {string} params.description - Human-readable summary
 * @param {object} [params.details] - Before/after snapshots and transfer branches
 * @param {any} [params.session] - MongoDB ClientSession if running in transaction
 * @returns {Promise<object|null>} The created ActivityLog record
 */
export async function logActivity({
  pharmacyId,
  branchId,
  actor,
  actionType,
  targetEntityType,
  targetEntityId,
  description,
  details = {},
  session = null
}) {
  if (!pharmacyId || !actor || !actionType) return null;

  const sanitizedDetails = { ...details };
  delete sanitizedDetails.password;
  delete sanitizedDetails.token;
  delete sanitizedDetails.jwt;
  delete sanitizedDetails.authorization;
  delete sanitizedDetails.secret;

  const doc = {
    pharmacy: pharmacyId,
    branch: branchId || undefined,
    actor: {
      userId: actor.userId,
      role: actor.role,
      actorType: actor.actorType || (actor.role === 'pharmacy' ? 'Owner' : 'Staff'),
      displayName: actor.displayName
    },
    actionType,
    targetEntityType,
    targetEntityId,
    description,
    details: sanitizedDetails
  };

  try {
    if (session) {
      const created = await ActivityLog.create([doc], { session });
      return created[0];
    }
    return await ActivityLog.create(doc);
  } catch (err) {
    console.error('Failed to write activity log:', err.message);
    return null;
  }
}

/**
 * Retrieves activity logs for a pharmacy owner, optionally filtered by branch.
 */
export async function getActivityLogs(pharmacyId, { branchId, limit = 50, skip = 0 } = {}) {
  const filter = { pharmacy: pharmacyId };
  if (branchId) {
    filter.$or = [
      { branch: branchId },
      { 'details.supplyingBranch': branchId },
      { 'details.receivingBranch': branchId }
    ];
  }

  const numericLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const numericSkip = Math.max(parseInt(skip, 10) || 0, 0);

  return ActivityLog.find(filter)
    .populate('branch', 'name address isMain')
    .populate('details.supplyingBranch', 'name address isMain')
    .populate('details.receivingBranch', 'name address isMain')
    .sort({ createdAt: -1 })
    .skip(numericSkip)
    .limit(numericLimit);
}
