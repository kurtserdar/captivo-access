import { requireUser } from "@/lib/current-user";
import { historyPage, HISTORY_PAGE_SIZE } from "@/lib/portal/history";
import { HistoryList } from "./history-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "History" };

export default async function HistoryPage() {
  const user = await requireUser();
  const initial = await historyPage(user.id, 0);
  return (
    <div className="vp-home">
      <div className="vp-head">
        <div>
          <h1 className="vp-greet">Session history</h1>
          <p className="vp-sub">Your past remote sessions.</p>
        </div>
      </div>
      <HistoryList initial={initial} pageSize={HISTORY_PAGE_SIZE} />
    </div>
  );
}
