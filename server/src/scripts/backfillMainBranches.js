import 'dotenv/config';
import mongoose from 'mongoose';
import { Branch } from '../models/index.js';
import { backfillAllPharmaciesMainBranches } from '../services/branchService.js';

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('Error: MONGO_URI environment variable is required.');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('Connected to MongoDB.');

  console.log('Ensuring Branch indexes (including 2dsphere and partial unique isMain index)...');
  await Branch.syncIndexes();
  console.log('Indexes synchronized.');

  console.log('\nRunning Main Branch provisioning and Stock/Reservation backfill...');
  const report = await backfillAllPharmaciesMainBranches();

  console.log('\n=========================================');
  console.log('       MAIN BRANCH BACKFILL REPORT       ');
  console.log('=========================================');
  console.log(`Total Pharmacies Inspected: ${report.totalPharmacies}`);
  console.log(`Main Branches Created:      ${report.mainBranchesCreated}`);
  console.log(`Main Branches Existing:     ${report.mainBranchesExisting}`);
  console.log(`Total Stock Records Linked: ${report.totalStocksLinked}`);
  console.log(`Total Reservations Linked:  ${report.totalReservationsLinked}`);

  if (report.skipped.length > 0) {
    console.log('\nWARNING: The following pharmacies could not be provisioned due to invalid/missing coordinates:');
    report.skipped.forEach(s => {
      console.log(` - [${s.pharmacyId}] "${s.name}": ${s.reason}`);
    });
  } else {
    console.log('\nAll pharmacies were successfully verified and provisioned with a Main Branch.');
  }
  console.log('=========================================\n');

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB.');
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
