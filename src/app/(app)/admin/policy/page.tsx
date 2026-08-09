import { requireCapability } from "@/lib/current-user";
import { getSessionPolicy } from "@/lib/policy/session-policy";
import { SessionPolicyForm } from "./session-policy-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Policy" };

export default async function AdminPolicyPage() {
  await requireCapability("configure");
  const policy = await getSessionPolicy();

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Policy</h1>
          <p>Organization-wide security controls. Applied everywhere — both the console and vendor sessions.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Session controls</h2></div>
        <SessionPolicyForm initial={policy} />
      </div>
    </main>
  );
}
