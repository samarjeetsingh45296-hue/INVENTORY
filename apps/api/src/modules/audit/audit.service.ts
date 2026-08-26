import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PRISMA, ExtendedPrisma } from '../../common/prisma/prisma.service';
import { RequestContextStore } from '../../common/context/request-context';

/** Never written to the audit trail, whatever happens. */
const REDACTED_FIELDS = new Set([
  'passwordHash',
  'password',
  'mfaSecretEnc',
  'mfaRecoveryCodes',
  'tokenHash',
  'refreshToken',
  'accessToken',
  'confirmationToken',
  'S3_SECRET_ACCESS_KEY',
  'SMTP_PASSWORD',
]);

export interface AuditInput {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  summary?: string;
  refType?: string;
  refId?: string;
  /**
   * Who did it, when the ambient request context cannot know.
   * Sign-in is the motivating case: the context scope is opened before
   * authentication runs, so at that moment there is no user on the request
   * and the trail would otherwise read "Anonymous" for every login.
   */
  actor?: { userId: string | null; userName: string; userEmail?: string | null; roleKeys?: string[] };
}

type Json = Record<string, unknown>;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrisma) {}

  private redact(obj: Json | null | undefined): Json | null {
    if (!obj) return null;
    const out: Json = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = REDACTED_FIELDS.has(k) ? '[redacted]' : v;
    }
    return out;
  }

  /**
   * Field-level diff. Only what actually changed is stored, which keeps the
   * trail readable: "Old Value: HP-001 / New Value: HP-007" rather than a
   * dump of the whole row.
   */
  diff(
    before: Json | null | undefined,
    after: Json | null | undefined,
  ): { changed: string[]; old: Json; new: Json } {
    const changed: string[] = [];
    const oldOut: Json = {};
    const newOut: Json = {};
    const keys = new Set([
      ...Object.keys(before ?? {}),
      ...Object.keys(after ?? {}),
    ]);

    for (const k of keys) {
      if (k === 'updatedAt' || k === 'createdAt') continue;
      const a = before?.[k];
      const b = after?.[k];
      if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
      changed.push(k);
      oldOut[k] = REDACTED_FIELDS.has(k) ? '[redacted]' : (a ?? null);
      newOut[k] = REDACTED_FIELDS.has(k) ? '[redacted]' : (b ?? null);
    }
    return { changed, old: oldOut, new: newOut };
  }

  /**
   * Writes one audit row. Deliberately never throws: a failure to record must
   * be shouted about, but it must not roll back the user's actual work.
   * Failures are logged at error level for the alerting pipeline to pick up.
   */
  async record(input: AuditInput): Promise<void> {
    const ctx = RequestContextStore.get();
    const actor = {
      userId: input.actor?.userId ?? ctx.userId,
      userName: input.actor?.userName ?? ctx.userName,
      userEmail: input.actor?.userEmail ?? ctx.userEmail,
      roleKeys: input.actor?.roleKeys ?? ctx.roleKeys,
    };
    const { changed, old, new: next } =
      input.oldValue || input.newValue
        ? this.diff(input.oldValue, input.newValue)
        : { changed: [], old: {}, new: {} };

    try {
      await this.prisma.auditLog.create({
        data: {
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          entityLabel: input.entityLabel ?? null,
          userId: actor.userId,
          userName: actor.userName,
          userEmail: actor.userEmail,
          roleKeys: actor.roleKeys,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
          sessionId: ctx.sessionId,
          oldValue: changed.length
            ? (old as Prisma.InputJsonValue)
            : (this.redact(input.oldValue) as Prisma.InputJsonValue | undefined),
          newValue: changed.length
            ? (next as Prisma.InputJsonValue)
            : (this.redact(input.newValue) as Prisma.InputJsonValue | undefined),
          changedFields: changed,
          summary: input.summary ?? null,
          refType: input.refType ?? null,
          refId: input.refId ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `AUDIT WRITE FAILED for ${input.action} ${input.entityType} ${input.entityId}: ${
          (err as Error).message
        }`,
        (err as Error).stack,
      );
    }
  }

  /** Full history for one record, newest first - powers the "History" tab. */
  async historyFor(entityType: string, entityId: string, take = 200) {
    return this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
