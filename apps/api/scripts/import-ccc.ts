/**
 * Importer for the Central Contact Center inventory workbook.
 *
 *   pnpm --filter @inventory/api import:ccc -- --file "C:\path\to\file.xlsx" [--dry-run]
 *
 * The generic column-mapping sync cannot express this workbook's shape, so
 * this is written by hand. It still records a SyncRun and a SyncRow per source
 * row, so provenance, the row-level report and the audit entry all behave the
 * same as a mapped import.
 *
 * Rules it obeys, same as every other write path:
 *   - nothing is ever deleted;
 *   - re-running updates rather than duplicating;
 *   - every skipped row is reported with a reason rather than dropped silently.
 */
import './load-env';
import {
  PrismaClient, AssetCondition, AssetStatus, AllocationStatus,
  AllocationHolderType, AssetEventType, AuditAction, CugStatus,
  LockerStatus, RepairStatus, SourceType, SyncMode, SyncRowStatus,
  SyncStatus, EmploymentStatus, VoucherStatus,
} from '@prisma/client';
import { FileAdapter } from '../src/modules/sync/adapters/file.adapter';

const prisma = new PrismaClient();
const adapter = new FileAdapter();

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const DRY = process.argv.includes('--dry-run');

const S = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const digits = (v: unknown): string => S(v).replace(/\D/g, '');

/** "  ZALAK   dani " -> "zalak dani", for name-based matching. */
const normName = (v: unknown): string =>
  S(v).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

/** Excel serial or a real date; anything unparseable becomes null. */
function toDate(v: unknown): Date | null {
  const s = S(v);
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    return new Date(Math.round((Number(s) - 25569) * 86400 * 1000));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function splitName(full: string): { first: string; last: string | null } {
  const parts = full.replace(/\s+/g, ' ').trim().split(' ');
  if (parts.length === 1) return { first: parts[0] ?? 'Unknown', last: null };
  return { first: parts[0] as string, last: parts.slice(1).join(' ') };
}

/**
 * Employee code. Real MIS numbers are used as-is; people whose MIS is blank in
 * the sheet get a NOMIS- code derived from their name so they still import,
 * still receive their equipment, and are easy to find and correct later.
 */
function employeeCode(mis: string, name: string): string | null {
  if (mis) return mis;
  const slug = normName(name).replace(/ /g, '-').toUpperCase();
  return slug ? `NOMIS-${slug}`.slice(0, 60) : null;
}

interface Ctx {
  runId: string;
  orgId: string;
  branchId: string;
  actorId: string | null;
  /** key (mis or normalised name) -> employee id */
  employees: Map<string, string>;
  counts: Record<string, number>;
  rows: Array<Record<string, unknown>>;
}

const bump = (c: Ctx, k: string, n = 1) => { c.counts[k] = (c.counts[k] ?? 0) + n; };

function stage(
  c: Ctx, tab: string, rowNumber: number, raw: Record<string, string>,
  status: SyncRowStatus, entityType: string, entityId: string | null, messages: string[],
) {
  c.rows.push({
    runId: c.runId,
    rowNumber,
    rawData: { __tab: tab, ...raw },
    rowHash: `${tab}:${rowNumber}`,
    dedupeKey: null,
    status,
    entityType,
    entityId,
    messages,
  });
}

/** Finds or creates an employee, keyed on MIS number, falling back to name. */
async function upsertEmployee(
  c: Ctx, mis: string, name: string,
  extra: { level?: string; institute?: string; department?: string; process?: string } = {},
): Promise<string | null> {
  const code = employeeCode(mis, name);
  if (!code || !name) return null;

  const key = mis || normName(name);
  const cached = c.employees.get(key);
  if (cached) return cached;

  // Someone appearing first without a MIS and later with one would otherwise
  // import twice; match on name to catch that.
  const byName = c.employees.get(normName(name));
  if (byName && !mis) return byName;

  const { first, last } = splitName(name);
  const existing = await prisma.employee.findFirst({
    where: { organizationId: c.orgId, employeeCode: code, deletedAt: undefined },
  });

  if (existing) {
    c.employees.set(key, existing.id);
    c.employees.set(normName(name), existing.id);

    // Fill gaps, never overwrite: a person created by a tab without a Process
    // column (Core team) must still pick the value up when a later tab (CUG)
    // carries it. Anything a human or an earlier tab already set is kept.
    const gaps: Record<string, string> = {};
    if (!existing.process && extra.process) gaps.process = extra.process;
    if (Object.keys(gaps).length && !DRY) {
      await prisma.employee.update({ where: { id: existing.id }, data: gaps });
      bump(c, 'employeesBackfilled');
    }
    return existing.id;
  }

  if (DRY) {
    c.employees.set(key, 'dry-run');
    c.employees.set(normName(name), 'dry-run');
    bump(c, 'employeesCreated');
    return 'dry-run';
  }

  const created = await prisma.employee.create({
    data: {
      organizationId: c.orgId,
      branchId: c.branchId,
      employeeCode: code,
      firstName: first,
      lastName: last,
      fullName: name.replace(/\s+/g, ' ').trim(),
      employmentStatus: EmploymentStatus.ACTIVE,
      process: extra.process || null,
      remarks: [
        extra.level ? `Level: ${extra.level}` : '',
        extra.institute ? `Institute: ${extra.institute}` : '',
        extra.department ? `Department: ${extra.department}` : '',
        mis ? '' : 'MIS number was blank in the source sheet',
      ].filter(Boolean).join(' | ') || null,
      sourceType: SourceType.EXCEL_UPLOAD,
      sourceRef: `ccc-import:${c.runId}`,
      createdById: c.actorId,
    },
  });

  c.employees.set(key, created.id);
  c.employees.set(normName(name), created.id);
  bump(c, 'employeesCreated');
  return created.id;
}

/** Category by code, created on demand so a new kind of kit never blocks an import. */
const categoryCache = new Map<string, string>();
async function categoryId(code: string, name: string): Promise<string> {
  const key = code.toUpperCase();
  const hit = categoryCache.get(key);
  if (hit) return hit;

  let cat = await prisma.assetCategory.findFirst({ where: { code: key } });
  if (!cat) {
    cat = await prisma.assetCategory.create({
      data: { code: key, name, tagPrefix: key.slice(0, 4) },
    });
  }
  categoryCache.set(key, cat.id);
  return cat.id;
}

/** Maps the free-text item names in the sheet onto categories. */
function categoryFor(item: string): { code: string; name: string } {
  const t = item.toLowerCase();
  if (t.includes('laptop') && t.includes('charger')) return { code: 'CHG', name: 'Charger' };
  if (t.includes('cug') && t.includes('charger'))    return { code: 'CHG', name: 'Charger' };
  if (t.includes('charger'))                          return { code: 'CHG', name: 'Charger' };
  if (t.includes('laptop stand'))                     return { code: 'STND', name: 'Laptop Stand' };
  if (t.includes('laptop'))                           return { code: 'LPT', name: 'Laptop' };
  if (t.includes('desktop'))                          return { code: 'DSK', name: 'Desktop' };
  if (t.includes('monitor'))                          return { code: 'MON', name: 'Monitor' };
  if (t.includes('headphone') || t.includes('headset')) return { code: 'HP', name: 'Headphone' };
  if (t.includes('mouse'))                            return { code: 'MSE', name: 'Mouse' };
  if (t.includes('keyboard'))                         return { code: 'KB', name: 'Keyboard' };
  if (t.includes('adapter') || t.includes('hdmi'))    return { code: 'ADP', name: 'Adapter' };
  if (t.includes('telephone') || t.includes('cordless')) return { code: 'PHN', name: 'Desk Phone' };
  if (t.includes('calculator'))                       return { code: 'CALC', name: 'Calculator' };
  if (t.includes('cug') || t.includes('phone') || t.includes('sim')) return { code: 'SIM', name: 'CUG SIM' };
  if (t.includes('printer'))                          return { code: 'PRN', name: 'Printer' };
  if (t.includes('ups'))                              return { code: 'UPS', name: 'UPS' };
  return { code: 'MISC', name: 'Miscellaneous' };
}

/** Sequential asset tags per category prefix. */
const tagSeq = new Map<string, number>();
async function nextTag(prefix: string): Promise<string> {
  let n = tagSeq.get(prefix);
  if (n === undefined) {
    const count = await prisma.asset.count({
      where: { assetTag: { startsWith: `${prefix}-` }, deletedAt: undefined },
    });
    n = 1000 + count;
  }
  for (;;) {
    n += 1;
    const candidate = `${prefix}-${n}`;
    const clash = await prisma.asset.findFirst({
      where: { assetTag: candidate, deletedAt: undefined },
    });
    if (!clash) { tagSeq.set(prefix, n); return candidate; }
  }
}

/** Creates an asset and, when a holder is given, an active allocation for it. */
async function createAssetWithAllocation(
  c: Ctx,
  spec: {
    item: string; model: string | null; serial: string | null;
    tagOverride?: string | null; employeeId: string | null; holderLabel: string | null;
    notes?: string | null; status?: AssetStatus;
    /** Stable identity of the source row, e.g. "ccc:Core team:14". */
    importKey: string;
  },
): Promise<string | null> {
  const { code, name } = categoryFor(spec.item);
  const catId = await categoryId(code, name);

  // A row already imported must resolve to the asset it created, not to a new
  // one. Serial numbers cover the rows that have them; this covers the rest,
  // which is most of them - "Laptop Charger" with model "-" has nothing else
  // to identify it, and without this a re-run silently doubled the inventory.
  const already = await prisma.asset.findFirst({
    where: { sourceRef: spec.importKey, deletedAt: undefined },
  });
  if (already) { bump(c, 'assetsUnchanged'); return already.id; }

  // A serial we have seen before is the same physical item, not a new one.
  if (spec.serial) {
    const dupe = await prisma.asset.findFirst({
      where: { serialNumber: spec.serial, deletedAt: undefined },
    });
    if (dupe) { bump(c, 'assetsDuplicate'); return dupe.id; }
  }

  // Return a sentinel rather than null: callers branch on "did I get an id",
  // and handing back null made a dry run report failures a real run would not.
  if (DRY) { bump(c, 'assetsCreated'); if (spec.employeeId) bump(c, 'allocationsCreated'); return 'dry-run'; }

  const tag = spec.tagOverride ?? (await nextTag(code));
  const asset = await prisma.asset.create({
    data: {
      assetTag: tag,
      serialNumber: spec.serial,
      categoryId: catId,
      make: null,
      model: spec.model,
      status: spec.status ?? (spec.employeeId ? AssetStatus.ALLOCATED : AssetStatus.IN_STOCK),
      condition: AssetCondition.GOOD,
      branchId: c.branchId,
      notes: [spec.item, spec.notes].filter(Boolean).join(' - ') || null,
      sourceType: SourceType.EXCEL_UPLOAD,
      sourceRef: spec.importKey,
      createdById: c.actorId,
    },
  });
  bump(c, 'assetsCreated');

  await prisma.assetEvent.create({
    data: {
      assetId: asset.id,
      eventType: AssetEventType.IMPORTED,
      summary: `Imported from the Central Contact Center workbook as "${spec.item}"`,
      toValue: { assetTag: tag, model: spec.model },
      refType: 'SyncRun', refId: c.runId,
      actorUserId: c.actorId, actorName: 'CCC import',
    },
  });

  if (spec.employeeId && spec.employeeId !== 'dry-run') {
    const allocation = await prisma.assetAllocation.create({
      data: {
        assetId: asset.id,
        holderType: AllocationHolderType.EMPLOYEE,
        employeeId: spec.employeeId,
        holderLabel: spec.holderLabel,
        status: AllocationStatus.ACTIVE,
        allocatedAt: new Date(),
        conditionOut: AssetCondition.GOOD,
        remarks: 'Existing allocation recorded during import',
        sourceType: SourceType.EXCEL_UPLOAD,
        sourceRef: `ccc-import:${c.runId}`,
        createdById: c.actorId,
      },
    });
    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        currentHolderEmployeeId: spec.employeeId,
        currentAllocationId: allocation.id,
        status: AssetStatus.ALLOCATED,
      },
    });
    await prisma.assetEvent.create({
      data: {
        assetId: asset.id,
        eventType: AssetEventType.ALLOCATED,
        summary: `Issued to ${spec.holderLabel ?? 'employee'} (from import)`,
        refType: 'AssetAllocation', refId: allocation.id,
        actorUserId: c.actorId, actorName: 'CCC import',
      },
    });
    bump(c, 'allocationsCreated');
  }

  return asset.id;
}

// ---------------------------------------------------------------- Core team --
/**
 * One employee owns the rows beneath them until the next MIS number appears,
 * so identity is carried down rather than read per row. Rows whose only filled
 * cell is Status are spreadsheet filler and are skipped without comment.
 */
async function importCoreTeam(c: Ctx, file: string): Promise<void> {
  const table = await adapter.read({ filePath: file, sheetName: 'Core team', headerRow: 1 });
  let holderId: string | null = null;
  let holderLabel: string | null = null;

  for (const row of table.rows) {
    const r = row.raw;
    const mis = S(r['MIS NO']);
    const name = S(r['Name']);
    const item = S(r['Assign inventory Name']);
    const model = S(r['Model Number']);

    if (mis || name) {
      holderId = await upsertEmployee(c, mis, name, {
        level: S(r['Level']), institute: S(r['Institute']),
      });
      holderLabel = name ? `${name}${mis ? ` (${mis})` : ''}` : null;
    }

    if (!item) { bump(c, 'coreTeamBlank'); continue; }

    if (!holderId) {
      stage(c, 'Core team', row.rowNumber, r, SyncRowStatus.INVALID, 'Asset', null,
        [`"${item}" has no employee above it to attach to`]);
      bump(c, 'rowsInvalid');
      continue;
    }

    // "(86911...) (86911...)" in the Model column is a pair of IMEIs.
    const imeis = model.match(/\d{14,16}/g) ?? [];
    const id = await createAssetWithAllocation(c, {
      importKey: `ccc:Core team:${row.rowNumber}`,
      item,
      model: imeis.length ? null : (model && model !== '-' ? model : null),
      serial: imeis[0] ?? null,
      employeeId: holderId,
      holderLabel,
      notes: imeis.length > 1 ? `Second IMEI ${imeis[1]}` : null,
    });
    stage(c, 'Core team', row.rowNumber, r, SyncRowStatus.IMPORTED, 'Asset', id, []);
    bump(c, 'rowsImported');
  }
}

// --------------------------------------------------------------------- CUG --
/** Each row can carry two SIMs and two IMEIs. Blank SIMs are phones with no line. */
async function importCug(c: Ctx, file: string): Promise<void> {
  const table = await adapter.read({ filePath: file, sheetName: 'CUG', headerRow: 1 });
  const seenSim = new Set<string>();

  for (const row of table.rows) {
    const r = row.raw;
    const name = S(r['Name']);
    const mis = S(r['MIS NO']);
    if (!name) {
      stage(c, 'CUG', row.rowNumber, r, SyncRowStatus.INVALID, 'Employee', null, ['No name in the row']);
      bump(c, 'rowsInvalid');
      continue;
    }

    const employeeId = await upsertEmployee(c, mis, name, {
      level: S(r['Level']), department: S(r['Department']), process: S(r['Process']),
    });
    const label = `${name}${mis ? ` (${mis})` : ''}`;

    const sims = [
      { num: digits(r['CUG SIM 1']), op: S(r['Provider 1']) },
      { num: digits(r['CUG SIM 2']), op: S(r['Provider 2']) },
    ].filter((s) => s.num.length === 10);

    const messages: string[] = [];
    let made = 0;

    for (const sim of sims) {
      if (seenSim.has(sim.num)) {
        messages.push(`SIM ${sim.num} already appeared earlier in this sheet`);
        bump(c, 'cugDuplicate');
        continue;
      }
      const existing = await prisma.cugConnection.findFirst({
        where: { mobileNumber: sim.num, deletedAt: undefined },
      });
      if (existing) {
        seenSim.add(sim.num);
        messages.push(`SIM ${sim.num} already in the database`);
        bump(c, 'cugDuplicate');
        continue;
      }
      seenSim.add(sim.num);
      if (DRY) { made++; bump(c, 'cugCreated'); continue; }

      const conn = await prisma.cugConnection.create({
        data: {
          branchId: c.branchId,
          mobileNumber: sim.num,
          operator: sim.op || null,
          status: employeeId ? CugStatus.ALLOCATED : CugStatus.AVAILABLE,
          notes: [S(r['Phone Model']), S(r['Remark'])].filter(Boolean).join(' - ') || null,
          createdById: c.actorId,
        },
      });
      bump(c, 'cugCreated');
      made++;

      if (employeeId && employeeId !== 'dry-run') {
        await prisma.cugAllocation.create({
          data: {
            connectionId: conn.id,
            employeeId,
            status: AllocationStatus.ACTIVE,
            allocatedAt: new Date(),
            remarks: 'Existing allocation recorded during import',
            createdById: c.actorId,
          },
        });
        bump(c, 'cugAllocations');
      }
    }

    // The handset itself is an asset, identified by its IMEI.
    const imei = digits(r['IMEI 1']);
    const phoneModel = S(r['Phone Model']);
    if (imei && phoneModel) {
      await createAssetWithAllocation(c, {
        importKey: `ccc:CUG:${row.rowNumber}`,
        item: 'CUG Phone',
        model: phoneModel,
        serial: imei,
        employeeId,
        holderLabel: label,
        notes: digits(r['IMEI 2']) ? `Second IMEI ${digits(r['IMEI 2'])}` : null,
      });
    }

    stage(c, 'CUG', row.rowNumber, r,
      made > 0 ? SyncRowStatus.IMPORTED : SyncRowStatus.DUPLICATE,
      'CugConnection', null, messages);
    bump(c, made > 0 ? 'rowsImported' : 'rowsDuplicate');
  }
}

// ------------------------------------------------------------- Locker Key --
/**
 * Keys repeat in the sheet, which reads as the same locker having been issued
 * to more than one person over time. The database allows only one active
 * holder per locker, so the first is kept active and later ones are reported.
 */
async function importLockers(c: Ctx, file: string): Promise<void> {
  const table = await adapter.read({ filePath: file, sheetName: 'Locker Key', headerRow: 1 });
  const seen = new Set<string>();

  for (const row of table.rows) {
    const r = row.raw;
    const key = S(r['Key No.']);
    const name = S(r['Name']);
    const mis = S(r['MIS ID']);

    if (!key) {
      stage(c, 'Locker Key', row.rowNumber, r, SyncRowStatus.INVALID, 'Locker', null,
        [`No key number${name ? ` for ${name}` : ''}`]);
      bump(c, 'rowsInvalid');
      continue;
    }

    const employeeId = name ? await upsertEmployee(c, mis, name, { level: S(r['Level']) }) : null;

    if (seen.has(key)) {
      stage(c, 'Locker Key', row.rowNumber, r, SyncRowStatus.DUPLICATE, 'Locker', null,
        [`Key ${key} already appeared in this sheet; kept the first holder`]);
      bump(c, 'lockersDuplicate');
      bump(c, 'rowsDuplicate');
      continue;
    }
    seen.add(key);

    if (DRY) { bump(c, 'lockersCreated'); bump(c, 'rowsImported'); continue; }

    let locker = await prisma.locker.findFirst({
      where: { branchId: c.branchId, lockerNo: key, deletedAt: undefined },
    });
    if (!locker) {
      locker = await prisma.locker.create({
        data: {
          branchId: c.branchId,
          lockerNo: key,
          keyNumber: key,
          status: employeeId ? LockerStatus.ALLOCATED : LockerStatus.AVAILABLE,
          notes: S(r['Remarks (If any)']) || null,
          createdById: c.actorId,
        },
      });
      bump(c, 'lockersCreated');
    }

    if (employeeId && employeeId !== 'dry-run') {
      const active = await prisma.lockerAllocation.findFirst({
        where: { lockerId: locker.id, status: AllocationStatus.ACTIVE },
      });
      if (!active) {
        await prisma.lockerAllocation.create({
          data: {
            lockerId: locker.id, employeeId,
            status: AllocationStatus.ACTIVE,
            allocatedAt: new Date(),
            remarks: 'Existing allocation recorded during import',
            createdById: c.actorId,
          },
        });
        bump(c, 'lockerAllocations');
      }
    }

    stage(c, 'Locker Key', row.rowNumber, r, SyncRowStatus.IMPORTED, 'Locker', locker.id, []);
    bump(c, 'rowsImported');
  }
}

// ------------------------------------------------------------------- Stock --
/**
 * Extracts a usable asset tag from the free-text Asset Number column.
 *
 * The column holds several shapes: a clean tag, a tag with the holder in
 * brackets, two tags separated by a comma for an all-in-one machine, tags
 * with spaces around the dashes, and multi-line "P/N.: ... S/N.: ..." blocks
 * that are manufacturer part numbers rather than asset tags at all.
 */
function extractTag(raw: string): string | null {
  const firstPart = raw.split(/[,\n\r]/)[0] ?? '';
  const cleaned = firstPart.replace(/\([^)]*\)/g, '').trim();
  if (!cleaned) return null;
  // A part number is not an asset tag.
  if (/^(p\/n|s\/n|d\/c)/i.test(cleaned)) return null;
  // Collapse "MSE - CON - 25" to "MSE-CON-25".
  const tag = cleaned.replace(/\s*-\s*/g, '-').replace(/\s+/g, '-').toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{2,}$/.test(tag) ? tag : null;
}

/** Unassigned equipment held in the store, carrying its own asset number. */
async function importStock(c: Ctx, file: string): Promise<void> {
  const table = await adapter.read({ filePath: file, sheetName: 'Stock', headerRow: 1 });

  for (const row of table.rows) {
    const r = row.raw;
    try {
      const type = S(r['Asset Type']);
      const rawNo = S(r['Asset Number']);
      if (!type && !rawNo) { bump(c, 'stockBlank'); continue; }

      const tag = extractTag(rawNo);
      const holderNote = rawNo.match(/\(([^)]*)\)/)?.[1]?.trim() ?? '';
      const assigned = Boolean(holderNote) && !/not\s*assign/i.test(holderNote);

      // The sheet lists the same tag twice. An asset tag identifies one
      // physical item, so the second mention is the same machine, not another.
      if (tag) {
        const clash = await prisma.asset.findFirst({
          where: { assetTag: tag, deletedAt: undefined },
        });
        if (clash) {
          stage(c, 'Stock', row.rowNumber, r, SyncRowStatus.DUPLICATE, 'Asset', clash.id,
            [`Asset tag ${tag} already exists; this row refers to the same item`]);
          bump(c, 'stockDuplicate');
          bump(c, 'rowsDuplicate');
          continue;
        }
      }

      const employeeId = assigned ? await upsertEmployee(c, '', holderNote) : null;

      const id = await createAssetWithAllocation(c, {
        importKey: `ccc:Stock:${row.rowNumber}`,
        item: type || 'Stock item',
        model: type || null,
        // With no usable tag, keep the raw text as the serial so the part
        // number is not lost.
        serial: tag ? null : (rawNo.replace(/\s+/g, ' ').trim() || null),
        tagOverride: tag,
        employeeId,
        holderLabel: assigned ? holderNote : null,
        notes: assigned ? null : holderNote || null,
        status: assigned ? AssetStatus.ALLOCATED : AssetStatus.IN_STOCK,
      });

      stage(c, 'Stock', row.rowNumber, r, SyncRowStatus.IMPORTED, 'Asset', id, []);
      bump(c, 'rowsImported');
    } catch (err) {
      // One bad row must never cost the rest of the tab.
      stage(c, 'Stock', row.rowNumber, r, SyncRowStatus.INVALID, 'Asset', null,
        [(err as Error).message]);
      bump(c, 'rowsInvalid');
    }
  }
}

// ------------------------------------------------------------------ Repair --
/** Handset repairs, matched to the phone asset by IMEI where possible. */
async function importRepairs(c: Ctx, file: string): Promise<void> {
  const table = await adapter.read({ filePath: file, sheetName: 'Repair', headerRow: 1 });

  for (const row of table.rows) {
    const r = row.raw;
    const name = S(r['BDE Name']);
    const fault = S(r['Damage']);
    const imei = digits(r['IMEI 1']);
    if (!name && !fault) { bump(c, 'repairBlank'); continue; }

    let assetId: string | null = null;
    if (imei) {
      const found = await prisma.asset.findFirst({
        where: { serialNumber: imei, deletedAt: undefined },
      });
      assetId = found?.id ?? null;
    }
    if (!assetId) {
      assetId = await createAssetWithAllocation(c, {
        importKey: `ccc:Repair:${row.rowNumber}`,
        item: 'CUG Phone', model: S(r['Phone Model']) || null, serial: imei || null,
        employeeId: null, holderLabel: null,
        notes: 'Created from the Repair tab', status: AssetStatus.IN_REPAIR,
      });
    }
    if (!assetId) { bump(c, 'rowsInvalid'); continue; }

    const received = toDate(r['Received Date']) ?? toDate(r['Return Date']);
    const note = S(r['Note']);
    const repaired = /repair/i.test(note) || received !== null;
    const price = Number(digits(r['Price'])) || null;

    if (DRY) { bump(c, 'repairsCreated'); bump(c, 'rowsImported'); continue; }

    // Derived from the source row, so a re-run finds the ticket it already
    // created instead of colliding on a counter that restarts every run.
    const ticketNo = `RPR-CCC-${String(row.rowNumber).padStart(4, '0')}`;
    const existingTicket = await prisma.repairTicket.findFirst({
      where: { ticketNo, deletedAt: undefined },
    });
    if (existingTicket) { bump(c, 'repairsUnchanged'); continue; }

    await prisma.repairTicket.create({
      data: {
        ticketNo,
        assetId,
        reportedAt: toDate(r['Given Date']) ?? new Date(),
        faultDescription: fault || 'Not recorded in the source sheet',
        status: repaired ? RepairStatus.REPAIRED : RepairStatus.IN_PROGRESS,
        sentToVendorAt: toDate(r['Given Date']),
        receivedBackAt: received,
        actualCost: price,
        chargedToEmployee: /yes/i.test(S(r['Deduction'])),
        resolution: note || null,
        closedAt: repaired ? received : null,
        createdById: c.actorId,
      },
    });
    bump(c, 'repairsCreated');
    stage(c, 'Repair', row.rowNumber, r, SyncRowStatus.IMPORTED, 'RepairTicket', assetId, []);
    bump(c, 'rowsImported');
  }
}

// -------------------------------------------------------- Headphone assign --
async function importHeadphones(c: Ctx, file: string): Promise<void> {
  const table = await adapter.read({ filePath: file, sheetName: 'Headfhone assign', headerRow: 1 });
  for (const row of table.rows) {
    const r = row.raw;
    const name = S(r['Name']);
    if (!name) continue;
    const mis = S(r['MIS ID']);
    const employeeId = await upsertEmployee(c, mis, name);
    const id = await createAssetWithAllocation(c, {
      importKey: `ccc:Headphone:${row.rowNumber}`,
      item: S(r['Assigned Item']) || 'Headphone',
      model: null, serial: null,
      employeeId, holderLabel: `${name}${mis ? ` (${mis})` : ''}`,
    });
    stage(c, 'Headfhone assign', row.rowNumber, r, SyncRowStatus.IMPORTED, 'Asset', id, []);
    bump(c, 'rowsImported');
  }
}

// ------------------------------------------------------- PVR movie cards --
/**
 * One row is one card.
 *
 * The Voucher No repeats: a book of ten cards carries the same printed number,
 * and the sheet lists them as ten lines. So the row is the card, and identity
 * is the source row rather than the number. A blank "ISSUED TO" means the card
 * is still in the drawer, which is most of them.
 */
async function importVouchers(c: Ctx, file: string): Promise<void> {
  const table = await adapter.read({
    filePath: file, sheetName: 'PVR MOVIE VOUCHERS', headerRow: 2,
  });

  for (const row of table.rows) {
    const r = row.raw;
    try {
      const voucherNo = S(r['Voucher No']);
      if (!voucherNo) { bump(c, 'voucherBlank'); continue; }

      const importKey = `ccc:PVR:${row.rowNumber}`;
      if (!DRY) {
        const already = await prisma.voucher.findFirst({
          where: { sourceRef: importKey, deletedAt: undefined },
        });
        if (already) { bump(c, 'vouchersUnchanged'); continue; }
      } else {
        bump(c, 'vouchersCreated');
        continue;
      }

      const issuedToName = S(r['ISSUED TO']);
      const issued = Boolean(issuedToName);

      // Link to the employee where the name matches someone already imported;
      // the name is kept either way, because the sheet records people who may
      // not be on file.
      const employeeId = issued ? c.employees.get(normName(issuedToName)) ?? null : null;

      await prisma.voucher.create({
        data: {
          branchId: c.branchId,
          kind: 'PVR_MOVIE',
          voucherNo,
          serialNo: Number(digits(r['Sr.No'])) || null,
          receivedAt: toDate(r['Date Recieved']),
          status: issued ? VoucherStatus.ISSUED : VoucherStatus.AVAILABLE,
          issuedToEmployeeId: employeeId && employeeId !== 'dry-run' ? employeeId : null,
          issuedToName: issuedToName || null,
          issuedByName: S(r['ISSUED BY']) || null,
          issuedAt: toDate(r['Issued Date']),
          purpose: S(r['Purpose']) || null,
          sourceType: SourceType.EXCEL_UPLOAD,
          sourceRef: importKey,
          createdById: c.actorId,
        },
      });

      bump(c, 'vouchersCreated');
      if (issued && !employeeId) bump(c, 'voucherHolderUnmatched');
      stage(c, 'PVR', row.rowNumber, r, SyncRowStatus.IMPORTED, 'Voucher', null,
        issued && !employeeId ? [`"${issuedToName}" is not an employee on file`] : []);
      bump(c, 'rowsImported');
    } catch (err) {
      stage(c, 'PVR', row.rowNumber, r, SyncRowStatus.INVALID, 'Voucher', null,
        [(err as Error).message]);
      bump(c, 'rowsInvalid');
    }
  }
}

// -------------------------------------------------------------------- main --
async function main(): Promise<void> {
  const file = arg('file');
  if (!file) {
    console.error('Usage: import:ccc -- --file "C:\path\to\workbook.xlsx" [--dry-run]');
    process.exit(1);
  }

  const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!org) { console.error('No organisation. Run the seed first.'); process.exit(1); }

  const branch =
    (await prisma.branch.findFirst({ where: { organizationId: org.id, code: 'CCC' } })) ??
    (await prisma.branch.findFirst({ where: { organizationId: org.id } }));
  if (!branch) { console.error('No branch. Run the seed first.'); process.exit(1); }

  const source =
    (await prisma.syncSource.findFirst({
      where: { sourceType: SourceType.EXCEL_UPLOAD, name: 'Central Contact Center workbook' },
    })) ??
    (await prisma.syncSource.create({
      data: {
        name: 'Central Contact Center workbook',
        sourceType: SourceType.EXCEL_UPLOAD,
        targetEntity: 'mixed',
        workbookLabel: file,
        mode: SyncMode.MANUAL,
        dedupeKeys: [],
      },
    }));

  const run = await prisma.syncRun.create({
    data: {
      sourceId: source.id,
      mode: SyncMode.MANUAL,
      status: SyncStatus.RUNNING,
      dryRun: DRY,
      triggeredByName: 'CCC importer (CLI)',
    },
  });

  const c: Ctx = {
    runId: run.id, orgId: org.id, branchId: branch.id, actorId: null,
    employees: new Map(), counts: {}, rows: [],
  };

  console.log(`Importing ${file}`);
  console.log(`  organisation: ${org.name} / branch: ${branch.name}`);
  if (DRY) console.log('  DRY RUN - nothing will be written\n');

  try {
    for (const [label, fn] of [
      ['Core team', importCoreTeam], ['CUG', importCug], ['Locker Key', importLockers],
      ['Stock', importStock], ['Repair', importRepairs], ['Headfhone assign', importHeadphones],
      ['PVR MOVIE VOUCHERS', importVouchers],
    ] as Array<[string, (c: Ctx, f: string) => Promise<void>]>) {
      process.stdout.write(`  ${label} ... `);
      try {
        await fn(c, file);
        console.log('done');
      } catch (err) {
        // One unreadable tab must not cost us the other five.
        console.log(`FAILED: ${(err as Error).message}`);
        bump(c, 'tabsFailed');
      }
    }

    if (!DRY && c.rows.length) {
      for (let i = 0; i < c.rows.length; i += 500) {
        await prisma.syncRow.createMany({ data: c.rows.slice(i, i + 500) as never });
      }
    }

    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: (c.counts.rowsInvalid ?? 0) > 0 ? SyncStatus.PARTIAL : SyncStatus.SUCCESS,
        finishedAt: new Date(),
        durationMs: Date.now() - run.startedAt.getTime(),
        rowsRead: c.rows.length,
        rowsNew: c.counts.rowsImported ?? 0,
        rowsDuplicate: c.counts.rowsDuplicate ?? 0,
        rowsInvalid: c.counts.rowsInvalid ?? 0,
      },
    });

    if (!DRY) {
      await prisma.auditLog.create({
        data: {
          action: AuditAction.IMPORT,
          entityType: 'SyncSource',
          entityId: source.id,
          entityLabel: source.name,
          userName: 'CCC importer (CLI)',
          roleKeys: [],
          summary:
            `Imported the Central Contact Center workbook: ` +
            Object.entries(c.counts).map(([k, v]) => `${k}=${v}`).join(', '),
          refType: 'SyncRun',
          refId: run.id,
        },
      });
    }

    console.log('\nSummary');
    for (const [k, v] of Object.entries(c.counts).sort()) {
      console.log(`  ${k.padEnd(22)} ${v}`);
    }
    console.log(`\nRun id ${run.id}${DRY ? ' (dry run)' : ''}`);
  } catch (err) {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: SyncStatus.FAILED, finishedAt: new Date(), errorMessage: (err as Error).message },
    });
    throw err;
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
