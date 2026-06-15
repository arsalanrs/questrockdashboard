/**
 * Thin Resend API wrapper.
 *
 * Falls back gracefully — if RESEND_API_KEY is not set it logs a warning
 * and returns { skipped: true } so the rest of the cron/report flow continues.
 */

export type SendEmailOptions = {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
};

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; error: string };

export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email/resend] RESEND_API_KEY not set — skipping email delivery");
    return { ok: false, skipped: true, reason: "RESEND_API_KEY not configured" };
  }

  const from = opts.from ?? process.env.REPORT_FROM ?? "reports@questrock.com";
  const to = Array.isArray(opts.to) ? opts.to : [opts.to];

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject: opts.subject, html: opts.html }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      console.error("[email/resend] Resend API error:", res.status, text);
      return { ok: false, error: `Resend ${res.status}: ${text}` };
    }

    const json = (await res.json()) as { id?: string };
    return { ok: true, id: json.id ?? "unknown" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email/resend] fetch error:", msg);
    return { ok: false, error: msg };
  }
}

/** Parse comma-separated REPORT_RECIPIENTS env var into an array. */
export function getReportRecipients(): string[] {
  const raw = process.env.REPORT_RECIPIENTS ?? "";
  return raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}
