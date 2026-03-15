import type { ShapeBulkExportRequest, ShapeBulkExportResponse } from "@/lib/shape-api/types";
import { getShapeApiConfig } from "@/lib/shape-api/config";

export async function shapeBulkExport(
  params: ShapeBulkExportRequest
): Promise<ShapeBulkExportResponse> {
  const { baseUrl, apiKey, crmId } = getShapeApiConfig();

  const body: Record<string, unknown> = {
    fields: params.fields,
    pageNumber: params.pageNumber,
  };
  if (params.createdDateRange) body.createdDateRange = params.createdDateRange;
  if (params.updatedDateRange) body.updatedDateRange = params.updatedDateRange;

  const res = await fetch(`${baseUrl}/leads/bulk/export/${crmId}`, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    const summary =
      text.length > 200 ? `${text.slice(0, 200).replace(/\s+/g, " ")}…` : text.replace(/\s+/g, " ");
    throw new Error(
      `Shape API bulk export failed: ${res.status} ${res.statusText}. ${summary} (Check base URL and that your account has API access.)`
    );
  }

  const json = (await res.json()) as ShapeBulkExportResponse;
  return json;
}
