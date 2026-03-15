import { shapeBulkExport } from "@/lib/shape-api/client";
import { mapApiRecordToCsvLike } from "@/lib/shape-api/field-map";
import { SHAPE_BULK_EXPORT_FIELDS } from "@/lib/shape-api/fields";

function last30DaysIso(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export type ShapePreviewOptions = {
  dateFrom?: string;
  dateTo?: string;
};

export type ShapePreviewResult = {
  fields_not_found: string[];
  sampleRecords: Record<string, unknown>[];
  distinctStatuses: string[];
  recordCount: number;
  message?: string;
};

/**
 * Fetches one page from Shape bulk export (no DB write). Use to inspect
 * field names, status values, and LO assignment format before running sync.
 */
export async function runShapeApiPreview(
  options: ShapePreviewOptions = {}
): Promise<ShapePreviewResult> {
  const range = options.dateFrom && options.dateTo
    ? { from: options.dateFrom, to: options.dateTo }
    : last30DaysIso();

  const res = await shapeBulkExport({
    createdDateRange: range,
    fields: SHAPE_BULK_EXPORT_FIELDS,
    pageNumber: 1,
  });

  const data = res.data ?? {};
  const records = Object.values(data) as Record<string, unknown>[];
  const distinctStatuses = new Set<string>();

  const sampleRecords: Record<string, unknown>[] = [];
  const statusKeys = ["mstrstatus1", "mstrStatus1", "status", "Status", "portalStatus"];

  for (const record of records) {
    for (const key of statusKeys) {
      if (record[key] != null && String(record[key]).trim()) {
        distinctStatuses.add(String(record[key]).trim());
      }
    }
    const row = mapApiRecordToCsvLike(record);
    const statusRaw = row["Status"];
    if (statusRaw?.trim()) distinctStatuses.add(statusRaw.trim());
  }

  // Keep 2–3 sample records (raw API shape) for inspection
  for (let i = 0; i < Math.min(3, records.length); i++) {
    sampleRecords.push(records[i] ?? {});
  }

  return {
    fields_not_found: res.fields_not_found ?? [],
    sampleRecords,
    distinctStatuses: Array.from(distinctStatuses).sort(),
    recordCount: records.length,
    message: res.message,
  };
}
