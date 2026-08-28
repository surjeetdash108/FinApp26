import { apiGet } from "../iq/backend";
import { TRACKED_FEATURES, FEATURE_LABEL, FEATURE_GROUP } from "../iq/feature-adoption";
import { ENTITLEMENTS } from "./entitlement-catalog";
import { ADMIN_EMAIL } from "./admin-email";

/**
 * Builds the admin console's dataset — sourced ENTIRELY from the backend.
 *
 * New-architecture rule: the browser never talks to Firebase directly. The flow
 * is UI → backend → Firebase → backend → UI. So this reads the backend's
 * AdminGuard-protected read-models (`GET /admin/users`, `/admin/subscriptions`,
 * `GET /plans`) via `apiGet` (which attaches the admin's Firebase ID token), and
 * does ONLY presentation mapping here — MRR/LTV/initials/colours are derived in
 * plain JS from the backend rows, not fetched from Firestore.
 *
 * The console (`public/admin/console.html`) renders once at module scope from a
 * dataset staged in sessionStorage; this produces rows in exactly that shape.
 * Anything genuinely unavailable is reported as 0/null rather than estimated.
 */

/**
 * Human labels for the entitlement keys, for the console's per-plan editor.
 * Kept beside the keys themselves so a new entitlement cannot ship without one.
 */
export const ENTITLEMENT_CATALOG = ENTITLEMENTS.map(e => ({
  key: e.key,
  label: e.label,
  description: e.description,
  group: e.group,
  staffOnly: e.staffOnly === true,
  unbuilt: e.unbuilt === true,
}));

const AVATAR_COLORS = [
  "#7c6cf5", "#38d6e6", "#2fe6a6", "#ffb547", "#ff5d7a", "#9d8dff", "#5bd0ff", "#ff8a5b",
];

// ADMIN_EMAIL lives in ./admin-email (a tiny module the login flow can import
// without pulling in this file). Re-exported so page.tsx's existing
// `import { ADMIN_EMAIL } from "./admin-data"` keeps working.
export { ADMIN_EMAIL };

export interface ConsoleUserRow {
  id: string;
  name: string;
  email: string;
  plan: string;
  status: string;
  mrr: number;
  color: string;
  initials: string;
  country: string;
  joined: string;      // ISO — revived to Date inside the console
  lastActive: string;  // ISO
  watchlists: number;
  holdings: number;
  apiCalls: number;
  alerts: number;
  renewsIn: number | null;
  ltv: number;
}

export interface FeatureAdoptionRow {
  feature: string;
  label: string;
  /** Section heading in the admin panel (Intelligence, Charting, …). */
  group: string;
  /** Total opens across all users. */
  opens: number;
  /** Distinct users who opened it — the adoption number that matters. */
  users: number;
  lastOpened: string | null;
  /** True when the feature is tracked but has never been opened. */
  neverOpened: boolean;
}

export interface ConsolePlanRow {
  id: string;
  name: string;
  amount: number;
  currency: string;
  billingCycle: string;
  /** Entitlement key → granted. Editable from the console. */
  featureFlags: Record<string, boolean>;
  active: boolean;
  sortOrder: number;
}

/** A blog article for the console's newspaper-layout board. Mirrors the backend
 *  `/admin/blogs` row shape; the console reads/writes these through the
 *  postMessage bridge (it has no backend token of its own). */
export interface ConsoleBlogRow {
  id: string;
  /** Board zone: lead | stock | edu | news. */
  zone: string;
  /** 1-based order within the zone (lowest first). */
  rank: number;
  kick: string;
  title: string;
  dek: string;
  author: string;
  read: string;
  html: string;
  /** "Published" | "Draft". */
  status: string;
  /** Display date string, as stored. */
  date: string;
  /** Source document, when the post was published from a PDF or Word file.
   *  The editor shows the document itself instead of an editable body. */
  pdfUrl: string | null;
  pdfName: string | null;
  sourceKind: string | null;
  /** How the body is authored: "html" | "text" | "pdf" | "doc". Decides which
   *  editor the console opens and how the site renders the post. */
  format: string;
  /** Stylesheets for an html post, split out of the body by the backend. */
  css: string[];
  /** Hero image shown above the article on the site. */
  heroImageUrl: string | null;
}

export interface ApiHealthEndpoint {
  method: string;
  path: string;
  controller: string;
  guarded: boolean;
  probe:
    | { status: number; ok: boolean; up: boolean; ms: number; error?: string }
    | { skipped: true; reason: string };
}
export interface VendorHealth {
  name: string;
  keyName: string;
  keyPresent: boolean;
  online: boolean;
  status: number | null;
  ms: number | null;
  note: string;
  request: { method: string; url: string } | null;
  response: string | null;
}
export interface ApiHealthReport {
  service: string;
  generatedAt: string;
  vendors?: VendorHealth[];
  summary: {
    total: number;
    byMethod: Record<string, number>;
    probed: number;
    ok: number;
    needsInput: number;
    down: number;
    skipped: number;
  };
  endpoints: ApiHealthEndpoint[];
}

export interface ConsoleDataset {
  users: ConsoleUserRow[];
  /** Full plans, so the console can render and edit per-plan entitlements. */
  plans: ConsolePlanRow[];
  /** Blog articles for the console's zone board. Mutations flow back through
   *  the postMessage bridge (parent → backend); this is the initial snapshot. */
  blogs: ConsoleBlogRow[];
  /** The entitlement catalog: label, one-line description, group and the
   *  staffOnly / unbuilt markers the editor renders. Includes every key, so a
   *  plan document missing one still shows it as an off toggle. */
  entitlementCatalog: typeof ENTITLEMENT_CATALOG;
  /** Where the Monitor tab loads the backend's own ops UI from. */
  backendUrl: string | null;
  /** Backend route inventory + health probe for the Monitor tab (null if the
   *  endpoint is unreachable). */
  apiHealth: ApiHealthReport | null;
  featureAdoption: FeatureAdoptionRow[];
  /** Plan display name → monthly price in MAJOR units, for the console's MRR maths. */
  price: Record<string, number>;
  generatedAt: string;
  counts: {
    users: number;
    payments: number;
    plans: number;
    /** Staff rows filtered out of every figure above. The backend does the
     *  exclusion now, so from the client's side this is 0 (surfaced for shape
     *  compatibility with the console's counts panel). */
    excludedStaff: number;
  };
}

// ── Backend response shapes (mirror src/plans/admin-analytics.service.ts and
//    src/plans/plans.registry.ts) ──────────────────────────────────────────
interface BackendUserRow {
  uid: string;
  name: string | null;
  email: string | null;
  planId: string;
  planName: string;
  status: string;                 // ACTIVE | TRIALING | EXPIRED | ...
  storedStatus?: string;
  subscriptionStartDate?: string | null;
  subscriptionExpiryDate?: string | null;
  daysRemaining?: number | null;
  joinedDate?: string | null;
  lastLogin?: string | null;
  watchlists?: number;
  holdings?: number;
  apiCalls?: number;
  alerts?: number;
}
interface BackendAdoptionRow {
  feature: string;
  opens: number;
  users: number;
  lastOpened: string | null;
}
interface BackendPaymentRow {
  paymentId: string;
  userId: string | null;
  amount?: number;                // minor units
  currency?: string;
  paymentStatus?: string;         // SUCCESS | ...
  paymentDate?: string | null;
}
interface BackendPlan {
  id: string;
  name: string;
  amount?: number;                // minor units
  currency?: string;
  billingCycle?: string;
  featureFlags?: Record<string, boolean>;
  active?: boolean;
  sortOrder?: number;
}
interface BackendBlog {
  id: string;
  zone?: string;
  rank?: number;
  kick?: string;
  title?: string;
  dek?: string;
  author?: string;
  read?: string;
  html?: string;
  status?: string;
  date?: string;
  pdfUrl?: string | null;
  pdfName?: string | null;
  sourceKind?: string | null;
  format?: string;
  css?: string[];
  heroImageUrl?: string | null;
}

/** Presentation mapping for one backend blog row → the console's shape. Missing
 *  fields default so a partial row still renders (never crashes the board). */
function toConsoleBlog(b: BackendBlog): ConsoleBlogRow {
  return {
    id: b.id,
    zone: b.zone ?? "lead",
    rank: typeof b.rank === "number" ? b.rank : 999,
    kick: b.kick ?? "",
    title: b.title ?? "",
    dek: b.dek ?? "",
    author: b.author ?? "",
    read: b.read ?? "",
    html: b.html ?? "",
    status: b.status ?? "Published",
    date: b.date ?? "",
    pdfUrl: b.pdfUrl ?? null,
    pdfName: b.pdfName ?? null,
    sourceKind: b.sourceKind ?? null,
    // The backend derives a format for posts written before the field existed,
    // so this is only defensive against an older deploy answering.
    format: b.format ?? (b.pdfUrl ? "pdf" : "text"),
    css: Array.isArray(b.css) ? b.css : [],
    heroImageUrl: b.heroImageUrl ?? null,
  };
}

/**
 * Fetches the blog board's articles from the AdminGuard-protected backend
 * (`GET /admin/blogs`). Used both for the initial staged dataset and to re-fetch
 * after a write so the board can reconcile to the true backend state. Returns []
 * (never throws) when the endpoint is unavailable, so a missing blogs surface
 * degrades to an empty board rather than blanking the whole console.
 */
export async function fetchAdminBlogs(): Promise<ConsoleBlogRow[]> {
  try {
    const res = await apiGet<{ blogs: BackendBlog[] }>("/api/admin/blogs");
    return (res.blogs ?? []).map(toConsoleBlog);
  } catch {
    return [];
  }
}

/** The console's status vocabulary, lower-case. */
function toConsoleStatus(status: string): string {
  switch ((status || "").toUpperCase()) {
    case "ACTIVE": return "active";
    case "TRIALING": return "trialing";
    case "PAST_DUE": return "past_due";
    case "CANCELLED": return "canceled";
    case "EXPIRED": return "canceled";
    default: return "active"; // free users with no subscription read as active
  }
}

function initialsOf(name: string, email: string): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/**
 * Monthly-equivalent price in major units, so a yearly plan does not overstate
 * MRR 12×. Rounded to 2dp so every downstream sum stays on clean cents.
 */
function monthlyMajor(amountMinor: number, billingCycle: string): number {
  const major = (amountMinor ?? 0) / 100;
  const monthly =
    billingCycle === "yearly" ? major / 12 : billingCycle === "monthly" ? major : 0;
  return Math.round(monthly * 100) / 100;
}

/**
 * Names the backend's aggregated adoption rows and unions them with the full
 * TRACKED_FEATURES catalog, so every tracked feature appears — including those
 * with zero opens ("which features does nobody use" is the question this exists
 * to answer). The backend does the aggregation + staff exclusion; label/group
 * naming stays here in the catalog so a nav rename keeps a feature's history.
 */
function rollUpAdoption(rows: BackendAdoptionRow[]): FeatureAdoptionRow[] {
  const byFeature = new Map(rows.map(r => [r.feature, r]));

  const keys = new Set<string>([
    ...TRACKED_FEATURES.map(f => f.key),
    ...byFeature.keys(),
  ]);

  return [...keys]
    .map(key => {
      const agg = byFeature.get(key);
      return {
        feature: key,
        label: FEATURE_LABEL.get(key) ?? key,
        group: FEATURE_GROUP.get(key) ?? "Other",
        opens: agg?.opens ?? 0,
        users: agg?.users ?? 0,
        lastOpened: agg?.lastOpened ?? null,
        neverOpened: !agg || agg.opens === 0,
      };
    })
    .sort((a, b) => b.opens - a.opens || a.label.localeCompare(b.label));
}

export async function buildAdminDataset(): Promise<ConsoleDataset> {
  // UI → backend → Firebase → backend → UI. All three reads hit AdminGuard-
  // protected (or public, for /plans) backend routes; the browser touches no
  // Firestore. Payments may be empty → subscriptions falls back to [].
  const [usersRes, subsRes, plansRes, adoptRes, apiHealthRes, blogs] = await Promise.all([
    apiGet<{ users: BackendUserRow[] }>("/api/admin/users?limit=500"),
    apiGet<{ subscriptions: BackendPaymentRow[] }>("/api/admin/subscriptions?limit=1000").catch(
      () => ({ subscriptions: [] as BackendPaymentRow[] }),
    ),
    apiGet<{ plans: BackendPlan[] }>("/plans"),
    apiGet<{ adoption: BackendAdoptionRow[] }>("/api/admin/feature-adoption").catch(
      () => ({ adoption: [] as BackendAdoptionRow[] }),
    ),
    apiGet<ApiHealthReport>("/api/admin/apihealth").catch(() => null),
    fetchAdminBlogs(),
  ]);

  const backendUsers = usersRes.users ?? [];
  const payments = subsRes.subscriptions ?? [];
  const plans = plansRes.plans ?? [];
  const adoption = adoptRes.adoption ?? [];
  const apiHealth = apiHealthRes ?? null;

  const price: Record<string, number> = {};
  for (const p of plans) {
    price[p.name ?? p.id] = monthlyMajor(p.amount ?? 0, p.billingCycle ?? "none");
  }

  // Lifetime value = what this user has actually paid (SUCCESS rows only). Not
  // modelled — no payments yields 0, which is the truth.
  const paidByUser = new Map<string, number>();
  for (const p of payments) {
    if (p.paymentStatus !== "SUCCESS" || !p.userId) continue;
    paidByUser.set(p.userId, (paidByUser.get(p.userId) ?? 0) + (p.amount ?? 0) / 100);
  }

  const users: ConsoleUserRow[] = backendUsers.map((u, i) => {
    const planId = u.planId ?? "free";
    const planLabel = u.planName ?? (planId.charAt(0).toUpperCase() + planId.slice(1));
    const status = toConsoleStatus(u.status);
    const isPaying =
      (status === "active" || status === "trialing" || status === "past_due") && planId !== "free";
    const name = u.name ?? (u.email ?? u.uid).split("@")[0];
    const email = u.email ?? "—";
    const remaining = typeof u.daysRemaining === "number" && u.daysRemaining >= 0 ? u.daysRemaining : null;

    return {
      id: u.uid,
      name,
      email,
      plan: planLabel,
      status,
      mrr: isPaying ? (price[planLabel] ?? 0) : 0,
      color: AVATAR_COLORS[i % AVATAR_COLORS.length],
      initials: initialsOf(name, email),
      // The backend read-model does not carry country; shown as "—" rather than
      // guessed. Add it to the /admin/users projection to populate this.
      country: "—",
      joined: u.joinedDate ?? new Date().toISOString(),
      lastActive: u.lastLogin ?? u.joinedDate ?? new Date().toISOString(),
      // Engagement counts computed server-side: watchlists/holdings/apiCalls are
      // real (apiCalls via the backend's request-metering interceptor); alerts
      // stays 0 until the alerts engine (R44) writes users/{uid}/alerts.
      watchlists: u.watchlists ?? 0,
      holdings: u.holdings ?? 0,
      apiCalls: u.apiCalls ?? 0,
      alerts: u.alerts ?? 0,
      renewsIn: status === "active" || status === "trialing" ? remaining : null,
      ltv: Math.round(paidByUser.get(u.uid) ?? 0),
    };
  });

  const planRows: ConsolePlanRow[] = plans
    .map(p => ({
      id: p.id,
      name: p.name ?? p.id,
      amount: p.amount ?? 0,
      currency: p.currency ?? "USD",
      billingCycle: p.billingCycle ?? "none",
      // Every catalog key present, defaulting to false — a key absent from the
      // plan must render as an off toggle, not vanish from the editor.
      featureFlags: Object.fromEntries(
        ENTITLEMENT_CATALOG.map(e => [e.key, p.featureFlags?.[e.key] === true]),
      ),
      active: p.active ?? true,
      sortOrder: p.sortOrder ?? 0,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    users,
    plans: planRows,
    blogs,
    entitlementCatalog: ENTITLEMENT_CATALOG,
    backendUrl: process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ?? null,
    apiHealth,
    // Aggregated + staff-excluded server-side (GET /admin/feature-adoption);
    // named/unioned with the full catalog here so every tracked feature shows,
    // including zero-open ones.
    featureAdoption: rollUpAdoption(adoption),
    price,
    generatedAt: new Date().toISOString(),
    counts: {
      users: users.length,
      payments: payments.length,
      plans: plans.length,
      excludedStaff: 0, // backend already filters staff from /admin/users
    },
  };
}

export const ADMIN_DATA_KEY = "admin:data";
