"use client";

import { shapeLeadUrl } from "@/lib/shape-link";

type ActionRecord = {
  borrower_email?: string | null;
  shape_record_id?: number | null;
  lendingpad_loan_uuid?: string | null;
  teamsUrl?: string | null;
};

export function ActionButtons({ record }: { record: ActionRecord }) {
  const shapeUrl = shapeLeadUrl(record.shape_record_id);
  const lendingPadUrl = record.lendingpad_loan_uuid
    ? `https://app.lendingpad.com/loans/${record.lendingpad_loan_uuid}`
    : "https://prod.lendingpad.com/questrock-llc/login";
  const emailUrl = record.borrower_email ? `mailto:${record.borrower_email}` : undefined;
  const teamsUrl =
    record.teamsUrl ??
    (record.borrower_email
      ? `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(record.borrower_email)}`
      : "https://teams.microsoft.com");

  return (
    <div className="flex flex-wrap gap-2.5">
      {shapeUrl ? (
        <a
          href={shapeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="action-link shape inline-flex min-h-[38px] items-center justify-center rounded-lg px-3.5 text-[13px] font-black text-[#5f2500] no-underline shadow-lg"
        >
          Open Shape CRM
        </a>
      ) : null}
      <a
        href={lendingPadUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="action-link lendingpad inline-flex min-h-[38px] items-center justify-center rounded-lg px-3.5 text-[13px] font-black text-white no-underline shadow-lg"
      >
        Open LendingPad
      </a>
      {emailUrl ? (
        <a
          href={emailUrl}
          className="action-link outlook inline-flex min-h-[38px] items-center justify-center rounded-lg px-3.5 text-[13px] font-black text-white no-underline shadow-lg"
        >
          Email Client
        </a>
      ) : null}
      <a
        href={teamsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="action-link teams inline-flex min-h-[38px] items-center justify-center rounded-lg px-3.5 text-[13px] font-black text-white no-underline shadow-lg"
      >
        Open Teams
      </a>
    </div>
  );
}
