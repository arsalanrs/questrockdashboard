/**
 * LendingPad API client — stub for future integration.
 *
 * Environment variables (add to .env.local):
 *   LENDINGPAD_API_URL=https://api.lendingpad.com
 *   LENDINGPAD_API_KEY=your-api-key
 */

import type { LendingPadLoan, LendingPadDocument, LendingPadCondition } from "./types";

const BASE_URL = process.env.LENDINGPAD_API_URL ?? "https://api.lendingpad.com";
const API_KEY = process.env.LENDINGPAD_API_KEY ?? "";

function headers() {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
}

// TODO: Implement when LendingPad API credentials are available
export async function fetchLoan(_loanId: string): Promise<LendingPadLoan | null> {
  void BASE_URL;
  void headers;
  console.warn("[LendingPad] fetchLoan is a stub — not yet implemented");
  return null;
}

export async function fetchDocuments(_loanId: string): Promise<LendingPadDocument[]> {
  console.warn("[LendingPad] fetchDocuments is a stub — not yet implemented");
  return [];
}

export async function fetchConditions(_loanId: string): Promise<LendingPadCondition[]> {
  console.warn("[LendingPad] fetchConditions is a stub — not yet implemented");
  return [];
}

export async function syncLoanStatus(_loanId: string): Promise<void> {
  console.warn("[LendingPad] syncLoanStatus is a stub — not yet implemented");
}
