import type { Metadata, Viewport } from "next";
import { after, connection } from "next/server";
import { Geist, Geist_Mono } from "next/font/google";
import { AppSerwistProvider } from "@/components/pwa/serwist-provider";
import { refreshUsdCadRatesIfStale } from "@/lib/fx/refresh-usd-cad-rates";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "DisnatIA",
  title: {
    default: "DisnatIA",
    template: "%s | DisnatIA",
  },
  description: "Tableau de bord IA pour portefeuille Disnat",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "DisnatIA",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  after(() => {
    void refreshUsdCadRatesIfStale().catch((err) => {
      console.error("[usd-cad-rates]", err);
    });
  });

  return (
    <html lang="fr" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-slate-50 font-sans text-slate-950 antialiased">
        <AppSerwistProvider>{children}</AppSerwistProvider>
      </body>
    </html>
  );
}
