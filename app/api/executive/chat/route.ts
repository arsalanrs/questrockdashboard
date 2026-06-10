import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewExecutiveDashboard } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { TOOL_SPECS, TOOL_HANDLERS } from "@/lib/ai/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `You are the Quest Rock Executive Command Center — a data-grounded assistant for mortgage executives.

You answer questions about the live pipeline by calling the provided tools. NEVER guess numbers. If you don't have the data, say so.

Quest Rock CEO playbook (behavior — do not re-label tiers in prose):
- RED / ORANGE / GREEN from tools are pipeline funnel tiers (early vs in-flight vs funded book), not "good vs bad call targets."
- Funded-book rhythm: 6- and 12-month relationship check-ins; month-one skip-payment / referral; first-payment-date touch when the field exists; FHA ~180d prep education vs refi-style pitches suppressed until ~210d from note/close anchor; ARM check-ins aligned to the fixed period before first reset.
- For filtered lists (loan type, min rate, ARM horizon, amount, FICO, stage(s), lead tier, closing this month, ORANGE pipeline-hot), call \`listLoans\` with explicit parameters — do not infer from memory.

Rules:
- Always call tools first for any question about loans, LOs, signals, pipeline counts, or stall status.
- For "find deals", "who should we call", "good loans", "focus tomorrow", or similar, call \`findDealCandidates\` (and optionally \`listSignals\`). \`findDealCandidates\` applies Quest Rock NO-GO rules and rate/LTV/ARM/Piped rules from the database only — not external scrapers or credit-card data.
- When listing loans or signals in your reply, always lead with \`borrower_display\` (or first + last name) and LO; include \`loan_id\` as secondary reference — never UUID-only bullets.
- For \`loansWithMissingDocs\` after \`findDealCandidates\`, pass JSON \`{ "loanIds": ["uuid", ...] }\` using each row's \`loan_id\` field (exact key \`loanIds\`). Run doc checks in the same turn as deal candidates when possible.
- Prefer specific over generic: if the user names an LO, filter by that LO.
- Company-wide / team focus: phrases like "the team", "our team", "company", "everyone", "org-wide", or "what should we focus on" (no LO named) mean you must NOT pass \`lo\` to listSignals or listStalledByLO. "Team" is almost never someone's full name — treat it as org-wide unless the user clearly names a person.
- Use the 'category' field on signals: 'stall' = stuck deals; 'refi' = refi opportunities; 'lead_tier' = funnel/retention (book cadence, EPO, never_contacted, etc.).
- For RED/ORANGE/GREEN counts and tier questions, call \`getTierBreakdown\` — it recomputes and saves tiers before returning aggregates (no manual cron). For funded-book cadence snapshots and EPO 30–60d lists, call \`get8MonthCheckIns\` (name is legacy; response uses bookCadence fields).
- Blitz assignment is agent-driven — no separate “human-only” UI step. Prefer \`runBlitzAssignment\`: use \`executeNow: true\` when the user’s latest message authorizes changing LOs (one-shot is fine, e.g. “run and execute a RED blitz for 10 eligible loans”). Use \`executeNow: false\` when they only asked to preview. You may also call \`previewBlitzAssignment\` then \`executeBlitzAssignment\` with \`confirmed: true\` in subsequent tool rounds within the same request when the user already authorized execution — no need to wait for a second human message.
- When the user asks "what should X focus on" and X is a person, call listStalledByLO + listSignals with \`lo\` matching that person. When X is the whole org/team, omit \`lo\` and use a higher \`minPriority\` (e.g. 3–4) plus listStalledByLO without \`lo\` to surface the best actions.
- Keep answers tight: bullet points, dollar amounts formatted as $XX,XXX, dates as "Apr 15, 2026".
- When there are 0 rows returned, say "No matches" — don't hallucinate.
- Never invent borrower names, rates, or amounts. Only report values returned by tools.
- Your audience is executives: think like a COO, not an LO.`;

type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
};

const MODEL = process.env.OPENAI_EXEC_CHAT_MODEL?.trim() || "gpt-4o-mini";
const MAX_TOOL_ROUNDS = 4;

export async function POST(request: Request) {
  let appUser: { role: string } | null = null;
  try {
    const res = await requireCurrentUser();
    appUser = res.appUser;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!appUser || !canViewExecutiveDashboard(appUser.role as "executive" | "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const userMessages: { role: string; content: string }[] = body?.messages;
  if (!Array.isArray(userMessages) || userMessages.length === 0) {
    return NextResponse.json({ error: "messages array is required" }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      message: {
        role: "assistant",
        content:
          "Exec AI is not configured. Set OPENAI_API_KEY in your environment to enable grounded chat.",
      },
      toolTrace: [],
    });
  }

  const admin = createSupabaseAdminClient();
  const convo: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...userMessages.map((m) => ({ role: m.role as ChatMessage["role"], content: m.content ?? "" })),
  ];

  const toolTrace: Array<{ name: string; args: Record<string, unknown>; ok: boolean; ms: number }> = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: convo,
        tools: TOOL_SPECS,
        tool_choice: "auto",
        temperature: 0.3,
        max_tokens: 1200,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("OpenAI error:", res.status, err);
      return NextResponse.json({ error: "AI provider error", detail: err }, { status: 502 });
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    const msg = choice?.message as ChatMessage | undefined;
    if (!msg) {
      return NextResponse.json({ error: "Empty response from AI" }, { status: 502 });
    }

    convo.push(msg);

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const call of msg.tool_calls) {
        const fnName = call.function.name;
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(call.function.arguments || "{}");
        } catch {
          parsed = {};
        }
        const handler = TOOL_HANDLERS[fnName];
        const start = Date.now();
        let ok = true;
        let toolResult: unknown;
        if (!handler) {
          ok = false;
          toolResult = { error: `Unknown tool ${fnName}` };
        } else {
          try {
            toolResult = await handler(parsed, admin);
          } catch (e) {
            ok = false;
            toolResult = { error: e instanceof Error ? e.message : String(e) };
          }
        }
        toolTrace.push({ name: fnName, args: parsed, ok, ms: Date.now() - start });
        convo.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(toolResult).slice(0, 20_000),
        });
      }
      continue; // loop for the follow-up completion
    }

    return NextResponse.json({
      message: { role: "assistant", content: msg.content ?? "" },
      toolTrace,
    });
  }

  return NextResponse.json({
    message: {
      role: "assistant",
      content:
        "I wasn't able to finish in the tool-call budget. Try narrowing the question (e.g. a specific LO).",
    },
    toolTrace,
  });
}
