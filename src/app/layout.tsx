import type { Metadata } from "next";
import { after, connection } from "next/server";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "DisnatIA",
  description: "Tableau de bord IA pour portefeuille Disnat",
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
        {children}
      </body>
    </html>
  );
}
