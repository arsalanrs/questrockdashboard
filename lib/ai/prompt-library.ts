/**
 * Suggested-prompt library for the executive AI chat sidebar.
 * Sourced from the 43-query catalog defined in the roadmap brief.
 */

export type PromptDepth = "quick" | "analysis" | "report";
export type PromptCategory =
  | "Pipeline"
  | "Refinance"
  | "LO performance"
  | "Deal action"
  | "Borrower intel"
  | "Forecast"
  | "Compliance";

export type SuggestedPrompt = {
  category: PromptCategory;
  depth: PromptDepth;
  text: string;
};

export const PROMPT_LIBRARY: SuggestedPrompt[] = [
  // Pipeline
  { category: "Pipeline", depth: "quick", text: "What should Brenden focus on closing this week?" },
  { category: "Pipeline", depth: "analysis", text: "Show me every deal stuck in Processing or Underwriting for more than 30 days." },
  { category: "Pipeline", depth: "quick", text: "Which Piped deals have had no activity in the last 60 days?" },
  { category: "Pipeline", depth: "quick", text: "How many deals are in the pipeline right now and what is the total loan volume?" },
  { category: "Pipeline", depth: "report", text: "Which Approved deals never funded and why — summarize the notes for each." },
  { category: "Pipeline", depth: "analysis", text: "Show me deals that were Clear to Close but didn't fund this quarter." },
  { category: "Pipeline", depth: "analysis", text: "What is the average time from Application to Funding for each LO?" },

  // Refinance
  { category: "Refinance", depth: "quick", text: "Find all leads with an original rate above 4.5% who are still active." },
  { category: "Refinance", depth: "analysis", text: "Which FHA loans could convert to Conventional and eliminate PMI?" },
  { category: "Refinance", depth: "analysis", text: "Show me VA borrowers eligible for an IRRRL — loan age between 6 and 36 months." },
  { category: "Refinance", depth: "analysis", text: "Who are the top 10 cash-out refi candidates by estimated equity?" },
  { category: "Refinance", depth: "report", text: "If rates drop 0.5% from today, how many borrowers in our book would benefit from a refinance?" },
  { category: "Refinance", depth: "analysis", text: "Which ARM loans in our portfolio are approaching their adjustment date in the next 6 months?" },
  { category: "Refinance", depth: "report", text: "Generate a refi opportunity list for Bill Medley sorted by potential rate savings." },

  // LO performance
  { category: "LO performance", depth: "analysis", text: "Compare close rates across all LOs for the last 12 months." },
  { category: "LO performance", depth: "quick", text: "Which LO has the most stalled deals right now?" },
  { category: "LO performance", depth: "analysis", text: "Show me Bill Medley's pipeline — what should he prioritize today?" },
  { category: "LO performance", depth: "quick", text: "Which LO has the highest Application to Funded conversion rate?" },
  { category: "LO performance", depth: "analysis", text: "How many leads did each LO receive this quarter vs how many funded?" },
  { category: "LO performance", depth: "report", text: "Where in the pipeline do deals die most often for Stephen Curry?" },
  { category: "LO performance", depth: "quick", text: "Rank all LOs by total funded loan volume year to date." },
  { category: "LO performance", depth: "analysis", text: "Show me LOs who have deals assigned but no activity in the last 14 days." },

  // Deal action
  { category: "Deal action", depth: "analysis", text: "Generate a call script for Brenden to re-engage his CTC stall." },
  { category: "Deal action", depth: "analysis", text: "What are the top 5 deals across the whole team that I should have someone call today?" },
  { category: "Deal action", depth: "report", text: "Create a re-engagement email for No Sale leads that went cold 6–12 months ago." },
  { category: "Deal action", depth: "quick", text: "Which deals need a condition cleared to move from Underwriting to Approved?" },
  { category: "Deal action", depth: "report", text: "Assign me today's top 3 priority actions per LO and explain the reasoning." },
  { category: "Deal action", depth: "analysis", text: "Which Long Term Nurture leads are due for reactivation this month?" },
  { category: "Deal action", depth: "report", text: "Send a morning briefing summarizing yesterday's pipeline changes and today's top actions." },

  // Borrower intel
  { category: "Borrower intel", depth: "report", text: "Find borrowers whose credit score has likely improved since their application — who should we rescore?" },
  { category: "Borrower intel", depth: "quick", text: "Which funded borrowers are coming up on their 1-year or 2-year anniversary?" },
  { category: "Borrower intel", depth: "analysis", text: "Show me all veteran borrowers who haven't used VA benefits — they may qualify for better terms." },
  { category: "Borrower intel", depth: "report", text: "Which borrowers have a DTI above 45% — are there any deal restructuring options?" },
  { category: "Borrower intel", depth: "analysis", text: "Find borrowers with high equity and no cash-out refi conversation on file." },
  { category: "Borrower intel", depth: "quick", text: "Who are our self-employed borrowers — do they have deals in the pipeline right now?" },

  // Forecast
  { category: "Forecast", depth: "report", text: "What is our projected funded volume for this month based on current pipeline?" },
  { category: "Forecast", depth: "analysis", text: "If we close every Approved deal today, what would total revenue look like?" },
  { category: "Forecast", depth: "report", text: "Based on historical patterns, which status stages have the highest drop-off and why?" },
  { category: "Forecast", depth: "analysis", text: "How does this month's pipeline compare to the same period last year?" },
  { category: "Forecast", depth: "analysis", text: "What would our close rate look like if we recovered all stalled Approved deals?" },

  // Compliance
  { category: "Compliance", depth: "report", text: "Show me all denied applications and their HMDA reason codes — any patterns?" },
  { category: "Compliance", depth: "quick", text: "Are there any leads marked Do Not Contact that have been recently touched?" },
  { category: "Compliance", depth: "analysis", text: "Flag any applications where DTI exceeds 50% and the deal still moved forward." },
];

export const PROMPT_CATEGORIES: PromptCategory[] = [
  "Pipeline",
  "Refinance",
  "LO performance",
  "Deal action",
  "Borrower intel",
  "Forecast",
  "Compliance",
];

export const DEPTH_LABEL: Record<PromptDepth, string> = {
  quick: "Quick answer",
  analysis: "Analysis",
  report: "Full report",
};

export const DEPTH_TONE: Record<PromptDepth, string> = {
  quick: "text-emerald-500 border-emerald-500/40 bg-emerald-500/5",
  analysis: "text-amber-500 border-amber-500/40 bg-amber-500/5",
  report: "text-red-500 border-red-500/40 bg-red-500/5",
};
