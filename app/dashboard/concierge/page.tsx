import { ConciergeDesk } from "@/components/concierge/ConciergeDesk";
import { requireCurrentUser } from "@/lib/current-user";

export const revalidate = 0;

export default async function ConciergePage() {
  await requireCurrentUser();
  return <ConciergeDesk />;
}
