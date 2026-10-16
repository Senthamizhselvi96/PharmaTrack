import 'dotenv/config';
import mongoose from 'mongoose';
import { Stock, Branch, Pharmacy } from '../models/index.js';

/**
 * Migration Script: Safely replace Stock unique index (pharmacy + medicine)
 * with branch-specific unique index (branch + medicine).
 *
 * Preflight checks:
 * 1. Verifies all Stock documents have a valid `branch` reference.
 * 2. Checks for any duplicate `(branch, medicine)` records.
 *
 * Usage:
 *   node src/scripts/migrateStockIndex.js            # Run migration with preflight
 *   node src/scripts/migrateStockIndex.js --dry-run  # Run preflight checks only
 */
async function run() {
  const isDryRun = process.argv.includes('--dry-run');

  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('Error: MONGO_URI environment variable is required.');
    process.exit(1);
  }

  console.log('=== STOCK UNIQUE INDEX MIGRATION ===');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (preflight checks only)' : 'LIVE MIGRATION'}`);
  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('Connected to MongoDB.\n');

  // Step 1: Inspect current indexes
  console.log('[Step 1] Inspecting current Stock collection indexes...');
  const currentIndexes = await Stock.collection.indexes();
  const hasOldIndex = currentIndexes.some(idx => idx.name === 'pharmacy_1_medicine_1');
  const hasNewIndex = currentIndexes.some(idx => idx.name === 'branch_1_medicine_1');

  console.log('Current Stock indexes:', currentIndexes.map(i => i.name).join(', '));
  console.log(` - Old index (pharmacy_1_medicine_1): ${hasOldIndex ? 'FOUND' : 'NOT FOUND'}`);
  console.log(` - New index (branch_1_medicine_1):   ${hasNewIndex ? 'FOUND' : 'NOT FOUND'}`);

  // Step 2: Preflight check - Unlinked stock records
  console.log('\n[Step 2] Checking for unlinked Stock records (missing or null branch)...');
  const unlinkedCount = await Stock.countDocuments({
    $or: [{ branch: { $exists: false } }, { branch: null }]
  });

  if (unlinkedCount > 0) {
    console.error(`\n❌ PREFLIGHT CHECK FAILED: Found ${unlinkedCount} Stock record(s) without a valid branch.`);
    console.error('Please run "npm run migrate:branches" first to link existing stock to Main Branches before running this migration.');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log('✓ All Stock records have valid branch references.');

  // Step 3: Preflight check - Duplicate (branch, medicine) combinations
  console.log('\n[Step 3] Checking for duplicate (branch, medicine) combinations...');
  const duplicates = await Stock.aggregate([
    {
      $group: {
        _id: { branch: '$branch', medicine: '$medicine' },
        count: { $sum: 1 },
        docIds: { $push: '$_id' }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]);

  if (duplicates.length > 0) {
    console.error(`\n❌ PREFLIGHT CHECK FAILED: Found ${duplicates.length} duplicate (branch, medicine) combination(s):`);
    duplicates.forEach(d => {
      console.error(` - Branch [${d._id.branch}], Medicine "${d._id.medicine}": ${d.count} duplicates (IDs: ${d.docIds.join(', ')})`);
    });
    console.error('\nPlease resolve these duplicate records manually before creating the unique index.');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log('✓ No duplicate (branch, medicine) combinations detected.');

  if (isDryRun) {
    console.log('\n[DRY RUN COMPLETE] All preflight checks passed successfully. Migration is safe to execute.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // Step 4: Execute Index Migration
  console.log('\n[Step 4] Executing index migration...');

  // Create new unique index on branch + medicine
  if (!hasNewIndex) {
    console.log('Creating unique index "branch_1_medicine_1" on { branch: 1, medicine: 1 }...');
    await Stock.collection.createIndex(
      { branch: 1, medicine: 1 },
      { unique: true, name: 'branch_1_medicine_1', background: true }
    );
    console.log('✓ Created unique index "branch_1_medicine_1".');
  } else {
    console.log('Unique index "branch_1_medicine_1" already exists.');
  }

  // Drop old unique index on pharmacy + medicine if present
  if (hasOldIndex) {
    console.log('Dropping legacy unique index "pharmacy_1_medicine_1"...');
    await Stock.collection.dropIndex('pharmacy_1_medicine_1');
    console.log('✓ Dropped legacy unique index "pharmacy_1_medicine_1".');
  } else {
    console.log('Legacy index "pharmacy_1_medicine_1" was already removed.');
  }

  // Step 5: Verification
  console.log('\n[Step 5] Verifying final index configuration...');
  const finalIndexes = await Stock.collection.indexes();
  const verifiedNewIndex = finalIndexes.find(idx => idx.name === 'branch_1_medicine_1');
  const verifiedOldIndex = finalIndexes.find(idx => idx.name === 'pharmacy_1_medicine_1');

  if (!verifiedNewIndex || !verifiedNewIndex.unique) {
    throw new Error('Verification failed: unique index "branch_1_medicine_1" was not created properly!');
  }
  if (verifiedOldIndex) {
    throw new Error('Verification failed: legacy index "pharmacy_1_medicine_1" still exists!');
  }

  console.log('\n=========================================');
  console.log('    STOCK INDEX MIGRATION COMPLETED      ');
  console.log('=========================================');
  console.log('Active Stock indexes:', finalIndexes.map(i => i.name).join(', '));
  console.log('✓ Branch-wise stock uniqueness constraint is now fully active.');
  console.log('=========================================\n');

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('\nMigration failed with error:', err);
  process.exit(1);
});
