import { requireCurrentUser } from "@/lib/current-user";
import { AdvisorChat } from "@/components/advisor/AdvisorChat";

export default async function AdvisorPage() {
  await requireCurrentUser();

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">AI Guideline Advisor</h1>
        <p className="text-sm text-mutedForeground">
          Ask questions about loan programs, guidelines, and scenarios
        </p>
      </div>
      <AdvisorChat />
    </div>
  );
}
