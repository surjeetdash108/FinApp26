import { notFound } from "next/navigation";
import { AdminConsole } from "../admin-console";

/**
 * The console keeps the open tab in the address bar — switchView() pushes
 * `/admin/<tab>` onto the parent's history — so those URLs have to survive a
 * reload. In production Firebase Hosting rewrites `/admin/**` to the console;
 * `next dev` reads no such rewrite, so without these routes every tab 404s on
 * refresh in local development.
 *
 * The console reads the path on load and opens the matching tab, so each of
 * these renders the same thing: the console itself, which then shows the tab
 * the URL named. Overview lives at `/admin` and so is not one of them, the way
 * the dashboard is left out of menu/[slug].
 */
const TABS = ["users", "subs", "revenue", "usage", "monitor", "studio", "blogs"] as const;

export function generateStaticParams() {
  return TABS.map(slug => ({ slug }));
}

export default async function AdminTabPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!(TABS as readonly string[]).includes(slug)) notFound();

  return <AdminConsole />;
}
