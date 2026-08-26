import { Injectable } from '@nestjs/common';
import {
  AssetCondition,
  AssetEventType,
  AssetStatus,
  SourceType,
} from '@prisma/client';
import {
  EntityWriter,
  ExistingRecord,
  Tx,
  WriteContext,
  buildDedupeKey,
} from './entity-writer';

const MANAGED = [
  'assetTag', 'serialNumber', 'make', 'model', 'status', 'condition',
  'purchaseDate', 'purchaseCost', 'warrantyEndsAt', 'notes', 'locationId',
  'branchId', 'categoryId',
] as const;

/**
 * Imports physical assets: laptops, headsets, monitors, chairs, anything with
 * a serial number or an asset tag.
 *
 * Allocation is deliberately NOT set here. An imported "assigned to" column
 * creates an allocation through AllocationService so that the asset timeline
 * and the one-active-allocation rule both hold, rather than being written
 * straight into the assets table.
 */
@Injectable()
export class AssetWriter implements EntityWriter {
  readonly entity = 'asset';
  readonly defaultDedupeKeys = ['serialNumber'];

  validate(row: Record<string, unknown>): string[] {
    const errors: string[] = [];
    const serial = String(row.serialNumber ?? '').trim();
    const tag = String(row.assetTag ?? '').trim();

    if (!serial && !tag) {
      errors.push('Row has neither a serial number nor an asset tag, so it cannot be identified');
    }
    if (!row.categoryId && !row.categoryCode) {
      errors.push('Asset category is missing');
    }
    return errors;
  }

  dedupeKey(row: Record<string, unknown>, keys: string[]): string | null {
    const chosen = keys.length ? keys : this.defaultDedupeKeys;
    const key = buildDedupeKey(row, chosen);
    // Fall back to the asset tag when the sheet has no serial number.
    return key ?? buildDedupeKey(row, ['assetTag']);
  }

  async findExisting(tx: Tx, dedupeKey: string): Promise<ExistingRecord | null> {
    const value = dedupeKey.split('|')[0] ?? '';
    const found = await tx.asset.findFirst({
      where: {
        OR: [
          { serialNumber: { equals: value, mode: 'insensitive' } },
          { assetTag: { equals: value, mode: 'insensitive' } },
        ],
        // Match archived assets too - an asset tag is never reused, so a
        // returning row must attach to the original record and its history.
        deletedAt: undefined,
      },
    });
    if (!found) return null;

    const snapshot: Record<string, unknown> = {};
    for (const f of MANAGED) snapshot[f] = (found as Record<string, unknown>)[f];

    return {
      id: found.id,
      label: `${found.assetTag}${found.model ? ` (${found.model})` : ''}`,
      snapshot,
      updatedById: found.updatedById,
      updatedAt: found.updatedAt,
    };
  }

  async create(tx: Tx, row: Record<string, unknown>, ctx: WriteContext) {
    const categoryId = await this.resolveCategory(tx, row);
    const assetTag =
      (row.assetTag as string) ?? (await this.generateTag(tx, categoryId));

    const created = await tx.asset.create({
      data: {
        assetTag,
        serialNumber: (row.serialNumber as string) ?? null,
        categoryId,
        make: (row.make as string) ?? null,
        model: (row.model as string) ?? null,
        specs: (row.specs as object) ?? {},
        status: (row.status as AssetStatus) ?? AssetStatus.IN_STOCK,
        condition: (row.condition as AssetCondition) ?? AssetCondition.UNKNOWN,
        branchId: (row.branchId as string) ?? ctx.defaultBranchId,
        locationId: (row.locationId as string) ?? null,
        purchaseDate: (row.purchaseDate as Date) ?? null,
        purchaseCost: (row.purchaseCost as number) ?? null,
        warrantyEndsAt: (row.warrantyEndsAt as Date) ?? null,
        notes: (row.notes as string) ?? null,
        sourceType: SourceType.GOOGLE_SHEET,
        sourceRef: ctx.sourceRef,
        createdById: ctx.actorUserId,
      },
    });

    // Every asset starts its permanent timeline at import.
    await tx.assetEvent.create({
      data: {
        assetId: created.id,
        eventType: AssetEventType.IMPORTED,
        summary: `Imported from ${ctx.sourceRef}`,
        toValue: { assetTag: created.assetTag, serialNumber: created.serialNumber },
        refType: 'SyncRun',
        refId: ctx.runId,
        actorUserId: ctx.actorUserId,
        actorName: 'Sheet import',
      },
    });

    return { id: created.id, label: `${created.assetTag}` };
  }

  async update(
    tx: Tx,
    existing: ExistingRecord,
    safeFields: Record<string, unknown>,
    ctx: WriteContext,
  ) {
    const updated = await tx.asset.update({
      where: { id: existing.id },
      data: {
        ...(safeFields as never),
        updatedById: ctx.actorUserId,
        sourceRef: ctx.sourceRef,
      },
    });

    if (Object.keys(safeFields).length > 0) {
      await tx.assetEvent.create({
        data: {
          assetId: existing.id,
          eventType: AssetEventType.UPDATED,
          summary: `Updated from ${ctx.sourceRef}: ${Object.keys(safeFields).join(', ')}`,
          fromValue: pick(existing.snapshot, Object.keys(safeFields)),
          toValue: safeFields as object,
          refType: 'SyncRun',
          refId: ctx.runId,
          actorUserId: ctx.actorUserId,
          actorName: 'Sheet import',
        },
      });
    }

    return {
      id: updated.id,
      label: updated.assetTag,
      changed: Object.keys(safeFields),
    };
  }

  /** Accepts either a resolved id or a category code from the sheet. */
  private async resolveCategory(tx: Tx, row: Record<string, unknown>): Promise<string> {
    if (row.categoryId) return String(row.categoryId);

    const code = String(row.categoryCode ?? '').trim().toUpperCase();
    const existing = await tx.assetCategory.findFirst({
      where: { code: { equals: code, mode: 'insensitive' } },
    });
    if (existing) return existing.id;

    // An unrecognised category is created rather than rejected, so a new kind
    // of equipment appearing in the sheet does not block the whole import.
    const created = await tx.assetCategory.create({
      data: {
        code,
        name: String(row.categoryName ?? code),
        tagPrefix: code.slice(0, 3),
      },
    });
    return created.id;
  }

  /** LPT-1001, HP-1002 ... unique and never reused. */
  private async generateTag(tx: Tx, categoryId: string): Promise<string> {
    const category = await tx.assetCategory.findUniqueOrThrow({ where: { id: categoryId } });
    const prefix = (category.tagPrefix ?? category.code.slice(0, 3)).toUpperCase();
    const count = await tx.asset.count({ where: { categoryId } });

    for (let n = count + 1001; n < count + 2001; n++) {
      const candidate = `${prefix}-${n}`;
      const clash = await tx.asset.findUnique({ where: { assetTag: candidate } });
      if (!clash) return candidate;
    }
    throw new Error(`Could not allocate an asset tag for prefix ${prefix}`);
  }
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, obj[k] ?? null]));
}
