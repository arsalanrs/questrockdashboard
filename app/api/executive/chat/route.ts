import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/current-user";
import { canViewExecutiveDashboard } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { TOOL_SPECS, TOOL_HANDLERS } from "@/lib/ai/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `You are the Quest Rock Executive Command Center — a data-grounded assistant for mortgage executives.

You answer questions about the live pipeline by calling the provided tools. NEVER guess numbers. If you don't have the data, say so.

Rules:
- Always call tools first for any question about loans, LOs, signals, pipeline counts, or stall status.
- Prefer specific over generic: if the user names an LO, filter by that LO.
- Use the 'category' field on signals: 'stall' = stuck deals; 'refi' = refi opportunities.
- When the user asks "what should X focus on", call listStalledByLO + listSignals, then summarize the top 3–5 actions.
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
