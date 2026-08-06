import { notFound } from "next/navigation";
import { menuItems } from "../../dashboard/menu-items";
import { IQShell } from "../../iq/shell";
import { EarningsScreen } from "../../iq/screens/earnings";
import { MoversScreen } from "../../iq/screens/movers";
import { HeatmapScreen } from "../../iq/screens/heatmap";
import { AnalystScreen } from "../../iq/screens/analyst";
import { ScreenerScreen } from "../../iq/screens/screener";
import { IPOsScreen } from "../../iq/screens/ipos";
import { PortfolioScreen } from "../../iq/screens/portfolio";
import { WatchlistScreen } from "../../iq/screens/watchlist";
import { StockScreen } from "../../iq/screens/stock";
import { InsiderScreen } from "../../iq/screens/insider";
import { CommentaryScreen } from "../../iq/screens/commentary";
import { RecapScreen } from "../../iq/screens/recap";
import { MacroScreen } from "../../iq/screens/macro";
import { OptionsScreen } from "../../iq/screens/options";
import { ThemesScreen } from "../../iq/screens/themes";

export function generateStaticParams() {
  return menuItems
    .filter(item => item.slug !== "dashboard")
    .map(item => ({ slug: item.slug }));
}

const SCREENS: Record<string, React.ReactNode> = {
  earnings:    <EarningsScreen />,
  movers:      <MoversScreen />,
  heatmap:     <HeatmapScreen />,
  analyst:     <AnalystScreen />,
  screener:    <ScreenerScreen />,
  themes:      <ThemesScreen />,
  ipos:        <IPOsScreen />,
  portfolio:   <PortfolioScreen />,
  watchlist:   <WatchlistScreen />,
  stock:       <StockScreen />,
  options:     <OptionsScreen />,
  insider:     <InsiderScreen />,
  commentary:  <CommentaryScreen />,
  recap:         <RecapScreen mode="daily" />,
  "weekly-recap": <RecapScreen mode="weekly" />,
  macro:       <MacroScreen />,
};

export default async function MenuPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const screen = SCREENS[slug];
  if (!screen) notFound();

  return <IQShell>{screen}</IQShell>;
}
