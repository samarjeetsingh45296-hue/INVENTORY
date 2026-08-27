import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { google, sheets_v4 } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { existsSync } from 'node:fs';
import {
  SourceAdapter,
  SourceTable,
  SourceRow,
  normaliseHeader,
  dedupeHeaders,
  isBlankRow,
  isRepeatedHeader,
} from './source-adapter';

/**
 * Read-only Google Sheets reader.
 *
 * Authenticates with a service account and requests the READONLY scope only,
 * so even a misconfigured deployment physically cannot write to, rename or
 * delete the customer's spreadsheets.
 */
@Injectable()
export class GoogleSheetsAdapter implements SourceAdapter {
  readonly kind = 'GOOGLE_SHEET' as const;
  private readonly logger = new Logger(GoogleSheetsAdapter.name);
  private client?: sheets_v4.Sheets;

  private async sheets(): Promise<sheets_v4.Sheets> {
    if (this.client) return this.client;

    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!keyFile || !existsSync(keyFile)) {
      throw new ServiceUnavailableException(
        'Google Sheets is not configured. Add a service-account key at ' +
          'GOOGLE_SERVICE_ACCOUNT_JSON and share each sheet with that address ' +
          'as Viewer. The system runs normally without this - Sheets are only ' +
          'an import source.',
      );
    }

    const auth = new GoogleAuth({
      keyFile,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    this.client = google.sheets({ version: 'v4', auth });
    return this.client;
  }

  /** Resolves a numeric gid (what the sheet URL contains) to its tab title. */
  private async titleForGid(
    spreadsheetId: string,
    gid: string,
  ): Promise<string> {
    const api = await this.sheets();
    const meta = await api.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties(sheetId,title)',
    });
    const match = (meta.data.sheets ?? []).find(
      (s) => String(s.properties?.sheetId) === String(gid),
    );
    if (!match?.properties?.title) {
      throw new ServiceUnavailableException(
        `Tab with gid ${gid} was not found in that spreadsheet. It may have been ` +
          'renamed or removed. Existing imported data is unaffected.',
      );
    }
    return match.properties.title;
  }

  async read(params: {
    spreadsheetId?: string | null;
    sheetGid?: string | null;
    sheetName?: string | null;
    headerRow: number;
  }): Promise<SourceTable> {
    const { spreadsheetId, sheetGid, headerRow } = params;
    if (!spreadsheetId) {
      throw new ServiceUnavailableException('No spreadsheet id configured for this source');
    }

    const api = await this.sheets();
    const title =
      params.sheetName ??
      (sheetGid ? await this.titleForGid(spreadsheetId, sheetGid) : undefined);

    let values: string[][];
    try {
      const res = await api.spreadsheets.values.get({
        spreadsheetId,
        range: title ? `'${title.replace(/'/g, "''")}'` : 'A:ZZ',
        // Formatted values, so dates read as they look in the sheet.
        valueRenderOption: 'FORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING',
      });
      values = (res.data.values ?? []) as string[][];
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`Google Sheets read failed: ${message}`);
      throw new ServiceUnavailableException(
        `Could not read the spreadsheet (${message}). Nothing has been changed; ` +
          'all previously imported data remains available.',
      );
    }

    const headerIdx = Math.max(0, headerRow - 1);
    const rawHeaders = values[headerIdx] ?? [];
    const headers = dedupeHeaders(
      rawHeaders.map((h, i) => {
        const clean = normaliseHeader(String(h ?? ''));
        // Unlabelled columns still need a stable key.
        return clean || `Column ${i + 1}`;
      }),
    );

    const rows: SourceRow[] = [];
    for (let i = headerIdx + 1; i < values.length; i++) {
      const cells = values[i] ?? [];
      const raw: Record<string, string> = {};
      headers.forEach((h, c) => {
        raw[h] = String(cells[c] ?? '').trim();
      });
      if (isBlankRow(raw) || isRepeatedHeader(raw, headers)) continue;
      rows.push({ rowNumber: i + 1, raw });
    }

    return {
      headers,
      rows,
      origin: `google-sheet:${spreadsheetId}/${title ?? sheetGid ?? 'default'}`,
    };
  }
}
