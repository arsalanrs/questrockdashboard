/** LendingPad LOS integration types — stub for future implementation. */

export type LendingPadLoanStatus =
  | "Application"
  | "Processing"
  | "Submitted"
  | "Approved"
  | "Docs Out"
  | "Funded"
  | "Denied"
  | "Withdrawn";

export type LendingPadLoan = {
  loanId: string;
  borrowerFirstName: string;
  borrowerLastName: string;
  loanAmount: number;
  loanType: string;
  loanPurpose: string;
  propertyAddress: string;
  status: LendingPadLoanStatus;
  closingDate: string | null;
  lockExpirationDate: string | null;
  loanOfficer: string;
  processor: string;
};

export type LendingPadDocument = {
  documentId: string;
  loanId: string;
  name: string;
  category: string;
  uploadedAt: string;
  status: "received" | "pending" | "reviewed";
};

export type LendingPadCondition = {
  conditionId: string;
  loanId: string;
  title: string;
  status: "open" | "cleared" | "waived";
  priorTo: "docs" | "funding" | "closing";
  clearedAt: string | null;
};
