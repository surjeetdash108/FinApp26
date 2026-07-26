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
        <FirebaseAnalytics />
        <SentryInit />
        <ReduxProvider>{children}</ReduxProvider>
      </body>
    </html>
  );
}
