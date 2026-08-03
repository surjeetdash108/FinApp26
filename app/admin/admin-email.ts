/**
 * The single fixed admin account email — ONE definition, imported by both the
 * /admin gate and the post-login redirect so "who is the admin" can never drift
 * between them. Kept in its own tiny module (no heavy imports) so the login
 * bundle doesn't pull in admin-data.ts.
 *
 * Mirrors ADMIN_EMAIL in the backend (deploy/env.production.yaml / AdminGuard).
 */
export const ADMIN_EMAIL = (
  process.env.NEXT_PUBLIC_ADMIN_EMAIL || "admin@marketcatalyst.ai"
).toLowerCase();

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase() === ADMIN_EMAIL;
}

/** Where a just-signed-in user should land: the admin console, else the app. */
export function postLoginPath(email: string | null | undefined): string {
  return isAdminEmail(email) ? "/admin" : "/dashboard";
}
