import { redirect } from "next/navigation";

export default function ReconciliationPage() {
  redirect("/imports?tab=reconciliation");
}
