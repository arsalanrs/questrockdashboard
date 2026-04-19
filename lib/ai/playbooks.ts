/**
 * Deal-signal playbook generator.
 *
 * A playbook is the actionable "what to do next" bundle for a single detected
 * signal — call script, re-engagement email, and 2-3 next steps. Playbooks
 * are cached on `deal_signals.playbook_json` to avoid re-generating on every
 * page load.
 *
 * Two generation paths:
 *   1. Template path (always runs) — deterministic, no network, free.
 *   2. LLM polish (optional) — adds empathy / voice if OPENAI_API_KEY is set.
 *
 * The API route decides which path to use based on `mode`.
 */

import type { SignalType } from "@/lib/signals/types";

export type PlaybookInput = {
  signalType: SignalType;
  reason: string;
  priority: number;
  meta: Record<string, unknown>;
  loan: {
    id: string;
    borrowerFirstName: string | null;
    borrowerLastName: string | null;
    loanAmountCents: number | null;
    loanType: string | null;
    loanPurpose: string | null;
    currentStage: string | null;
    propertyState: string | null;
    loName: string | null;
  };
};

export type Playbook = {
  headline: string;
  callScript: string;
  email: { subject: string; body: string };
  nextSteps: string[];
  source: "template" | "llm";
  generatedAt: string;
};

function borrowerFirstName(loan: PlaybookInput["loan"]): string {
  return loan.borrowerFirstName?.trim() || "there";
}

function loanAmountStr(loan: PlaybookInput["loan"]): string {
  if (!loan.loanAmountCents) return "your loan";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(loan.loanAmountCents / 100);
}

function loName(loan: PlaybookInput["loan"]): string {
  return loan.loName?.trim() || "your Quest Rock loan officer";
}

function num(meta: Record<string, unknown>, key: string): number | null {
  const v = meta?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/* ------------------------------------------------------------------ */
/*  Template playbooks — one per signal type                           */
/* ------------------------------------------------------------------ */

function pipedNeverClosedPlaybook(input: PlaybookInput): Playbook {
  const first = borrowerFirstName(input.loan);
  const days = num(input.meta, "daysSinceAppraisal") ?? 30;
  return {
    headline: `Re-engage ${first} — appraisal ordered but never closed`,
    callScript: `Hi ${first}, this is ${loName(input.loan)} from Quest Rock. I was going through our pipeline and noticed we ordered the appraisal on your file about ${days} days ago but never brought it to the finish line.

A few things that may have stalled us — change in rate, docs, or just life got busy. Totally understand either way.

The reason I'm calling: rates may have moved since we started, and I want to make sure we either (a) close what we already started or (b) confirm you're sitting this one out, no pressure. What's your current thinking?`,
    email: {
      subject: `Quest Rock — picking up where we left off on your loan`,
      body: `Hi ${first},

${loName(input.loan)} here. I was auditing our pipeline and saw your file still shows the appraisal we ordered roughly ${days} days ago. I'd hate to leave it hanging if there's still an opportunity.

Would you like me to (1) pick up where we left off, (2) re-quote based on current rates, or (3) close the file out? A quick reply is all I need.

Thanks,
${loName(input.loan)}
Quest Rock`,
    },
    nextSteps: [
      "Call the borrower using the script above today.",
      "If no answer, send the email and schedule a 48-hour follow-up.",
      "Update loan status to either re-engaged or withdrawn once you connect.",
    ],
    source: "template",
    generatedAt: new Date().toISOString(),
  };
}

function appNoMovementPlaybook(input: PlaybookInput): Playbook {
  const first = borrowerFirstName(input.loan);
  const days = num(input.meta, "daysStale") ?? 30;
  const stage = (input.meta.stage as string | undefined) ?? input.loan.currentStage ?? "application";
  return {
    headline: `${first}'s ${stage} file has been idle ${days} days`,
    callScript: `Hi ${first}, ${loName(input.loan)} from Quest Rock. Your file is sitting in ${stage} and I don't want it to go cold. Do you still want to move forward? If yes, I can tell you exactly what we need next to get this closing.`,
    email: {
      subject: `Quest Rock — is your loan still a go?`,
      body: `Hi ${first},

It's been about ${days} days since we had movement on your ${stage} file. I want to make sure nothing is blocking us on our side, and I'd rather pick up the phone than let it drift.

Reply with what's changed on your end and I'll tell you exactly what's needed to finish.

— ${loName(input.loan)}, Quest Rock`,
    },
    nextSteps: [
      "Call today; if no answer, send the email and leave a voicemail.",
      "If borrower re-engages, push to the next stage within 72 hours.",
      "If silent after 5 business days, mark Long Term Nurture and schedule 30-day re-touch.",
    ],
    source: "template",
    generatedAt: new Date().toISOString(),
  };
}

function approvedNeverFundedPlaybook(input: PlaybookInput): Playbook {
  const first = borrowerFirstName(input.loan);
  const days = num(input.meta, "daysStale") ?? 30;
  return {
    headline: `${first} was approved ${days}d ago but never funded`,
    callScript: `Hi ${first}, this is ${loName(input.loan)} from Quest Rock. You were approved about ${days} days ago but we never got to funding. Before I write this one off, I want to hear from you — did you go with another lender, did life happen, or is there something I can still solve on my end? No judgment, I just want to close this loop one way or the other.`,
    email: {
      subject: `Quest Rock — closing the loop on your approval`,
      body: `Hi ${first},

You were approved on your Quest Rock application roughly ${days} days ago. I want to make sure I either finish the job or know you've moved on — either is fine, but silence isn't.

What's your status?

— ${loName(input.loan)}, Quest Rock`,
    },
    nextSteps: [
      "Call today with the script above — lead with curiosity, not sales.",
      "If they went elsewhere: ask what we could have done better. File-close.",
      "If still open: re-run pricing at today's rates and re-send the LE.",
    ],
    source: "template",
    generatedAt: new Date().toISOString(),
  };
}

function ctcStallPlaybook(input: PlaybookInput): Playbook {
  const first = borrowerFirstName(input.loan);
  const days = num(input.meta, "daysStale") ?? 7;
  return {
    headline: `CTC ${days}d — should have funded, hasn't`,
    callScript: `Hi ${first}, ${loName(input.loan)} from Quest Rock. We hit Clear-to-Close ${days} days ago — that usually means funding within a week. What's blocking us from scheduling the signing?`,
    email: {
      subject: `Quest Rock — let's get your signing on the calendar`,
      body: `Hi ${first},

We've been Clear-to-Close for ${days} days on your file. Everything on our side is ready — I just need to lock in a signing time. What works for you this week?

— ${loName(input.loan)}, Quest Rock`,
    },
    nextSteps: [
      "Call closing + borrower same day; don't wait on email.",
      "Confirm final closing disclosure was received and acknowledged.",
      "If borrower is unresponsive for 5 business days, escalate to manager.",
    ],
    source: "template",
    generatedAt: new Date().toISOString(),
  };
}

function esignStuckPlaybook(input: PlaybookInput): Playbook {
  const first = borrowerFirstName(input.loan);
  const days = num(input.meta, "daysStuck") ?? 3;
  return {
    headline: `eSign out ${days}d — no signed package`,
    callScript: `Hi ${first}, ${loName(input.loan)} from Quest Rock. I sent your disclosures over for eSign about ${days} days ago and haven't seen them come back. Want me to walk you through it over the phone right now? It's about 3 minutes.`,
    email: {
      subject: `Quest Rock — 3 minutes to sign, let's knock it out`,
      body: `Hi ${first},

Your disclosures are sitting in your inbox waiting for an eSign. I can walk you through it in under 3 minutes on the phone if that's easier. Otherwise, check your email (including spam) for the DocuSign link.

— ${loName(input.loan)}, Quest Rock`,
    },
    nextSteps: [
      "Call within business hours and offer to screenshare / walk through eSign.",
      "Re-send DocuSign link from LendingPad if the original link expired.",
      "If still stuck after 48 more hours, offer overnight of paper disclosures.",
    ],
    source: "template",
    generatedAt: new Date().toISOString(),
  };
}

function rateAboveMarketPlaybook(input: PlaybookInput): Playbook {
  const first = borrowerFirstName(input.loan);
  const noteRate = num(input.meta, "noteRateBps");
  const marketBps = num(input.meta, "marketBps");
  const deltaBps = num(input.meta, "deltaBps") ?? 0;
  const noteStr = noteRate != null ? `${(noteRate / 100).toFixed(2)}%` : "your current rate";
  const marketStr = marketBps != null ? `${(marketBps / 100).toFixed(2)}%` : "today's market";
  const delta = (deltaBps / 100).toFixed(2);
  const amount = loanAmountStr(input.loan);
  return {
    headline: `${first} is paying ${delta}% above market`,
    callScript: `Hi ${first}, ${loName(input.loan)} from Quest Rock. Quick reason for my call — your note rate is ${noteStr} and today's market is closer to ${marketStr}. On a ${amount} loan, that gap is real money every month. I wanted to see if you'd like me to run the refi numbers, no obligation, just so you know what's possible.`,
    email: {
      subject: `${first} — quick refi numbers from Quest Rock`,
      body: `Hi ${first},

Hope you've been well. I was reviewing past Quest Rock borrowers and noticed your rate (${noteStr}) is running about ${delta}% above today's market (~${marketStr}). On a ${amount} loan that usually translates into meaningful monthly savings.

Want me to run a quick refi analysis — payment today vs. payment at market? It's free and takes 10 minutes.

— ${loName(input.loan)}, Quest Rock`,
    },
    nextSteps: [
      "Pull soft credit + latest estimated property value before the call.",
      "Prepare a side-by-side: current payment vs. refi payment + break-even.",
      "Close the call with a specific next step (application link or follow-up date).",
    ],
    source: "template",
    generatedAt: new Date().toISOString(),
  };
}

function cashOutCandidatePlaybook(input: PlaybookInput): Playbook {
  const first = borrowerFirstName(input.loan);
  const equityCents = num(input.meta, "equityCents");
  const equityStr = equityCents
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
        equityCents / 100
      )
    : "significant equity";
  return {
    headline: `${first} is sitting on ~${equityStr} of equity`,
    callScript: `Hi ${first}, ${loName(input.loan)} from Quest Rock. Real quick — your home has picked up an estimated ${equityStr} in equity since we last spoke. A lot of our borrowers are using a cash-out refi to consolidate higher-rate debt or knock out a renovation. Worth 10 minutes to run the numbers?`,
    email: {
      subject: `${first} — your home equity is working for you`,
      body: `Hi ${first},

You're sitting on an estimated ${equityStr} of equity in your home. Depending on your goals, a cash-out refi can fund a remodel, consolidate credit-card debt, or free up reserves — all at mortgage rates, not card rates.

Want me to run the numbers?

— ${loName(input.loan)}, Quest Rock`,
    },
    nextSteps: [
      "Pull a recent AVM / Zillow estimate to confirm value before the call.",
      "Ask the borrower about their 'use of funds' goal — it frames the whole call.",
      "Send a personalized cash-out comparison (keep current loan vs. cash-out) after the call.",
    ],
    source: "template",
    generatedAt: new Date().toISOString(),
  };
}

function fhaToConventionalPlaybook(input: PlaybookInput): Playbook {
  const first = borrowerFirstName(input.loan);
  const ltvBps = num(input.meta, "ltvBps");
  const ltvStr = ltvBps != null ? `${(ltvBps / 100).toFixed(0)}%` : "below 80%";
  return {
    headline: `${first} can drop FHA mortgage insurance`,
    callScript: `Hi ${first}, ${loName(input.loan)} from Quest Rock. Good news: your LTV is at ${ltvStr}, which means you now qualify for a conventional refinance and can drop the FHA mortgage insurance entirely. That's savings every single month for the rest of the loan. Worth running the numbers?`,
    email: {
      subject: `${first} — you can drop FHA mortgage insurance`,
      body: `Hi ${first},

Quick update on your FHA loan: based on the numbers we have, your loan-to-value is around ${ltvStr}. That's the threshold where a conventional refi lets you drop the FHA MI entirely — usually saving borrowers $150–$300 per month.

Want me to run a quick comparison?

— ${loName(input.loan)}, Quest Rock`,
    },
    nextSteps: [
      "Pull current FICO and verify value via AVM before the call.",
      "Run FHA-now vs Conv-refi side-by-side including MI savings.",
      "Lock rate before quoting if market is moving.",
    ],
    source: "template",
    generatedAt: new Date().toISOString(),
  };
}

function vaIrrrlPlaybook(input: PlaybookInput): Playbook {
  const first = borrowerFirstName(input.loan);
  const months = num(input.meta, "loanAgeMonths") ?? 24;
  return {
    headline: `${first} qualifies for a VA IRRRL streamline`,
    callScript: `Hi ${first}, ${loName(input.loan)} from Quest Rock. Thank you for your service. Your VA loan is about ${months} months old and rates have moved — that puts you right in the VA IRRRL sweet spot. Streamline means no appraisal, no income docs, just a rate-and-term refi. Five-minute process on our end. Can I run the numbers for you?`,
    email: {
      subject: `${first} — VA IRRRL streamline refinance`,
      body: `Hi ${first},

Quest Rock reaching out with a quick one. Your VA loan is ${months} months old and today's rates put you in range for a VA IRRRL — the streamline refinance with no appraisal, no income docs, minimal paperwork.

Happy to run the numbers if you want to see the savings. Takes about 10 minutes of your time.

— ${loName(input.loan)}, Quest Rock`,
    },
    nextSteps: [
      "Confirm veteran status and current VA loan servicer before the call.",
      "Run IRRRL savings analysis — focus on lifetime interest saved.",
      "Queue up IRRRL-specific app / checklist in LendingPad before the borrower says yes.",
    ],
    source: "template",
    generatedAt: new Date().toISOString(),
  };
}

function armResetPlaybook(input: PlaybookInput): Playbook {
  const first = borrowerFirstName(input.loan);
  const days = num(input.meta, "daysUntilReset");
  const window =
    days != null && days >= 0 ? `in about ${days} days` : days != null ? `${Math.abs(days)} days ago` : "soon";
  return {
    headline: `${first}'s ARM is resetting ${window}`,
    callScript: `Hi ${first}, ${loName(input.loan)} from Quest Rock. I wanted to get ahead of a payment-shock situation: your ARM is resetting ${window}. Depending on the index and margin, your payment could jump materially. Let's take 10 minutes to look at locking into a fixed rate now instead of after the reset.`,
    email: {
      subject: `${first} — your ARM is about to adjust`,
      body: `Hi ${first},

Heads-up: your adjustable-rate mortgage is scheduled to adjust ${window}. Depending on the index and margin terms, your new payment can be meaningfully higher.

I'd rather have this conversation now than after the reset. Worth 10 minutes?

— ${loName(input.loan)}, Quest Rock`,
    },
    nextSteps: [
      "Pull the original note to read the index + margin + adjustment cap.",
      "Run 'reset as-is' vs 'refi to fixed' — show worst-case ARM payment.",
      "Move fast — borrowers lose urgency the day after the reset locks in.",
    ],
    source: "template",
    generatedAt: new Date().toISOString(),
  };
}

function creditScoreImprovedPlaybook(input: PlaybookInput): Playbook {
  const first = borrowerFirstName(input.loan);
  return {
    headline: `${first}'s credit likely improved — rescore opportunity`,
    callScript: `Hi ${first}, ${loName(input.loan)} from Quest Rock. We'd like to rescore your credit — if your FICO moved up materially since your last application, you could requalify into a better rate or product entirely. No obligation — just want to give you the option.`,
    email: {
      subject: `${first} — potential rate improvement with rescore`,
      body: `Hi ${first},

Credit rescoring is a free way to see if you've moved into a better rate tier since we last looked. Want me to pull a soft credit and re-run pricing? No impact to your FICO.

— ${loName(input.loan)}, Quest Rock`,
    },
    nextSteps: [
      "Pull soft-pull credit with consent.",
      "Compare prior-FICO pricing vs current-FICO pricing on the same product.",
      "If delta > 25bps, send personalized refi LE within 24h.",
    ],
    source: "template",
    generatedAt: new Date().toISOString(),
  };
}

const TEMPLATE_PLAYBOOKS: Record<SignalType, (input: PlaybookInput) => Playbook> = {
  piped_never_closed: pipedNeverClosedPlaybook,
  app_no_movement: appNoMovementPlaybook,
  approved_never_funded: approvedNeverFundedPlaybook,
  ctc_stall: ctcStallPlaybook,
  esign_stuck: esignStuckPlaybook,
  rate_above_market: rateAboveMarketPlaybook,
  cash_out_candidate: cashOutCandidatePlaybook,
  fha_to_conventional: fhaToConventionalPlaybook,
  va_irrrl: vaIrrrlPlaybook,
  arm_reset_window: armResetPlaybook,
  credit_score_improved: creditScoreImprovedPlaybook,
};

/** Generate a deterministic playbook from a template. Never fails, no network. */
export function generatePlaybookFromTemplate(input: PlaybookInput): Playbook {
  const fn = TEMPLATE_PLAYBOOKS[input.signalType];
  if (!fn) {
    return {
      headline: input.reason,
      callScript: `Hi ${borrowerFirstName(input.loan)}, ${loName(input.loan)} from Quest Rock. I'm calling about: ${input.reason}.`,
      email: {
        subject: `Quest Rock — quick check-in`,
        body: `Hi ${borrowerFirstName(input.loan)},\n\n${input.reason}\n\n— ${loName(input.loan)}`,
      },
      nextSteps: ["Review the signal meta and decide the best next action."],
      source: "template",
      generatedAt: new Date().toISOString(),
    };
  }
  return fn(input);
}

/**
 * Optional LLM polish. Preserves the template's structure but rewrites the
 * call script + email in a warmer, more personalized voice. Returns the
 * original template if no API key is set or the LLM call fails.
 */
export async function generatePlaybookWithLlmPolish(
  input: PlaybookInput,
  opts: { apiKey?: string; model?: string } = {}
): Promise<Playbook> {
  const base = generatePlaybookFromTemplate(input);
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return base;

  const model = opts.model ?? process.env.OPENAI_EXEC_CHAT_MODEL?.trim() ?? "gpt-4o-mini";
  const prompt = `You are a top mortgage loan officer writing a call script and an email.
Rewrite the script and email below in a warmer, more conversational tone. Keep it under 120 words each. Do NOT invent new numbers, names, or promises — only paraphrase.

Borrower first name: ${borrowerFirstName(input.loan)}
Signal: ${input.signalType}  ·  Reason: ${input.reason}
Loan amount: ${loanAmountStr(input.loan)}  ·  Loan type: ${input.loan.loanType ?? "n/a"}
Loan officer name: ${loName(input.loan)}

Current call script:
${base.callScript}

Current email subject: ${base.email.subject}
Current email body:
${base.email.body}

Return JSON exactly like:
{"callScript": "...", "email": {"subject": "...", "body": "..."}}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Respond with ONLY valid JSON matching the requested schema." },
          { role: "user", content: prompt },
        ],
        temperature: 0.5,
        response_format: { type: "json_object" },
        max_tokens: 800,
      }),
    });
    if (!res.ok) return base;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return base;
    const parsed = JSON.parse(content) as {
      callScript?: string;
      email?: { subject?: string; body?: string };
    };
    return {
      ...base,
      callScript: parsed.callScript?.trim() || base.callScript,
      email: {
        subject: parsed.email?.subject?.trim() || base.email.subject,
        body: parsed.email?.body?.trim() || base.email.body,
      },
      source: "llm",
    };
  } catch (err) {
    console.error("playbook llm polish failed:", err);
    return base;
  }
}
