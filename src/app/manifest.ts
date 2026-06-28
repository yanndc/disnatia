import type { MetadataRoute } from "next";
import { getSiteAccessPassword } from "@/lib/site-access";

export default function manifest(): MetadataRoute.Manifest {
  const hasSiteLock = Boolean(getSiteAccessPassword());

  return {
    name: "DisnatIA",
    short_name: "DisnatIA",
    description: "Tableau de bord IA pour portefeuille Disnat",
    start_url: hasSiteLock ? "/site-lock" : "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#0f172a",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
