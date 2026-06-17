/** Deep link to a loan in LendingPad app. */
export function lendingPadLoanUrl(lendingpadLoanUuid: string | null | undefined): string | null {
  const id = lendingpadLoanUuid?.trim();
  if (!id) return null;
  return `https://app.lendingpad.com/loans/${id}`;
}
