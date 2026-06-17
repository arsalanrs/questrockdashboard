import { getShapeApiConfig, hasShapeApiConfig } from "@/lib/shape-api/config";

const DEFAULT_UPDATE_URL = "https://secure-api.setshape.com/api/update/lead/info";
const SEARCH_BASE = "https://secure-api.setshape.com/api/search/lead";

function getUpdateUrl(): string {
  return (process.env.SHAPE_UPDATE_LEAD_URL ?? DEFAULT_UPDATE_URL).replace(/\/$/, "");
}

export async function updateShapeLeadFields(
  shapeLeadId: number | string,
  fields: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  if (!hasShapeApiConfig()) {
    return { ok: false, error: "Shape API not configured" };
  }
  const { apiKey, crmId } = getShapeApiConfig();
  const leadid = Number(shapeLeadId);
  if (!Number.isFinite(leadid) || leadid <= 0) {
    return { ok: false, error: "Invalid shape lead id" };
  }

  const url = `${getUpdateUrl()}/${crmId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ leadid, systemid: Number(crmId), ...fields }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `Shape update failed: ${res.status} ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

export async function searchShapeLead(params: {
  phone?: string;
  email?: string;
  leadId?: number;
}): Promise<{ leads: Array<Record<string, unknown>> }> {
  if (!hasShapeApiConfig()) {
    return { leads: [] };
  }
  const { apiKey, crmId } = getShapeApiConfig();
  const url = `${SEARCH_BASE}/${crmId}`;

  const body: Record<string, unknown> = {};
  if (params.leadId) body.lead_id = params.leadId;
  if (params.phone) body.phone = params.phone.replace(/\D/g, "");
  if (params.email) body.email = params.email;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) return { leads: [] };
  const json = (await res.json()) as Record<string, unknown>;
  const data = json.data ?? json;
  if (Array.isArray(data)) return { leads: data as Array<Record<string, unknown>> };
  if (data && typeof data === "object") return { leads: [data as Record<string, unknown>] };
  return { leads: [] };
}
