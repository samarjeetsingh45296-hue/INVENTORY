import { Injectable } from '@nestjs/common';
import { EmploymentStatus, SourceType } from '@prisma/client';
import {
  EntityWriter,
  ExistingRecord,
  Tx,
  WriteContext,
  buildDedupeKey,
} from './entity-writer';

/** Fields this writer manages. Anything else in the row is ignored. */
const MANAGED = [
  'employeeCode', 'firstName', 'lastName', 'officialEmail', 'personalEmail',
  'phone', 'alternatePhone', 'gender', 'bloodGroup', 'dateOfBirth',
  'dateOfJoining', 'dateOfLeaving', 'employmentStatus', 'employmentType',
  'process', 'shift', 'seatNumber', 'address', 'remarks',
] as const;

@Injectable()
export class EmployeeWriter implements EntityWriter {
  readonly entity = 'employee';
  readonly defaultDedupeKeys = ['employeeCode'];

  validate(row: Record<string, unknown>): string[] {
    const errors: string[] = [];
    const code = String(row.employeeCode ?? '').trim();
    const first = String(row.firstName ?? '').trim();

    if (!code) errors.push('Employee code is missing');
    else if (code.length > 64) errors.push('Employee code is unusually long');

    if (!first) errors.push('Employee name is missing');

    const email = row.officialEmail;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) {
      errors.push(`Official email "${String(email)}" is not valid`);
    }
    return errors;
  }

  dedupeKey(row: Record<string, unknown>, keys: string[]): string | null {
    return buildDedupeKey(row, keys.length ? keys : this.defaultDedupeKeys);
  }

  async findExisting(
    tx: Tx,
    dedupeKey: string,
    ctx: WriteContext,
  ): Promise<ExistingRecord | null> {
    // Archived employees are matched too: re-importing must revive the
    // existing record rather than create a duplicate person.
    const found = await tx.employee.findFirst({
      where: {
        organizationId: ctx.organizationId,
        employeeCode: { equals: dedupeKey.split('|')[0], mode: 'insensitive' },
        // Explicit, so the soft-delete extension does not filter archived rows
        // out: re-importing must revive the existing person, not clone them.
        deletedAt: undefined,
      },
    });
    if (!found) return null;

    const snapshot: Record<string, unknown> = {};
    for (const f of MANAGED) snapshot[f] = (found as Record<string, unknown>)[f];

    return {
      id: found.id,
      label: `${found.fullName} (${found.employeeCode})`,
      snapshot,
      updatedById: found.updatedById,
      updatedAt: found.updatedAt,
    };
  }

  async create(tx: Tx, row: Record<string, unknown>, ctx: WriteContext) {
    const firstName = String(row.firstName ?? '').trim();
    const lastName = row.lastName ? String(row.lastName).trim() : null;

    const created = await tx.employee.create({
      data: {
        organizationId: ctx.organizationId,
        employeeCode: String(row.employeeCode).trim(),
        firstName,
        lastName,
        fullName: [firstName, lastName].filter(Boolean).join(' '),
        officialEmail: (row.officialEmail as string) ?? null,
        personalEmail: (row.personalEmail as string) ?? null,
        phone: (row.phone as string) ?? null,
        alternatePhone: (row.alternatePhone as string) ?? null,
        gender: (row.gender as string) ?? null,
        bloodGroup: (row.bloodGroup as string) ?? null,
        dateOfBirth: (row.dateOfBirth as Date) ?? null,
        dateOfJoining: (row.dateOfJoining as Date) ?? null,
        dateOfLeaving: (row.dateOfLeaving as Date) ?? null,
        employmentStatus:
          (row.employmentStatus as EmploymentStatus) ?? EmploymentStatus.ACTIVE,
        employmentType: (row.employmentType as string) ?? null,
        branchId: (row.branchId as string) ?? ctx.defaultBranchId,
        process: (row.process as string) ?? null,
        shift: (row.shift as string) ?? null,
        seatNumber: (row.seatNumber as string) ?? null,
        address: (row.address as string) ?? null,
        remarks: (row.remarks as string) ?? null,
        sourceType: SourceType.GOOGLE_SHEET,
        sourceRef: ctx.sourceRef,
        createdById: ctx.actorUserId,
      },
    });

    return { id: created.id, label: `${created.fullName} (${created.employeeCode})` };
  }

  async update(
    tx: Tx,
    existing: ExistingRecord,
    safeFields: Record<string, unknown>,
    ctx: WriteContext,
  ) {
    const data: Record<string, unknown> = { ...safeFields };

    // Keep the denormalised full name in step with its parts.
    if ('firstName' in data || 'lastName' in data) {
      const first = String(data.firstName ?? existing.snapshot.firstName ?? '');
      const last = data.lastName ?? existing.snapshot.lastName ?? null;
      data.fullName = [first, last].filter(Boolean).join(' ');
    }

    // An import never revives an archived person silently; it only updates
    // the fields it was given.
    data.updatedById = ctx.actorUserId;
    data.sourceRef = ctx.sourceRef;

    const updated = await tx.employee.update({
      where: { id: existing.id },
      data: data as never,
    });

    return {
      id: updated.id,
      label: `${updated.fullName} (${updated.employeeCode})`,
      changed: Object.keys(safeFields),
    };
  }
}
