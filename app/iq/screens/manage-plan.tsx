"use client";

import { useAppSelector } from "../../store/hooks";

const FEATURES = [
  { label: "Market Dashboard", free: true, premium: true },
  { label: "Earnings Hub", free: true, premium: true },
  { label: "Market Movers & Heatmap", free: true, premium: true },
  { label: "Watchlist (up to 5 stocks)", free: true, premium: false },
  { label: "Watchlist (unlimited)", free: false, premium: true },
  { label: "Stock Detail (3 symbols)", free: true, premium: false },
  { label: "Stock Detail (unlimited)", free: false, premium: true },
  { label: "Portfolio Pulse", free: false, premium: true },
  { label: "AI Copilot", free: false, premium: true },
  { label: "13F Intelligence", free: false, premium: true },
  { label: "Screener with all filters", free: false, premium: true },
  { label: "Weekly Recaps (PDF export)", free: false, premium: true },
  { label: "Analyst Actions feed", free: false, premium: true },
  { label: "Macro & VIX calendar", free: true, premium: true },
  { label: "Priority support", free: false, premium: true },
];

// Plan pricing mirrors plans.registry.ts — the backend seed for the Firestore
// `plans` collection, which is the single source of truth: Free $0, Plus
// $29.99/mo, Pro $49.99/mo, all USD. Amounts are MINOR units (cents), the same
// convention as the registry's `amount` field (2999 / 4999); formatted to major
// units only at display. Previously this screen hardcoded $19/$0, which matched
// neither the catalog price nor its currency (BUG-DATA-013).
const CURRENCY = "USD";
const PLAN_PRICING = [
  { id: "free", name: "Free", amountMinor: 0, blurb: "Core market intelligence tools" },
  { id: "plus", name: "Plus", amountMinor: 2999, blurb: "Real charting, research depth and personal tools" },
  { id: "pro", name: "Pro", amountMinor: 4999, blurb: "Everything — options, 13F, AI and data export" },
] as const;

function formatPrice(amountMinor: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: CURRENCY,
    minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
  }).format(amountMinor / 100);
}

function Check({ ok }: { ok: boolean }) {
  return ok
    ? <span style={{ color: "var(--up)", fontSize: "0.9375rem", fontWeight: 700 }}>✓</span>
    : <span style={{ color: "var(--text-dim-solid)", fontSize: "0.8125rem" }}>—</span>;
}

export function ManagePlanScreen() {
  const { data: profile } = useAppSelector(state => state.profile);
  const { user } = useAppSelector(state => state.auth);

  const isPremium = profile?.tier !== "free";
  const tier = profile?.tier ?? "free";
  const displayName = profile?.name || user?.displayName || "User";
  const email = user?.email ?? "";

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Manage Plan</div>
          <div className="page-sub">Review your subscription and upgrade to unlock all features</div>
        </div>
      </div>

      <div className="dash" style={{ maxWidth: 820, gap: 14, gridTemplateColumns: "1fr" }}>

        {/* Current plan card */}
        <div className="card col-12">
          <div className="card-h"><h3>Current Plan</h3></div>
          <div className="card-b">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <span style={{
                    padding: "3px 12px", borderRadius: 99, fontSize: "0.7188rem", fontWeight: 700,
                    background: isPremium ? "var(--brand-dim)" : "var(--surface-3)",
                    color: isPremium ? "var(--brand-2)" : "var(--text-dim-solid)",
                    border: `1px solid ${isPremium ? "var(--brand)" : "var(--border)"}`,
                  }}>
                    {isPremium ? "◈ Premium" : "Free"}
                  </span>
                  {isPremium && (
                    <span style={{ fontSize: "0.75rem", color: "var(--text-dim-solid)" }}>Active</span>
                  )}
                </div>
                <div style={{ fontSize: "0.8125rem", color: "var(--text)", marginTop: 4 }}>{displayName}</div>
                <div style={{ fontSize: "0.7188rem", color: "var(--text-dim-solid)" }}>{email}</div>
              </div>
              {!isPremium && (
                <button style={{
                  padding: "9px 20px", borderRadius: 99,
                  background: "var(--brand)", border: "none",
                  color: "#fff", fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer",
                }}>
                  ◈ Upgrade to Premium
                </button>
              )}
              {isPremium && (
                <button style={{
                  padding: "9px 20px", borderRadius: 99,
                  background: "var(--surface-2)", border: "1px solid var(--border)",
                  color: "var(--text)", fontSize: "0.8125rem", fontWeight: 500, cursor: "pointer",
                }}>
                  Manage Billing
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Pricing cards — prices and currency come from plans.registry.ts (USD:
            Free $0, Plus $29.99/mo, Pro $49.99/mo), rendered via PLAN_PRICING so
            the screen can never drift from the catalog again. */}
        <div className="col-12" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {PLAN_PRICING.map((p) => {
            const isCurrent = tier === p.id;
            const isPaid = p.amountMinor > 0;
            const featured = p.id === "pro";
            return (
              <div key={p.id} className="card" style={{
                border: `1.5px solid ${featured ? "var(--brand)" : "var(--border)"}`,
                background: featured ? "var(--surface-1)" : undefined,
                position: "relative", overflow: "visible",
              }}>
                {isCurrent && (
                  <div style={{
                    position: "absolute", top: -10, right: 16,
                    background: "var(--brand)", color: "#fff",
                    fontSize: "0.625rem", fontWeight: 700, padding: "2px 10px", borderRadius: 99,
                    letterSpacing: ".06em",
                  }}>YOUR PLAN</div>
                )}
                <div className="card-h">
                  <h3 style={isPaid ? { color: "var(--brand-2)" } : undefined}>
                    {isPaid ? "◈ " : ""}{p.name}
                  </h3>
                  <span style={{ marginLeft: "auto", fontSize: "1.25rem", fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--f-display)" }}>
                    {formatPrice(p.amountMinor)}
                    {isPaid && <span style={{ fontSize: "0.8125rem", fontWeight: 400, color: "var(--text-dim-solid)" }}>/mo</span>}
                  </span>
                </div>
                <div className="card-b">
                  <div style={{ fontSize: "0.75rem", color: "var(--text-dim-solid)", marginBottom: 10 }}>{p.blurb}</div>
                  {isCurrent ? (
                    <div style={{ padding: "6px 12px", borderRadius: 99, background: "var(--surface-3)", border: "1px solid var(--border)", textAlign: "center", fontSize: "0.75rem", color: "var(--text-dim-solid)", fontWeight: 600 }}>Current Plan</div>
                  ) : isPaid ? (
                    <button style={{
                      width: "100%", padding: "8px", borderRadius: 99,
                      background: "var(--brand)", border: "none",
                      color: "#fff", fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer",
                    }}>
                      Upgrade to {p.name}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {/* Feature comparison */}
        <div className="card col-12">
          <div className="card-h"><h3>Feature Comparison</h3></div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Feature</th>
                  <th style={{ textAlign: "center", width: 80 }}>Free</th>
                  <th style={{ textAlign: "center", width: 100, color: "var(--brand-2)" }}>◈ Premium</th>
                </tr>
              </thead>
              <tbody>
                {FEATURES.map(f => (
                  <tr key={f.label}>
                    <td style={{ color: "var(--text)" }}>{f.label}</td>
                    <td style={{ textAlign: "center" }}><Check ok={f.free} /></td>
                    <td style={{ textAlign: "center" }}><Check ok={f.premium} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Billing / contact */}
        <div className="card col-12">
          <div className="card-h"><h3>Billing & Support</h3></div>
          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: "0.8125rem", color: "var(--text)" }}>
              Billing is managed via Stripe. All plans are billed monthly and can be cancelled at any time.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button style={{
                padding: "7px 16px", borderRadius: 99,
                background: "var(--surface-2)", border: "1px solid var(--border)",
                color: "var(--text)", fontSize: "0.7812rem", fontWeight: 500, cursor: "pointer",
              }}>View Invoices</button>
              <button style={{
                padding: "7px 16px", borderRadius: 99,
                background: "var(--surface-2)", border: "1px solid var(--border)",
                color: "var(--text)", fontSize: "0.7812rem", fontWeight: 500, cursor: "pointer",
              }}>Update Payment Method</button>
              {isPremium && (
                <button style={{
                  padding: "7px 16px", borderRadius: 99,
                  background: "var(--surface-2)", border: "1px solid var(--down)",
                  color: "var(--down)", fontSize: "0.7812rem", fontWeight: 500, cursor: "pointer",
                }}>Cancel Subscription</button>
              )}
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
