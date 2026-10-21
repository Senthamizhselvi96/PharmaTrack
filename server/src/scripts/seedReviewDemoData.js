/**
 * PharmaTrack Review Demo Data Seed Script
 *
 * Populates college project review demo data:
 * - 3 Pharmacy Owner Accounts (Raju Medicals, Sri Lakshmi Pharmacy, Anbu Medicals)
 * - 12 Pharmacy Branches (4 branches per pharmacy in Ramapuram, Avadi, Muthapudupet, Porur)
 * - 9 Staff Accounts (mapped to specified pharmacies and branches)
 * - 20 Medicine Products distributed across branches (15, 12, 14 per branch)
 *
 * Characteristics:
 * - Standalone and 100% idempotent: safely re-runnable without duplicates
 * - Preserves existing application data, patient records, and schema integrity
 * - Validates GeoJSON coordinates for Ramapuram, Avadi, Muthapudupet, and Porur
 * - Uses existing bcryptjs hashing (cost factor 10) for compatible authentication
 * - Supports --dry-run mode for preflight verification
 *
 * Usage:
 *   node src/scripts/seedReviewDemoData.js --dry-run   # Preview records without writing
 *   node src/scripts/seedReviewDemoData.js             # Apply demo data to MongoDB
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { Pharmacy, Branch, Staff, Stock } from '../models/index.js';

// ============================================================================
// 1. DEMO DATA DEFINITIONS
// ============================================================================

export const DEMO_PHARMACIES = [
  {
    name: 'Raju Medicals',
    ownerName: 'Raju Kumar',
    email: 'raju.demo@example.com',
    passwordRaw: 'Raju@12345',
    phone: '9840123451',
    // Main branch default address & coordinates (Ramapuram)
    mainAddress: 'Bharathi Salai, Ramapuram, Chennai',
    mainCoordinates: [80.17866, 13.031751],
    branchesStockCount: 15,
    priceModifier: 0 // Base demo price
  },
  {
    name: 'Sri Lakshmi Pharmacy',
    ownerName: 'Suresh Babu',
    email: 'suresh.demo@example.com',
    passwordRaw: 'Suresh@12345',
    phone: '9840223451',
    // Main branch default address & coordinates (Ramapuram)
    mainAddress: 'Valluvar Salai, Ramapuram, Chennai',
    mainCoordinates: [80.1850, 13.0250],
    branchesStockCount: 12,
    priceModifier: -2 // Slightly discounted demo price
  },
  {
    name: 'Anbu Medicals',
    ownerName: 'Anand Raj',
    email: 'anand.demo@example.com',
    passwordRaw: 'Anand@12345',
    phone: '9840323451',
    // Main branch default address & coordinates (Ramapuram)
    mainAddress: 'Perumal Koil Street, Ramapuram',
    mainCoordinates: [80.1823, 13.0250],
    branchesStockCount: 14,
    priceModifier: +3 // Slight price variance
  }
];

export const DEMO_BRANCHES = [
  // --- Raju Medicals Branches ---
  {
    pharmacyEmail: 'raju.demo@example.com',
    branchArea: 'Ramapuram',
    branchName: 'Raju Medicals - Ramapuram',
    address: 'Bharathi Salai, Ramapuram, Chennai',
    coordinates: [80.17866, 13.031751], // [lng, lat]
    phone: '9840123451',
    isMain: true
  },
  {
    pharmacyEmail: 'raju.demo@example.com',
    branchArea: 'Avadi',
    branchName: 'Raju Medicals - Avadi',
    address: 'Near Avadi Railway Station, Avadi',
    coordinates: [80.10152, 13.11814],
    phone: '9840123452',
    isMain: false
  },
  {
    pharmacyEmail: 'raju.demo@example.com',
    branchArea: 'Muthapudupet',
    branchName: 'Raju Medicals - Muthapudupet',
    address: 'IAF Road, Muthapudupet, Avadi',
    coordinates: [80.0728, 13.1467],
    phone: '9840123453',
    isMain: false
  },
  {
    pharmacyEmail: 'raju.demo@example.com',
    branchArea: 'Porur',
    branchName: 'Raju Medicals - Porur',
    address: 'Arcot Road, Porur, Chennai',
    coordinates: [80.1565, 13.0382],
    phone: '9840123454',
    isMain: false
  },

  // --- Sri Lakshmi Pharmacy Branches ---
  {
    pharmacyEmail: 'suresh.demo@example.com',
    branchArea: 'Ramapuram',
    branchName: 'Sri Lakshmi Pharmacy - Ramapuram',
    address: 'Valluvar Salai, Ramapuram, Chennai',
    coordinates: [80.1850, 13.0250],
    phone: '9840223451',
    isMain: true
  },
  {
    pharmacyEmail: 'suresh.demo@example.com',
    branchArea: 'Avadi',
    branchName: 'Sri Lakshmi Pharmacy - Avadi',
    address: 'Tirumalairajapuram, Avadi',
    coordinates: [80.1016, 13.1182],
    phone: '9840223452',
    isMain: false
  },
  {
    pharmacyEmail: 'suresh.demo@example.com',
    branchArea: 'Muthapudupet',
    branchName: 'Sri Lakshmi Pharmacy - Muthapudupet',
    address: 'Bazaar Street, Muthapudupet, Avadi',
    coordinates: [80.0615, 13.1472],
    phone: '9840223453',
    isMain: false
  },
  {
    pharmacyEmail: 'suresh.demo@example.com',
    branchArea: 'Porur',
    branchName: 'Sri Lakshmi Pharmacy - Porur',
    address: 'Eswaran Koil Street, Porur',
    coordinates: [80.1557, 13.0315],
    phone: '9840223454',
    isMain: false
  },

  // --- Anbu Medicals Branches ---
  {
    pharmacyEmail: 'anand.demo@example.com',
    branchArea: 'Ramapuram',
    branchName: 'Anbu Medicals - Ramapuram',
    address: 'Perumal Koil Street, Ramapuram',
    coordinates: [80.1823, 13.0250],
    phone: '9840323451',
    isMain: true
  },
  {
    pharmacyEmail: 'anand.demo@example.com',
    branchArea: 'Avadi',
    branchName: 'Anbu Medicals - Avadi',
    address: 'Avadi Main Road area, Avadi',
    coordinates: [80.0972, 13.1097],
    phone: '9840323452',
    isMain: false
  },
  {
    pharmacyEmail: 'anand.demo@example.com',
    branchArea: 'Muthapudupet',
    branchName: 'Anbu Medicals - Muthapudupet',
    address: 'Shastri Nagar, Muthapudupet, Avadi',
    coordinates: [80.0615, 13.1472],
    phone: '9840323453',
    isMain: false
  },
  {
    pharmacyEmail: 'anand.demo@example.com',
    branchArea: 'Porur',
    branchName: 'Anbu Medicals - Porur',
    address: 'Porur–Kundrathur Road, Porur',
    coordinates: [80.1485, 13.0275],
    phone: '9840323454',
    isMain: false
  }
];

export const DEMO_STAFF = [
  // Raju Medicals Staff
  {
    name: 'Sam',
    pharmacyEmail: 'raju.demo@example.com',
    branchArea: 'Ramapuram',
    email: 'sam.raju@example.com',
    passwordRaw: 'Sam@12345'
  },
  {
    name: 'Karthik',
    pharmacyEmail: 'raju.demo@example.com',
    branchArea: 'Avadi',
    email: 'karthik.raju@example.com',
    passwordRaw: 'Karthik@12345'
  },
  {
    name: 'Priya',
    pharmacyEmail: 'raju.demo@example.com',
    branchArea: 'Porur',
    email: 'priya.raju@example.com',
    passwordRaw: 'Priya@12345'
  },

  // Sri Lakshmi Pharmacy Staff
  {
    name: 'Divya',
    pharmacyEmail: 'suresh.demo@example.com',
    branchArea: 'Ramapuram',
    email: 'divya.lakshmi@example.com',
    passwordRaw: 'Divya@12345'
  },
  {
    name: 'Arun',
    pharmacyEmail: 'suresh.demo@example.com',
    branchArea: 'Muthapudupet',
    email: 'arun.lakshmi@example.com',
    passwordRaw: 'Arun@12345'
  },
  {
    name: 'Meena',
    pharmacyEmail: 'suresh.demo@example.com',
    branchArea: 'Avadi',
    email: 'meena.lakshmi@example.com',
    passwordRaw: 'Meena@12345'
  },

  // Anbu Medicals Staff
  {
    name: 'Naveen',
    pharmacyEmail: 'anand.demo@example.com',
    branchArea: 'Muthapudupet',
    email: 'naveen.anbu@example.com',
    passwordRaw: 'Naveen@12345'
  },
  {
    name: 'Kavya',
    pharmacyEmail: 'anand.demo@example.com',
    branchArea: 'Porur',
    email: 'kavya.anbu@example.com',
    passwordRaw: 'Kavya@12345'
  },
  {
    name: 'Hari',
    pharmacyEmail: 'anand.demo@example.com',
    branchArea: 'Avadi',
    email: 'hari.anbu@example.com',
    passwordRaw: 'Hari@12345'
  }
];

export const DEMO_MEDICINES = [
  {
    id: 1,
    medicine: 'Dolo 650',
    generic: 'Paracetamol 650 mg',
    price: 35,
    unit: 'strip',
    category: 'Medicines',
    brand: 'Micro Labs'
  },
  {
    id: 2,
    medicine: 'Crocin Advance',
    generic: 'Paracetamol 500 mg',
    price: 25,
    unit: 'strip',
    category: 'Medicines',
    brand: 'GSK'
  },
  {
    id: 3,
    medicine: 'Calpol 500',
    generic: 'Paracetamol 500 mg',
    price: 20,
    unit: 'strip',
    category: 'Medicines',
    brand: 'GSK'
  },
  {
    id: 4,
    medicine: 'Cetirizine 10 mg',
    generic: 'Cetirizine',
    price: 18,
    unit: 'strip',
    category: 'Medicines',
    brand: 'Cipla'
  },
  {
    id: 5,
    medicine: 'Allegra 120',
    generic: 'Fexofenadine 120 mg',
    price: 210,
    unit: 'strip',
    category: 'Medicines',
    brand: 'Sanofi'
  },
  {
    id: 6,
    medicine: 'Azithral 500',
    generic: 'Azithromycin 500 mg',
    price: 120,
    unit: 'strip',
    category: 'Medicines',
    brand: 'Alembic'
  },
  {
    id: 7,
    medicine: 'Augmentin 625 Duo',
    generic: 'Amoxicillin + Clavulanic Acid',
    price: 225,
    unit: 'strip',
    category: 'Medicines',
    brand: 'GSK'
  },
  {
    id: 8,
    medicine: 'Pan 40',
    generic: 'Pantoprazole 40 mg',
    price: 150,
    unit: 'strip',
    category: 'Medicines',
    brand: 'Alkem'
  },
  {
    id: 9,
    medicine: 'Omez 20',
    generic: 'Omeprazole 20 mg',
    price: 65,
    unit: 'strip',
    category: 'Medicines',
    brand: "Dr. Reddy's"
  },
  {
    id: 10,
    medicine: 'Digene Tablets',
    generic: 'Antacid combination',
    price: 25,
    unit: 'strip',
    category: 'Medicines',
    brand: 'Abbott'
  },
  {
    id: 11,
    medicine: 'Electral ORS',
    generic: 'Oral Rehydration Salts',
    price: 22,
    unit: 'sachet',
    category: 'Nutrition & Wellness',
    brand: 'FDC'
  },
  {
    id: 12,
    medicine: 'Becosules Capsules',
    generic: 'Vitamin B-complex + Vitamin C',
    price: 55,
    unit: 'strip',
    category: 'Nutrition & Wellness',
    brand: 'Pfizer'
  },
  {
    id: 13,
    medicine: 'Shelcal 500',
    generic: 'Calcium + Vitamin D3',
    price: 145,
    unit: 'strip',
    category: 'Nutrition & Wellness',
    brand: 'Torrent'
  },
  {
    id: 14,
    medicine: 'Zincovit',
    generic: 'Multivitamins + Minerals',
    price: 115,
    unit: 'strip',
    category: 'Nutrition & Wellness',
    brand: 'Apex'
  },
  {
    id: 15,
    medicine: 'Limcee 500',
    generic: 'Ascorbic Acid 500 mg',
    price: 28,
    unit: 'strip',
    category: 'Nutrition & Wellness',
    brand: 'Abbott'
  },
  {
    id: 16,
    medicine: 'Metformin 500 mg',
    generic: 'Metformin Hydrochloride',
    price: 25,
    unit: 'strip',
    category: 'Medicines',
    brand: 'USV'
  },
  {
    id: 17,
    medicine: 'Amlodipine 5 mg',
    generic: 'Amlodipine',
    price: 30,
    unit: 'strip',
    category: 'Medicines',
    brand: 'Cipla'
  },
  {
    id: 18,
    medicine: 'Montair-LC',
    generic: 'Montelukast + Levocetirizine',
    price: 220,
    unit: 'strip',
    category: 'Medicines',
    brand: 'Cipla'
  },
  {
    id: 19,
    medicine: 'Betadine Ointment',
    generic: 'Povidone-Iodine',
    price: 110,
    unit: 'tube',
    category: 'First Aid & Medical Supplies',
    brand: 'Win-Medicare'
  },
  {
    id: 20,
    medicine: 'Volini Gel',
    generic: 'Diclofenac-based topical formulation',
    price: 125,
    unit: 'tube',
    category: 'First Aid & Medical Supplies',
    brand: 'Sun Pharma'
  }
];

// Product index distribution per branch area (0-indexed referring to DEMO_MEDICINES)
// Common products (0: Dolo 650, 1: Crocin Advance, 3: Cetirizine 10 mg) are included in all branches.
const BRANCH_STOCK_SELECTION = {
  // Raju Medicals (15 per branch)
  'raju.demo@example.com': {
    'Ramapuram':   [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    'Avadi':       [0, 1, 3, 5, 6, 7, 8, 10, 11, 13, 14, 15, 16, 17, 18],
    'Muthapudupet': [0, 1, 2, 3, 4, 7, 8, 9, 11, 12, 15, 16, 17, 18, 19],
    'Porur':       [0, 1, 3, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16, 18, 19]
  },
  // Sri Lakshmi Pharmacy (12 per branch)
  'suresh.demo@example.com': {
    'Ramapuram':   [0, 1, 3, 4, 6, 7, 9, 10, 12, 13, 15, 17],
    'Avadi':       [0, 1, 2, 3, 5, 8, 10, 11, 14, 16, 18, 19],
    'Muthapudupet': [0, 1, 3, 5, 7, 8, 9, 12, 13, 15, 17, 19],
    'Porur':       [0, 1, 2, 3, 4, 6, 7, 11, 14, 16, 17, 18]
  },
  // Anbu Medicals (14 per branch)
  'anand.demo@example.com': {
    'Ramapuram':   [0, 1, 2, 3, 4, 5, 7, 8, 10, 11, 13, 15, 17, 19],
    'Avadi':       [0, 1, 3, 4, 6, 7, 8, 9, 11, 12, 14, 16, 18, 19],
    'Muthapudupet': [0, 1, 2, 3, 5, 6, 8, 9, 10, 13, 14, 15, 16, 17],
    'Porur':       [0, 1, 2, 3, 5, 7, 9, 10, 11, 12, 13, 15, 18, 19]
  }
};

const QUANTITY_CYCLE = [25, 40, 15, 8, 30, 20, 35, 12];

// ============================================================================
// 2. COORDINATE VALIDATION HELPER
// ============================================================================

function validateBranchCoordinates(coords) {
  if (!Array.isArray(coords) || coords.length !== 2) {
    return { valid: false, reason: 'Coordinates must be [longitude, latitude]' };
  }
  const [lng, lat] = coords.map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return { valid: false, reason: 'Coordinates contain non-finite numbers' };
  }
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    return { valid: false, reason: `Coordinates out of range: lng=${lng}, lat=${lat}` };
  }
  return { valid: true, lng, lat };
}

// ============================================================================
// 3. MAIN SEED RUNNER
// ============================================================================

async function run() {
  const isDryRun = process.argv.includes('--dry-run');

  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ Error: MONGO_URI environment variable is required in server/.env');
    process.exit(1);
  }

  console.log('\n=============================================================');
  console.log('       PHARMATRACK REVIEW DEMO DATA SEED SCRIPT             ');
  console.log('=============================================================');
  console.log(`Execution Mode:  ${isDryRun ? 'DRY-RUN (Read-only preflight check)' : 'LIVE SEED (Inserting demo data)'}`);
  console.log('Connecting to MongoDB...');

  await mongoose.connect(uri);
  const dbName = mongoose.connection.name;
  const hostName = mongoose.connection.host;
  console.log(`✓ Connected to MongoDB`);
  console.log(`  Target Database: ${dbName}`);
  console.log(`  Host:            ${hostName}\n`);

  const report = {
    pharmaciesCreated: 0,
    pharmaciesExisting: 0,
    branchesCreated: 0,
    branchesExisting: 0,
    staffCreated: 0,
    staffExisting: 0,
    stocksCreated: 0,
    stocksExisting: 0,
    coordinateValidationIssues: []
  };

  // Pre-validate coordinates for all 12 branches
  console.log('[Step 1/5] Validating branch coordinates...');
  for (const b of DEMO_BRANCHES) {
    const v = validateBranchCoordinates(b.coordinates);
    if (!v.valid) {
      report.coordinateValidationIssues.push({
        branch: b.branchName,
        address: b.address,
        reason: v.reason
      });
      console.error(`  ❌ Invalid coordinates for ${b.branchName}: ${v.reason}`);
    } else {
      console.log(`  ✓ [${b.branchArea}] ${b.branchName} -> [lng: ${v.lng}, lat: ${v.lat}] (${b.address})`);
    }
  }

  if (report.coordinateValidationIssues.length > 0) {
    console.error('\n❌ ABORTING: Branch coordinates failed validation.');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log('✓ All 12 branch coordinates validated successfully.\n');

  // Step 2: Seed Pharmacy Owner Accounts
  console.log('[Step 2/5] Checking Pharmacy Owner Accounts...');
  const pharmacyDocsByEmail = new Map();

  for (const p of DEMO_PHARMACIES) {
    const existing = await Pharmacy.findOne({ email: p.email });

    if (existing) {
      report.pharmaciesExisting++;
      pharmacyDocsByEmail.set(p.email, existing);
      console.log(`  • Pharmacy "${p.name}" (${p.email}) already exists [ID: ${existing._id}]`);
    } else {
      report.pharmaciesCreated++;
      console.log(`  + Will create Pharmacy "${p.name}" (Owner: ${p.ownerName}, Email: ${p.email})`);

      if (!isDryRun) {
        const hashedPassword = await bcrypt.hash(p.passwordRaw, 10);
        const created = await Pharmacy.create({
          name: p.name,
          ownerName: p.ownerName,
          email: p.email,
          phone: p.phone,
          address: p.mainAddress,
          password: hashedPassword,
          location: {
            type: 'Point',
            coordinates: p.mainCoordinates
          }
        });
        pharmacyDocsByEmail.set(p.email, created);
        console.log(`    ✓ Created Pharmacy document [ID: ${created._id}]`);
      }
    }
  }

  // Step 3: Seed 12 Pharmacy Branches
  console.log('\n[Step 3/5] Checking Pharmacy Branches (4 per owner = 12 total)...');
  const branchDocsByKey = new Map(); // key: `${pharmacyEmail}_${branchArea}`

  for (const b of DEMO_BRANCHES) {
    const pharmacy = pharmacyDocsByEmail.get(b.pharmacyEmail);
    const pharmacyId = pharmacy ? pharmacy._id : new mongoose.Types.ObjectId();

    // Check if branch already exists by pharmacy + name
    let existingBranch = null;
    if (pharmacy) {
      existingBranch = await Branch.findOne({
        pharmacy: pharmacyId,
        $or: [
          { name: b.branchName },
          { address: b.address }
        ]
      });
    }

    const branchKey = `${b.pharmacyEmail}_${b.branchArea}`;

    if (existingBranch) {
      report.branchesExisting++;
      branchDocsByKey.set(branchKey, existingBranch);
      console.log(`  • Branch "${b.branchName}" (${b.branchArea}) already exists [ID: ${existingBranch._id}]`);
    } else {
      report.branchesCreated++;
      console.log(`  + Will create Branch "${b.branchName}" [${b.isMain ? '★ MAIN' : 'SECONDARY'}] in ${b.branchArea}`);

      if (!isDryRun && pharmacy) {
        const createdBranch = await Branch.create({
          pharmacy: pharmacy._id,
          name: b.branchName,
          address: b.address,
          phone: b.phone,
          location: {
            type: 'Point',
            coordinates: b.coordinates
          },
          isMain: b.isMain,
          isActive: true
        });
        branchDocsByKey.set(branchKey, createdBranch);
        console.log(`    ✓ Created Branch document [ID: ${createdBranch._id}]`);
      }
    }
  }

  // Step 4: Seed 9 Staff Accounts
  console.log('\n[Step 4/5] Checking Staff Accounts (9 total)...');
  for (const s of DEMO_STAFF) {
    const existingStaff = await Staff.findOne({ email: s.email });
    const pharmacy = pharmacyDocsByEmail.get(s.pharmacyEmail);
    const branch = branchDocsByKey.get(`${s.pharmacyEmail}_${s.branchArea}`);

    if (existingStaff) {
      report.staffExisting++;
      console.log(`  • Staff "${s.name}" (${s.email}) already exists [ID: ${existingStaff._id}]`);
    } else {
      report.staffCreated++;
      console.log(`  + Will create Staff "${s.name}" (${s.email}) -> Branch: ${s.branchArea}`);

      if (!isDryRun) {
        if (!pharmacy || !branch) {
          console.error(`    ❌ Cannot create staff ${s.email}: missing pharmacy or branch doc`);
          continue;
        }

        const hashedPassword = await bcrypt.hash(s.passwordRaw, 10);
        const createdStaff = await Staff.create({
          pharmacy: pharmacy._id,
          branch: branch._id,
          name: s.name,
          email: s.email,
          password: hashedPassword,
          role: 'staff',
          isActive: true
        });
        console.log(`    ✓ Created Staff document [ID: ${createdStaff._id}]`);
      }
    }
  }

  // Step 5: Seed Medicine Inventory Records
  console.log('\n[Step 5/5] Checking Medicine Stock Inventory across branches...');
  let totalStockChecked = 0;

  for (const p of DEMO_PHARMACIES) {
    const pharmacy = pharmacyDocsByEmail.get(p.email);
    const branchSelection = BRANCH_STOCK_SELECTION[p.email] || {};

    for (const [branchArea, medicineIndices] of Object.entries(branchSelection)) {
      const branchKey = `${p.email}_${branchArea}`;
      const branch = branchDocsByKey.get(branchKey);

      for (let i = 0; i < medicineIndices.length; i++) {
        totalStockChecked++;
        const medIndex = medicineIndices[i];
        const medDef = DEMO_MEDICINES[medIndex];
        const qty = QUANTITY_CYCLE[(totalStockChecked + i) % QUANTITY_CYCLE.length];
        const adjustedPrice = Math.max(10, medDef.price + p.priceModifier);

        let existingStock = null;
        if (branch) {
          existingStock = await Stock.findOne({
            branch: branch._id,
            medicine: medDef.medicine
          });
        }

        if (existingStock) {
          report.stocksExisting++;
        } else {
          report.stocksCreated++;

          if (!isDryRun && pharmacy && branch) {
            await Stock.create({
              pharmacy: pharmacy._id,
              branch: branch._id,
              medicine: medDef.medicine,
              generic: medDef.generic,
              category: medDef.category,
              brand: `${medDef.brand} [Review Demo]`,
              description: `Unit: ${medDef.unit}. Indicative demo stock for college review demonstration.`,
              quantity: qty,
              price: adjustedPrice
            });
          }
        }
      }
      console.log(`  ✓ ${p.name} - ${branchArea} Branch: Checked ${medicineIndices.length} medicines`);
    }
  }

  // ==========================================================================
  // FINAL REPORT & SUMMARY
  // ==========================================================================
  console.log('\n=============================================================');
  console.log('              DEMO DATA SEED REPORT SUMMARY                 ');
  console.log('=============================================================');
  console.log(`Target Database:             ${dbName} (${hostName})`);
  console.log(`Mode:                        ${isDryRun ? 'DRY-RUN (No changes applied)' : 'LIVE SEED (Changes written)'}`);
  console.log('-------------------------------------------------------------');
  console.log(`Pharmacy Owners:             ${report.pharmaciesCreated} to create / ${report.pharmaciesExisting} already existing (Total: 3)`);
  console.log(`Pharmacy Branches:           ${report.branchesCreated} to create / ${report.branchesExisting} already existing (Total: 12)`);
  console.log(`Staff Accounts:              ${report.staffCreated} to create / ${report.staffExisting} already existing (Total: 9)`);
  console.log(`Stock Inventory Records:     ${report.stocksCreated} to create / ${report.stocksExisting} already existing (Total: 164)`);
  console.log(`Coordinate Validation Issues: ${report.coordinateValidationIssues.length}`);
  console.log('=============================================================\n');

  if (isDryRun) {
    console.log('Preflight check completed successfully.');
    console.log('To apply these changes to MongoDB, run without --dry-run:');
    console.log('   node src/scripts/seedReviewDemoData.js\n');
  } else {
    console.log('✓ Demo data seeding completed successfully!');
    console.log('PharmaTrack is now ready for your college project review.\n');
  }

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB.');
}

run().catch(err => {
  console.error('\n❌ Error executing demo data seed script:', err);
  process.exit(1);
});
