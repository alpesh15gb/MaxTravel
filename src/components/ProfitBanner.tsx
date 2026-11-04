import { prisma } from "@/lib/db";
import { caseFinance } from "@/lib/case-finance";
import type { SessionUser } from "@/lib/session";

const money = (minor: number, currency: string) => new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100);

/** Profit (green) or loss (red) on one Max ID, per currency. Grey until every supplier cost is confirmed. */
export default async function ProfitBanner({ user, id }: { user: SessionUser; id: string }) {
  if (!user.permissions.includes("payment:view")) return null;
  const { groups } = await caseFinance(prisma, user, id);
  if (!groups.length) return <div className="rounded-xl bg-slate-100 p-4 text-sm text-slate-700">Profit appears here once a booking or visa with a price is added.</div>;
  return <div className="space-y-2" aria-label="Profit or loss">
    {groups.map(g => {
      const known = g.margin !== null, profit = known && g.margin! > 0, loss = known && g.margin! < 0;
      const tone = !known ? "bg-slate-100 text-slate-800" : profit ? "bg-emerald-600 text-white" : loss ? "bg-rose-600 text-white" : "bg-slate-700 text-white";
      const headline = !known ? `Cost needed for ${g.unknown} ${g.unknown === 1 ? "item" : "items"}` : profit ? `Profit ${money(g.margin!, g.currency)}` : loss ? `Loss ${money(-g.margin!, g.currency)}` : "No profit, no loss";
      return <div key={g.currency} className={`rounded-xl p-4 ${tone}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <strong className="text-2xl font-bold tracking-tight">{headline}</strong>
          {groups.length > 1 && <span className="text-sm opacity-80">{g.currency}</span>}
        </div>
        {!known && <p className="mt-1 text-sm">Confirm the supplier cost on each booking or visa to see profit or loss.</p>}
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="opacity-80">Sale</dt><dd className="font-semibold">{money(g.sale, g.currency)}</dd></div>
          <div><dt className="opacity-80">Cost</dt><dd className="font-semibold">{g.cost === null ? "Not confirmed" : money(g.cost, g.currency)}</dd></div>
          <div><dt className="opacity-80">Received</dt><dd className="font-semibold">{money(g.received, g.currency)}</dd></div>
          <div><dt className="opacity-80">{g.balance < 0 ? "Customer credit" : "Customer owes"}</dt><dd className="font-semibold">{money(Math.abs(g.balance), g.currency)}</dd></div>
        </dl>
      </div>;
    })}
  </div>;
}
