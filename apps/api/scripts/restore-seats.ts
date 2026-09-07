/**
 * Puts seats back from the MongoDB copy.
 *
 *   pnpm --filter @inventory/api seats:restore                  (every seat missing here)
 *   pnpm --filter @inventory/api seats:restore -- --seat 4E173  (one seat)
 *   pnpm --filter @inventory/api seats:restore -- --dry-run     (report only)
 *
 * MongoDB holds every seat with its kit, refreshed nightly by the API. For
 * each seat in that copy that is gone from PostgreSQL - deleted outright or
 * archived - this recreates (or un-archives) the seat with its wing, process,
 * chair and gaps, then puts its equipment back: an archived item is restored
 * and re-allocated, a missing one is created again with the same tag, model
 * and serial. Seats that are present and complete are left alone. Nothing
 * is ever removed.
 */
import './load-env';
import {
  AllocationHolderType, AllocationStatus, AssetCondition, AssetEventType,
  AssetStatus, AuditAction, LocationKind, PrismaClient, SourceType, WorkstationStatus,
} from '@prisma/client';
import { MongoClient } from 'mongodb';
import { DEFAULT_MONGO_DB, DEFAULT_MONGO_URI } from '../src/modules/backup/mongo-mirror';
import { unmangleSeatCode } from '../src/modules/sync/transform';

const prisma = new PrismaClient();

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const DRY = process.argv.includes('--dry-run');
const ONLY = arg('seat')?.trim().toUpperCase();
const URI = arg('uri') ?? process.env.MONGODB_URI ?? DEFAULT_MONGO_URI;
const DB = arg('db') ?? process.env.MONGODB_DB ?? DEFAULT_MONGO_DB;

interface SeatDoc {
  seatCode: string;
  branch?: string | null;
  wing?: string | null;
  process?: string | null;
  chair?: string | null;
  missing?: string[];
  notes?: string | null;
  hasDesktop?: boolean;
  hasPhone?: boolean;
  status?: string;
  equipment?: Array<{
    assetTag: string; category: string; model?: string | null; serialNumber?: string | null;
  }>;
}

const counts: Record<string, number> = {};
const bump = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };

async function main(): Promise<void> {
  const mongo = new MongoClient(URI);
  await mongo.connect();
  const all = (await mongo
    .db(DB)
    .collection<SeatDoc>('workstations')
    .find({})
    .sort({ seatCode: 1 })
    .toArray()) as SeatDoc[];
  await mongo.close();

  // Seat codes as they should read. An older copy may hold "4e+173" beside
  // "4E173" from a later one; the proper code wins and the other is ignored.
  const byCode = new Map<string, SeatDoc>();
  for (const d of all) {
    const code = unmangleSeatCode(d.seatCode);
    const prev = byCode.get(code);
    if (!prev || (prev.seatCode !== code && d.seatCode === code)) byCode.set(code, { ...d, seatCode: code });
  }
  const docs = [...byCode.values()].filter((d) => !ONLY || d.seatCode === ONLY);

  if (docs.length === 0) {
    console.log(ONLY ? `MongoDB has no seat ${ONLY}.` : 'MongoDB holds no seats yet - run mirror:mongo first.');
    return;
  }
  console.log(`${docs.length} seat(s) in the MongoDB copy${DRY ? '   DRY RUN - nothing will be written' : ''}`);

  const branch =
    (await prisma.branch.findFirst({ where: { code: 'CCC' } })) ??
    (await prisma.branch.findFirst({}));
  if (!branch) throw new Error('No branch in the database. Run the seed first.');

  for (const doc of docs) {
    const seat = doc.seatCode;
    // Includes archived seats: the extended client hides those, the raw one does not.
    const existing = await prisma.workstation.findFirst({
      where: { branchId: branch.id, seatCode: seat },
    });

    let stationId: string | null = existing?.id ?? null;
    if (existing && !existing.deletedAt) {
      // Present; only its kit may need attention.
    } else if (existing) {
      console.log(`${seat}: archived -> restoring`);
      bump('seatsRestored');
      if (!DRY) {
        await prisma.workstation.update({
          where: { id: existing.id },
          data: { deletedAt: null, deletedById: null, isActive: true },
        });
      }
    } else {
      console.log(`${seat}: missing -> recreating in ${doc.wing ?? 'no wing'}`);
      bump('seatsCreated');
      if (!DRY) {
        const locationId = doc.wing ? await wingLocation(branch.id, doc.wing) : null;
        const notes = doc.notes ?? [
          doc.process ? `Process: ${doc.process}` : '',
          doc.chair ? `Chair: ${doc.chair}` : '',
          doc.missing?.length ? `Missing: ${doc.missing.join(', ')}` : '',
        ].filter(Boolean).join(' | ');
        const created = await prisma.workstation.create({
          data: {
            branchId: branch.id,
            locationId,
            seatCode: seat,
            status: (doc.status as WorkstationStatus) ?? WorkstationStatus.AVAILABLE,
            hasDesktop: doc.hasDesktop ?? false,
            hasPhone: doc.hasPhone ?? false,
            notes: notes || null,
          },
        });
        stationId = created.id;
      }
    }

    for (const item of doc.equipment ?? []) {
      await restoreItem(seat, stationId, branch.id, item);
    }
  }

  if (!DRY && Object.keys(counts).length) {
    await prisma.auditLog.create({
      data: {
        action: AuditAction.RESTORE,
        entityType: 'Workstation',
        entityLabel: ONLY ?? 'floor',
        userName: 'Seat restore (CLI)',
        summary: `Seats put back from the MongoDB copy: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`,
      },
    });
  }

  console.log(Object.keys(counts).length
    ? `\nDone: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`
    : '\nNothing to restore: every seat in the copy is present with its kit.');
}

const wings = new Map<string, string>();
async function wingLocation(branchId: string, wing: string): Promise<string> {
  const hit = wings.get(wing);
  if (hit) return hit;
  const code = wing.toUpperCase().replace(/\s+/g, '-');
  const found =
    (await prisma.location.findFirst({ where: { branchId, code } })) ??
    (await prisma.location.create({
      data: { branchId, kind: LocationKind.WING, code, name: wing, path: `CCC/${code}`, depth: 1 },
    }));
  wings.set(wing, found.id);
  return found.id;
}

const categories = new Map<string, string>();
async function categoryFor(name: string): Promise<string> {
  const hit = categories.get(name);
  if (hit) return hit;
  const code = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 12);
  const found =
    (await prisma.assetCategory.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })) ??
    (await prisma.assetCategory.create({ data: { code, name, tagPrefix: code.slice(0, 4) } }));
  categories.set(name, found.id);
  return found.id;
}

async function restoreItem(
  seat: string,
  stationId: string | null,
  branchId: string,
  item: NonNullable<SeatDoc['equipment']>[number],
): Promise<void> {
  const asset = await prisma.asset.findFirst({ where: { assetTag: item.assetTag } });

  if (asset && !asset.deletedAt) {
    const active = await prisma.assetAllocation.findFirst({
      where: { assetId: asset.id, status: AllocationStatus.ACTIVE, deletedAt: null },
    });
    if (active && active.holderType === AllocationHolderType.WORKSTATION && active.holderRefId === stationId) {
      return; // present and in place
    }
    if (active) {
      console.log(`  ${item.category} ${item.assetTag}: now held elsewhere (${active.holderLabel ?? active.holderType}) - left as is`);
      bump('itemsHeldElsewhere');
      return;
    }
    console.log(`  ${item.category} ${item.assetTag}: unallocated -> back at ${seat}`);
    bump('itemsReallocated');
    if (!DRY && stationId) await allocate(asset.id, stationId, seat);
    return;
  }

  if (asset) {
    console.log(`  ${item.category} ${item.assetTag}: archived -> restoring to ${seat}`);
    bump('itemsRestored');
    if (DRY || !stationId) return;
    await prisma.asset.update({
      where: { id: asset.id },
      data: { deletedAt: null, deletedById: null, status: AssetStatus.ALLOCATED },
    });
    await prisma.assetEvent.create({
      data: {
        assetId: asset.id, eventType: AssetEventType.RESTORED,
        summary: `Restored from the MongoDB copy to station ${seat}`, actorName: 'Seat restore',
      },
    });
    await allocate(asset.id, stationId, seat);
    return;
  }

  console.log(`  ${item.category} ${item.assetTag}: missing -> recreating at ${seat}`);
  bump('itemsCreated');
  if (DRY || !stationId) return;
  const created = await prisma.asset.create({
    data: {
      assetTag: item.assetTag,
      categoryId: await categoryFor(item.category),
      model: item.model ?? null,
      serialNumber: item.serialNumber ?? null,
      status: AssetStatus.ALLOCATED,
      condition: AssetCondition.GOOD,
      branchId,
      notes: `${item.category} at station ${seat} (restored from the MongoDB copy)`,
      sourceType: SourceType.MANUAL,
      sourceRef: `mongo-restore:${seat}:${item.assetTag}`,
    },
  });
  await prisma.assetEvent.create({
    data: {
      assetId: created.id, eventType: AssetEventType.RESTORED,
      summary: `Recreated from the MongoDB copy at station ${seat}`, actorName: 'Seat restore',
    },
  });
  await allocate(created.id, stationId, seat);
}

async function allocate(assetId: string, stationId: string, seat: string): Promise<void> {
  const allocation = await prisma.assetAllocation.create({
    data: {
      assetId,
      holderType: AllocationHolderType.WORKSTATION,
      holderRefId: stationId,
      holderLabel: `Station ${seat}`,
      status: AllocationStatus.ACTIVE,
      allocatedAt: new Date(),
      conditionOut: AssetCondition.GOOD,
      remarks: 'Put back from the MongoDB copy',
      sourceType: SourceType.MANUAL,
      sourceRef: `mongo-restore:${seat}`,
    },
  });
  await prisma.asset.update({
    where: { id: assetId },
    data: { currentAllocationId: allocation.id, status: AssetStatus.ALLOCATED },
  });
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
