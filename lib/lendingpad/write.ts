import { getLendingPadReadConfig } from "./config";
import { lendingPadPostJson } from "./post-json";

export async function importLendingPadNotes(loanUuid: string, notes: string[]): Promise<void> {
  const cfg = getLendingPadReadConfig();
  await lendingPadPostJson(cfg, "/integrations/loans/notes/import", {
    contact: cfg.contactId,
    company: cfg.companyId,
    loan: loanUuid,
    notes,
  });
}

export async function importLendingPadCondition(
  loanUuid: string,
  payload: {
    category: number;
    type: number;
    description: string;
    responsibleParties?: number[];
  },
): Promise<void> {
  const cfg = getLendingPadReadConfig();
  await lendingPadPostJson(cfg, "/integrations/loans/conditions/import", {
    contact: cfg.contactId,
    company: cfg.companyId,
    loan: loanUuid,
    ...payload,
  });
}
