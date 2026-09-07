/**
 * The MongoDB mirror: every record the sheets gave us, as cleaned and
 * structured in PostgreSQL, copied into MongoDB as one collection per entity.
 *
 * This is the standing backup. The website runs on PostgreSQL; MongoDB holds
 * a complete second copy that a deletion on the website cannot touch, so a
 * seat (or anything else) that goes missing can be put back from here -
 * see scripts/restore-seats.ts.
 *
 * It reads from PostgreSQL rather than re-parsing the sheets on purpose:
 * the database already holds their content with every correction applied
 * - duplicates merged, fake holders removed, statuses restated, teams
 * marked. The raw sheet rows, exactly as last read, go in too, under
 * `sheetRows`, so nothing the sheets said is ever lost either.
 *
 * Documents are shaped the document-database way: an employee embeds what
 * they hold; a seat embeds its kit. Upserts key on natural ids, so every run
 * refreshes rather than duplicates. Used by the nightly scheduler and by
 * `pnpm --filter @inventory/api mirror:mongo`.
 */
import type { PrismaClient } from '@prisma/client';
import { MongoClient } from 'mongodb';

export interface MirrorOptions {
  uri?: string;
  db?: string;
  log?: (line: string) => void;
}

export interface MirrorResult {
  uri: string;
  db: string;
  counts: Record<string, number>;
  /** Collections whose document count did not match what was written. */
  mismatches: string[];
  durationMs: number;
}

export const DEFAULT_MONGO_URI = 'mongodb://localhost:27017';
export const DEFAULT_MONGO_DB = 'inventory';

const seatField = (notes: string | null, key: string) =>
  notes?.match(new RegExp(`${key}:\\s*([^|]+)`))?.[1]?.trim() ?? null;

export async function mirrorToMongo(
  prisma: PrismaClient,
  opts: MirrorOptions = {},
): Promise<MirrorResult> {
  const uri = opts.uri ?? process.env.MONGODB_URI ?? DEFAULT_MONGO_URI;
  const dbName = opts.db ?? process.env.MONGODB_DB ?? DEFAULT_MONGO_DB;
  const log = opts.log ?? (() => undefined);
  const started = Date.now();

  const mongo = new MongoClient(uri);
  await mongo.connect();
  const db = mongo.db(dbName);
  log(`Connected to ${uri.replace(/\/\/[^@]*@/, '//<credentials>@')} / db "${dbName}"`);

  const counts: Record<string, number> = {};
  const now = new Date();

  try {
    // ---------------------------------------------------------- employees --
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
            level: e.level,
            email: e.officialEmail,
            phone: e.phone,
            team: e.department?.name ?? null,
            process: e.process,
            designation: null,
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
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    }
    counts.employees = employees.length;

    // ------------------------------------------------------------- assets --
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
                  type: holder.holderType,
                  name: holder.employee?.fullName ?? holder.holderLabel,
                  employeeCode: holder.employee?.employeeCode ?? null,
                  since: holder.allocatedAt,
                }
              : null,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    }
    counts.assets = assets.length;

    // ------------------------------------------------------- workstations --
    // A seat carries its own kit here, so a deleted seat can be rebuilt from
    // this one document alone.
    const stations = await prisma.workstation.findMany({
      where: { deletedAt: null },
      include: { location: { select: { name: true } }, branch: { select: { code: true } } },
    });
    const kit = await prisma.assetAllocation.findMany({
      where: { holderType: 'WORKSTATION', status: 'ACTIVE', deletedAt: null },
      include: { asset: { include: { category: { select: { name: true } } } } },
    });
    const kitByStation = new Map<string, typeof kit>();
    for (const k of kit) {
      if (!k.holderRefId) continue;
      kitByStation.set(k.holderRefId, [...(kitByStation.get(k.holderRefId) ?? []), k]);
    }
    const stationCol = db.collection('workstations');
    // Codes a spreadsheet once turned into numbers ("4e+173") are junk here;
    // the real seat is stored under its proper code.
    await stationCol.deleteMany({ seatCode: /^\d[eE]\+\d{3}$/ });
    for (const w of stations) {
      await stationCol.updateOne(
        { seatCode: w.seatCode },
        {
          $set: {
            seatCode: w.seatCode,
            present: true,
            lastSeenAt: now,
            branch: w.branch.code,
            wing: w.location?.name ?? null,
            process: seatField(w.notes, 'Process'),
            chair: seatField(w.notes, 'Chair'),
            missing: seatField(w.notes, 'Missing')?.split(/,\s*/) ?? [],
            notes: w.notes,
            hasDesktop: w.hasDesktop,
            hasPhone: w.hasPhone,
            status: w.status,
            equipment: (kitByStation.get(w.id) ?? []).map((k) => ({
              assetTag: k.asset.assetTag,
              category: k.asset.category.name,
              model: k.asset.model,
              serialNumber: k.asset.serialNumber,
              since: k.allocatedAt,
            })),
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    }
    // A seat no longer in PostgreSQL stays in the copy - that is the point -
    // but is marked so the restore knows it is the one to put back.
    await stationCol.updateMany(
      { lastSeenAt: { $ne: now } },
      { $set: { present: false } },
    );
    counts.workstations = stations.length;

    // ---------------------------------------------------------------- cug --
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
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    }
    counts.cugConnections = cug.length;

    // ------------------------------------------------------------ lockers --
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
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    }
    counts.lockers = lockers.length;

    // ------------------------------------------------------------ repairs --
    const repairs = await prisma.repairTicket.findMany({
      where: { deletedAt: null },
      include: { asset: { select: { assetTag: true, model: true, serialNumber: true } } },
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
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    }
    counts.repairTickets = repairs.length;

    // ----------------------------------------------------------- vouchers --
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
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    }
    counts.pvrCards = vouchers.length;

    // --------------------------------------------------------- sheet rows --
    // The sheets verbatim: every row of the latest read of each source, as
    // the cells were. This is the copy of the sheets themselves.
    // Rewritten whole each run: it is a copy of the latest read, and a row
    // number repeats across the tabs of one workbook, so the tab is part of
    // the identity.
    const sources = await prisma.syncSource.findMany({ where: { deletedAt: null } });
    const rowCol = db.collection('sheetRows');
    const sheetDocs: Record<string, unknown>[] = [];
    for (const s of sources) {
      const run = await prisma.syncRun.findFirst({
        where: { sourceId: s.id, dryRun: false, status: { in: ['SUCCESS', 'PARTIAL'] } },
        orderBy: { startedAt: 'desc' },
      });
      if (!run) continue;
      const rows = await prisma.syncRow.findMany({
        where: { runId: run.id },
        select: { rowNumber: true, rawData: true, status: true, dedupeKey: true },
      });
      for (const r of rows) {
        const cells = (r.rawData ?? {}) as Record<string, unknown>;
        sheetDocs.push({
          source: s.name,
          workbook: s.workbookLabel,
          tab: typeof cells.__tab === 'string' ? cells.__tab : null,
          targetEntity: s.targetEntity,
          readAt: run.startedAt,
          rowNumber: r.rowNumber,
          key: r.dedupeKey,
          outcome: r.status,
          cells,
          updatedAt: now,
        });
      }
    }
    await rowCol.deleteMany({});
    if (sheetDocs.length) await rowCol.insertMany(sheetDocs);
    counts.sheetRows = sheetDocs.length;

    // ----------------------------------------------------------- metadata --
    await db.collection('meta').updateOne(
      { _id: 'export' as never },
      {
        $set: {
          exportedAt: now,
          source:
            'PostgreSQL master database (the cleaned form of the Wing Wise and ' +
            'Central Contact Center workbooks), plus the sheets\' rows verbatim',
          counts,
        },
      },
      { upsert: true },
    );

    log('Stored in MongoDB, one collection per entity:');
    for (const [k, v] of Object.entries(counts)) log(`  ${k.padEnd(16)} ${v}`);

    // A sheetRows document is keyed per source row, so the verbatim copy is
    // checked by count as well.
    const mismatches: string[] = [];
    for (const k of Object.keys(counts)) {
      const n = await db.collection(k).countDocuments();
      if (n < counts[k]!) mismatches.push(`${k} (mongo has ${n}, wrote ${counts[k]})`);
    }
    log(mismatches.length ? `Mismatch: ${mismatches.join('; ')}` : 'Verified: every collection holds what was written.');

    return { uri, db: dbName, counts, mismatches, durationMs: Date.now() - started };
  } finally {
    await mongo.close();
  }
}
