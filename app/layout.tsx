import type { Metadata } from "next";
import { Geist, Space_Grotesk, JetBrains_Mono, Inter, DM_Sans, Plus_Jakarta_Sans, IBM_Plex_Sans, Outfit, Manrope } from "next/font/google";
import { FirebaseAnalytics } from "./firebase-analytics";
import { SentryInit } from "./sentry-init";
import { ReduxProvider } from "./store/redux-provider";
import "./globals.css";
import "./iq.css";
import "./landing.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://marketcatalyst.ai"),
  title: "MarketCatalyst — Market Intelligence Terminal",
  description: "From ticker to thesis in under 60 seconds. Earnings, movers, analyst actions, insider flows and your portfolio — all in one terminal.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "https://marketcatalyst.ai",
    siteName: "MarketCatalyst",
    title: "MarketCatalyst — Market Intelligence Terminal",
    description: "From ticker to thesis in under 60 seconds. Earnings, movers, analyst actions, insider flows and your portfolio — all in one terminal.",
  },
  twitter: {
    card: "summary_large_image",
    title: "MarketCatalyst — Market Intelligence Terminal",
    description: "From ticker to thesis in under 60 seconds. Earnings, movers, analyst actions, insider flows and your portfolio — all in one terminal.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} ${inter.variable} ${dmSans.variable} ${plusJakartaSans.variable} ${ibmPlexSans.variable} ${outfit.variable} ${manrope.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/*
          Canonicalise the host BEFORE any app code runs.

          Firebase Hosting serves this site on both marketcatalyst.web.app and
          marketcatalyst.firebaseapp.com. Only the .web.app handler URI is
          registered on the OAuth client (verified in app/firebase.ts), so on
          .firebaseapp.com resolveAuthDomain() falls back to a CROSS-ORIGIN
          authDomain — and mobile Google sign-in breaks there under Safari ITP,
          stranding the user on the login page.

          Rather than register a second handler URI (a Console change), we send
          .firebaseapp.com traffic to the known-good host. This is a RAW inline
          script — first child of <body>, so it executes during HTML parse,
          ahead of hydration and ahead of firebase.ts's module-load
          `createAuth()`. (next/script's beforeInteractive JSON-escapes its
          string body, turning the `"` into `\\"` — invalid JS that never runs;
          dangerouslySetInnerHTML is inserted verbatim.) location.replace keeps
          the dead host out of history; path + query + hash are preserved.

          Scoped to the exact alternate host, so localhost, preview channels,
          .web.app and any future custom domain are untouched.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{if(location.hostname==="marketcatalyst.firebaseapp.com"){location.replace("https://marketcatalyst.web.app"+location.pathname+location.search+location.hash);}}catch(e){}})();',
          }}
        />
        {/*
          Self-heal stale bundles after a redeploy. A tab still holding an old
          bundle that navigates to a route asks for chunk files whose hashes no
          longer exist on Hosting → the dynamic import rejects and the app
          router renders NOTHING (silent blank screen, no spinner, no error
          boundary — the failure happens before any component renders). Detect
          the ChunkLoadError signature and hard-reload ONCE per session, which
          fetches the current bundle and replays the navigation.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){function stale(m){return /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed/i.test(m||"")}function heal(){try{if(sessionStorage.getItem("mc-chunk-reload"))return;sessionStorage.setItem("mc-chunk-reload","1");location.reload();}catch(e){}}window.addEventListener("error",function(e){if(stale(e&&e.message))heal()},true);window.addEventListener("unhandledrejection",function(e){var r=e&&e.reason;if(stale(r&&(r.message||String(r))))heal()});})();',
          }}
        />
        <FirebaseAnalytics />
        <SentryInit />
        <ReduxProvider>{children}</ReduxProvider>
      </body>
    </html>
  );
}
