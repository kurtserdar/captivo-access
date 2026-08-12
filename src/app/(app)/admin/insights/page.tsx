import { requireCapability } from "@/lib/current-user";
import { getDashboardStats, getSiteHealth, getRecentActivity } from "@/lib/dashboard/stats";
import { getInsights } from "@/lib/dashboard/insights";
import { DashboardInsights } from "../../_dashboard/dashboard-insights";
import { SiteHealthPanel } from "../../_dashboard/site-health-panel";
import { RecentActivityPanel } from "../../_dashboard/recent-activity-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Insights" };

export default async function InsightsPage() {
  await requireCapability("read_console");
  const [stats, siteHealth, activity, insights] = await Promise.all([
    getDashboardStats(), getSiteHealth(), getRecentActivity(), getInsights(),
  ]);
  return (
    <main>
      <div className="page-head"><div><h1>Insights</h1></div></div>
      <DashboardInsights stats={stats} insights={insights} />
      <div className="dash-cols">
        <SiteHealthPanel sites={siteHealth} />
        <RecentActivityPanel events={activity} />
      </div>
    </main>
  );
}
