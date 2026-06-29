import { requireCurrentUser } from "@/lib/current-user";
import { AdvisorChat } from "@/components/advisor/AdvisorChat";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";

export default async function AdvisorPage() {
  await requireCurrentUser();

  return (
    <div className="qr-dashboard-page animate-fade-up">
      <DashboardPageHeader
        eyebrow="AI tools"
        title="AI Guideline Advisor"
        description="Ask questions about loan programs, guidelines, and scenarios"
      />
      <div className="lo-card min-h-[480px] overflow-hidden p-1">
        <AdvisorChat />
      </div>
    </div>
  );
}
