"use client";

import { useState } from "react";
import { runShapeApiPreviewAction } from "./actions";

export function ShapeApiPreview() {
  const [result, setResult] = useState<
    | { ok: true; data: { fields_not_found: string[]; sampleRecords: Record<string, unknown>[]; distinctStatuses: string[]; recordCount: number; message?: string } }
    | { ok: false; error: string }
    | null
  >(null);
  const [loading, setLoading] = useState(false);

  async function handlePreview() {
    setLoading(true);
    setResult(null);
    try {
      const res = await runShapeApiPreviewAction();
      setResult(res);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-6 border-t border-border pt-5">
      <h3 className="text-sm font-semibold">Preview Shape API</h3>
      <p className="mt-1 text-sm text-mutedForeground">
        Fetch one page from Shape (no DB write). Use this to confirm field names, status values, and LO assignment
        format before running Sync now.
      </p>
      <button
        type="button"
        onClick={handlePreview}
        disabled={loading}
        className="mt-3 inline-flex items-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
      >
        {loading ? "Loading…" : "Preview"}
      </button>

      {result?.ok === false ? (
        <div className="mt-4 rounded-md border border-amber-500/50 bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/30">
          {result.error}
        </div>
      ) : null}

      {result?.ok === true ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
            <strong>Record count (page 1):</strong> {result.data.recordCount}
            {result.data.message ? ` · ${result.data.message}` : null}
          </div>

          {result.data.fields_not_found.length > 0 ? (
            <div>
              <p className="text-sm font-medium">Fields not found (remove or fix in lib/shape-api/fields.ts):</p>
              <pre className="mt-1 overflow-auto rounded bg-muted px-2 py-1 text-xs">
                {result.data.fields_not_found.join(", ")}
              </pre>
            </div>
          ) : (
            <p className="text-sm text-mutedForeground">All requested fields were returned.</p>
          )}

          <div>
            <p className="text-sm font-medium">Distinct statuses (compare with stage_mapping):</p>
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted px-2 py-1 text-xs">
              {result.data.distinctStatuses.length ? result.data.distinctStatuses.join("\n") : "(none in this page)"}
            </pre>
          </div>

          <div>
            <p className="text-sm font-medium">Sample records (raw API keys/values):</p>
            <div className="mt-1 space-y-2">
              {result.data.sampleRecords.map((rec, i) => (
                <pre key={i} className="max-h-48 overflow-auto rounded bg-muted px-2 py-1 text-xs">
                  {JSON.stringify(rec, null, 2)}
                </pre>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
