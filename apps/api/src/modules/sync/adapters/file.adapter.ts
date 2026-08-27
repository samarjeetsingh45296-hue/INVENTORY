import { BadRequestException, Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
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
 * Reads an uploaded .xlsx / .xls / .csv file.
 *
 * This is the path that needs no Google account at all: download the sheet as
 * Excel, upload it here, done. It is also the fallback used whenever the
 * Sheets API is unavailable.
 */
@Injectable()
export class FileAdapter implements SourceAdapter {
  readonly kind = 'EXCEL_UPLOAD' as const;

  async read(params: {
    filePath?: string | null;
    sheetName?: string | null;
    headerRow: number;
  }): Promise<SourceTable> {
    const { filePath, headerRow } = params;
    if (!filePath) throw new BadRequestException('No file supplied');

    const ext = extname(filePath).toLowerCase();
    const grid =
      ext === '.csv' || ext === '.tsv'
        ? await this.readCsv(filePath, ext === '.tsv' ? '\t' : ',')
        : await this.readWorkbook(filePath, params.sheetName ?? null);

    const headerIdx = Math.max(0, headerRow - 1);
    const headers = dedupeHeaders(
      (grid[headerIdx] ?? []).map((h, i) => {
        const clean = normaliseHeader(String(h ?? ''));
        return clean || `Column ${i + 1}`;
      }),
    );

    if (headers.length === 0) {
      throw new BadRequestException(
        `No header row found at row ${headerRow}. Check the "header row" setting for this source.`,
      );
    }

    const rows: SourceRow[] = [];
    for (let i = headerIdx + 1; i < grid.length; i++) {
      const cells = grid[i] ?? [];
      const raw: Record<string, string> = {};
      headers.forEach((h, c) => {
        raw[h] = String(cells[c] ?? '').trim();
      });
      if (isBlankRow(raw) || isRepeatedHeader(raw, headers)) continue;
      rows.push({ rowNumber: i + 1, raw });
    }

    return { headers, rows, origin: `file:${filePath}` };
  }

  private async readCsv(filePath: string, delimiter: string): Promise<string[][]> {
    const buf = await readFile(filePath);
    return parseCsv(buf, {
      delimiter,
      relax_column_count: true,
      skip_empty_lines: false,
      bom: true,
      trim: false,
    }) as string[][];
  }

  private async readWorkbook(
    filePath: string,
    sheetName: string | null,
  ): Promise<string[][]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);

    const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0];
    if (!ws) {
      const available = wb.worksheets.map((w) => w.name).join(', ');
      throw new BadRequestException(
        `Sheet "${sheetName}" not found. This workbook contains: ${available}`,
      );
    }

    const grid: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const values: string[] = [];
      // ExcelJS row.values is 1-indexed with a leading hole at index 0.
      const arr = (row.values as unknown[]) ?? [];
      for (let c = 1; c < arr.length; c++) {
        values.push(this.cellToString(arr[c]));
      }
      grid[rowNumber - 1] = values;
    });
    return grid;
  }

  /** Excel cells can be rich text, formulas, dates or hyperlinks. */
  private cellToString(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.text === 'string') return o.text.trim();
      if (Array.isArray(o.richText)) {
        return (o.richText as Array<{ text: string }>)
          .map((r) => r.text)
          .join('')
          .trim();
      }
      // Formula cells expose the cached result.
      if ('result' in o) return String(o.result ?? '').trim();
      if ('hyperlink' in o) return String(o.text ?? o.hyperlink ?? '').trim();
      return '';
    }
    return String(v).trim();
  }
}
