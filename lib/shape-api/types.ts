export type ShapeDateRange = {
  from: string;
  to: string;
};

export type ShapeBulkExportRequest = {
  createdDateRange?: ShapeDateRange;
  updatedDateRange?: ShapeDateRange;
  fields: readonly string[];
  pageNumber: number;
};

export type ShapeBulkExportResponse = {
  message: string;
  data: Record<string, Record<string, unknown>>;
  fields_not_found?: string[];
};
