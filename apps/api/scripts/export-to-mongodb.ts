/**
 * Loads every record from the sheets - as cleaned and structured in
 * PostgreSQL - into MongoDB as one collection per entity.
 *
 *   pnpm --filter @inventory/api export:mongo                    (local MongoDB)
 *   pnpm --filter @inventory/api export:mongo -- --uri "mongodb+srv://..."   (Atlas)
 *
 * It reads from PostgreSQL rather than re-parsing the Excel files on purpose:
 * the database already holds the sheets' content with every correction applied
 * - duplicates merged, fake holders removed, scrap/repair statuses restated,
 * teams marked. Re-reading the raw files would resurrect all of that.
 *
 * Documents are shaped the document-database way: an employee embeds what
 * they currently hold; an asset embeds who holds it. Upserts key on natural
 * ids, so re-running refreshes rather than duplicates.
 */
import './load-env';
import { PrismaClient } from '@prisma/client';
import { MongoClient } from 'mongodb';

const prisma = new PrismaClient();

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const URI = arg('uri') ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017';
const DB = arg('db') ?? 'inventory';

async function main(): Promise<void> {
  const mongo = new MongoClient(URI);
  await mongo.connect();
  const db = mongo.db(DB);
  console.log(`Connected to ${URI.replace(/\/\/[^@]*@/, '//<credentials>@')} / db "${DB}"`);

  const counts: Record<string, number> = {};

  // ------------------------------------------------------------ employees --
  const employees = await prisma.employee.findMany({
    where: { deletedAt: null },
    include: {
      branch: { select: { name: true } },
      department: { select: { name: true } },
      allocations: {
        where: { status: 'ACTIVE' },
        include: { asset: { include: { category: { select: { name: true } } } } },
      },
      cugAllocations: {
        where: { status: 'ACTIVE' },
        include: { connection: { select: { mobileNumber: true, operator: true } } },
      },
      lockerAllocations: {
        where: { status: 'ACTIVE' },
        include: { locker: { select: { lockerNo: true } } },
      },
    },
  });

  const empCol = db.collection('employees');
  for (const e of employees) {
    await empCol.updateOne(
      { employeeCode: e.employeeCode },
      {
        $set: {
          employeeCode: e.employeeCode,
          fullName: e.fullName,
          email: e.officialEmail,
          phone: e.phone,
          team: e.department?.name ?? null,
          process: e.process,
          branch: e.branch?.name ?? null,
          status: e.employmentStatus,
          remarks: e.remarks,
          equipment: e.allocations.map((a) => ({
            assetTag: a.asset.assetTag,
            category: a.asset.category.name,
            model: a.asset.model,
            serialNumber: a.asset.serialNumber,
            heldSince: a.allocatedAt,
          })),
          cugLines: e.cugAllocations.map((c) => ({
            mobileNumber: c.connection.mobileNumber,
            operator: c.connection.operator,
          })),
          lockers: e.lockerAllocations.map((l) => l.locker.lockerNo),
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
  counts.employees = employees.length;

  // --------------------------------------------------------------- assets --
  const assets = await prisma.asset.findMany({
    where: { deletedAt: null },
    include: {
      category: { select: { name: true } },
      branch: { select: { name: true } },
      location: { select: { name: true } },
      allocations: {
        where: { status: 'ACTIVE' },
        include: { employee: { select: { fullName: true, employeeCode: true } } },
      },
    },
  });
  const assetCol = db.collection('assets');
  for (const a of assets) {
    const holder = a.allocations[0];
    await assetCol.updateOne(
      { assetTag: a.assetTag },
      {
        $set: {
          assetTag: a.assetTag,
          serialNumber: a.serialNumber,
          category: a.category.name,
          make: a.make,
          model: a.model,
          status: a.status,
          condition: a.condition,
          branch: a.branch?.name ?? null,
          wing: a.location?.name ?? null,
          notes: a.notes,
          heldBy: holder
            ? {
                name: holder.employee?.fullName ?? holder.holderLabel,
                employeeCode: holder.employee?.employeeCode ?? null,
                since: holder.allocatedAt,
              }
            : null,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
  counts.assets = assets.length;

  // --------------------------------------------------------- workstations --
  const stations = await prisma.workstation.findMany({
    where: { deletedAt: null },
    include: { location: { select: { name: true } } },
  });
  const stationCol = db.collection('workstations');
  for (const w of stations) {
    await stationCol.updateOne(
      { seatCode: w.seatCode },
      {
        $set: {
          seatCode: w.seatCode,
          wing: w.location?.name ?? null,
          process: w.notes?.match(/Process:\s*([^|]+)/)?.[1]?.trim() ?? null,
          chair: w.notes?.match(/Chair:\s*([^|]+)/)?.[1]?.trim() ?? null,
          missing:
            w.notes?.match(/Missing:\s*([^|]+)/)?.[1]?.trim().split(/,\s*/) ?? [],
          hasDesktop: w.hasDesktop,
          status: w.status,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
  counts.workstations = stations.length;

  // ---------------------------------------------------------------- cug ----
  const cug = await prisma.cugConnection.findMany({
    where: { deletedAt: null },
    include: {
      allocations: {
        where: { status: 'ACTIVE' },
        include: { employee: { select: { fullName: true, employeeCode: true } } },
      },
    },
  });
  const cugCol = db.collection('cugConnections');
  for (const c of cug) {
    const holder = c.allocations[0]?.employee;
    await cugCol.updateOne(
      { mobileNumber: c.mobileNumber },
      {
        $set: {
          mobileNumber: c.mobileNumber,
          operator: c.operator,
          status: c.status,
          notes: c.notes,
          heldBy: holder ? { name: holder.fullName, employeeCode: holder.employeeCode } : null,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
  counts.cugConnections = cug.length;

  // -------------------------------------------------------------- lockers --
  const lockers = await prisma.locker.findMany({
    where: { deletedAt: null },
    include: {
      allocations: {
        where: { status: 'ACTIVE' },
        include: { employee: { select: { fullName: true, employeeCode: true } } },
      },
    },
  });
  const lockerCol = db.collection('lockers');
  for (const l of lockers) {
    const holder = l.allocations[0];
    await lockerCol.updateOne(
      { lockerNo: l.lockerNo },
      {
        $set: {
          lockerNo: l.lockerNo,
          keyNumber: l.keyNumber,
          status: l.status,
          notes: l.notes,
          heldBy: holder?.employee
            ? {
                name: holder.employee.fullName,
                employeeCode: holder.employee.employeeCode,
                keyIssued: holder.keyIssued,
              }
            : null,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
  counts.lockers = lockers.length;

  // -------------------------------------------------------------- repairs --
  const repairs = await prisma.repairTicket.findMany({
    where: { deletedAt: null },
    include: {
      asset: { select: { assetTag: true, model: true, serialNumber: true } },
    },
  });
  const repairCol = db.collection('repairTickets');
  for (const r of repairs) {
    await repairCol.updateOne(
      { ticketNo: r.ticketNo },
      {
        $set: {
          ticketNo: r.ticketNo,
          asset: {
            assetTag: r.asset.assetTag,
            model: r.asset.model,
            serialNumber: r.asset.serialNumber,
          },
          fault: r.faultDescription,
          status: r.status,
          reportedAt: r.reportedAt,
          receivedBackAt: r.receivedBackAt,
          cost: r.actualCost ? Number(r.actualCost) : null,
          chargedToEmployee: r.chargedToEmployee,
          resolution: r.resolution,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
  counts.repairTickets = repairs.length;

  // ------------------------------------------------------------- vouchers --
  const vouchers = await prisma.voucher.findMany({
    where: { deletedAt: null },
    include: { issuedTo: { select: { fullName: true, employeeCode: true } } },
  });
  const voucherCol = db.collection('pvrCards');
  for (const v of vouchers) {
    await voucherCol.updateOne(
      { voucherNo: v.voucherNo, serialNo: v.serialNo },
      {
        $set: {
          voucherNo: v.voucherNo,
          serialNo: v.serialNo,
          status: v.status,
          receivedAt: v.receivedAt,
          issuedAt: v.issuedAt,
          issuedTo: v.issuedTo
            ? { name: v.issuedTo.fullName, employeeCode: v.issuedTo.employeeCode }
            : v.issuedToName
              ? { name: v.issuedToName, employeeCode: null }
              : null,
          purpose: v.purpose,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
  counts.pvrCards = vouchers.length;

  // ------------------------------------------------------------ metadata ---
  await db.collection('meta').updateOne(
    { _id: 'export' as never },
    {
      $set: {
        exportedAt: new Date(),
        source:
          'PostgreSQL master database (the cleaned form of the Wing Wise and ' +
          'Central Contact Center workbooks)',
        counts,
      },
    },
    { upsert: true },
  );

  console.log('\nStored in MongoDB, one collection per entity:');
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(16)} ${v}`);
  }

  console.log('\nVerifying by counting what MongoDB now holds:');
  for (const k of Object.keys(counts)) {
    const col = k === 'pvrCards' ? 'pvrCards' : k;
    const n = await db.collection(col).countDocuments();
    const ok = n === counts[k] ? 'ok' : `MISMATCH (mongo has ${n})`;
    console.log(`  ${col.padEnd(16)} ${ok}`);
  }

  await mongo.close();
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
