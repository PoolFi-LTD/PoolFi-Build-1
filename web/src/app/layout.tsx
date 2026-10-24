import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Inter, Space_Grotesk } from "next/font/google";
import { Providers } from "@/components/providers";
import { SPLASH_SCRIPT } from "@/lib/splash";
import "./globals.css";
import "./motion.css";
import "./mobile.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });
const instrumentSerif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "italic", variable: "--font-instrument-serif" });

export const metadata: Metadata = {
  title: "PoolFi",
  description: "Group money. Finally fixed. Collect class dues, birthday money and office welfare with one link.",
  // Installed to an iPhone's home screen, PoolFi opens like an app (and can show notifications).
  appleWebApp: { capable: true, title: "PoolFi", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#1b4fd8",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The head script marks the page before it is drawn, hence suppressHydrationWarning.
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} ${instrumentSerif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SPLASH_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
