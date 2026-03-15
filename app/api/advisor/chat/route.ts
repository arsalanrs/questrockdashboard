import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const SYSTEM_PROMPT = `You are Quest Rock's AI Guideline Advisor. You help loan officers find the right loan program for their borrowers. You know about Conventional, FHA, VA, DSCR, Non-QM Bank Statement, Construction, and Fix & Flip programs. Provide specific program recommendations with step-by-step instructions for LendingPad. Be concise and actionable.

Key guidelines:
- Conventional: Min 620 FICO, 3-5% down owner-occupied, 15-25% down investment. Fannie/Freddie guidelines.
- FHA: Min 580 FICO (3.5% down) or 500 FICO (10% down). MIP required. Max DTI 56.9% with AUS approval.
- VA: No down payment, no PMI. Must have VA eligibility. Funding fee applies unless exempt.
- DSCR: Investment properties only. Qualifies on rental income vs PITIA. Min 1.0-1.25 DSCR typical. No tax returns needed.
- Bank Statement: Self-employed borrowers. 12 or 24 month bank statements. No tax returns. Min 620 FICO typical.
- Construction: One-time close or two-time close. Plans & specs required. Builder approval needed.
- Fix & Flip: Short-term bridge loan. Based on ARV (after repair value). Typically 12-18 month term.

When recommending programs, consider: FICO score, down payment, property type, occupancy, income documentation, DTI, and any derogatory credit events.`;

type ChatMessage = { role: string; content: string };

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const messages: ChatMessage[] = body.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "messages array is required" },
      { status: 400 },
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      message: {
        role: "assistant",
        content:
          "AI Advisor is not configured yet. Set OPENAI_API_KEY in your environment variables to enable.",
      },
    });
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        temperature: 0.4,
        max_tokens: 1024,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("OpenAI API error:", res.status, errBody);
      return NextResponse.json(
        { error: "Failed to get AI response" },
        { status: 502 },
      );
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content ?? "No response generated.";

    return NextResponse.json({
      message: { role: "assistant", content: reply },
    });
  } catch (err) {
    console.error("Advisor chat error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
