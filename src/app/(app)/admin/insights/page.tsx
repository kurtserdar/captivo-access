import { requireCapability } from "@/lib/current-user";
import { getDashboardStats } from "@/lib/dashboard/stats";
import { getInsights } from "@/lib/dashboard/insights";
import { DashboardInsights } from "../../_dashboard/dashboard-insights";

export const dynamic = "force-dynamic";
export const metadata = { title: "Insights" };

export default async function InsightsPage() {
  await requireCapability("read_console");
  const [stats, insights] = await Promise.all([getDashboardStats(), getInsights()]);
  return (
    <main>
      <div className="page-head"><div><h1>Insights</h1></div></div>
      <DashboardInsights stats={stats} insights={insights} />
    </main>
  );
}
