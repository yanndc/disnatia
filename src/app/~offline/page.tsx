import Link from "next/link";
import { DisnatiaLogo } from "@/components/brand/disnatia-logo";
import { WifiOff } from "lucide-react";

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 text-center text-slate-950">
      <DisnatiaLogo className="mb-8 h-10 w-auto text-slate-900" />
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-slate-200">
        <WifiOff className="size-7 text-slate-600" aria-hidden />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Hors ligne</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-600">
        Pas de connexion internet. Les pages déjà visitées peuvent rester
        disponibles ; les données du portefeuille se mettront à jour au retour
        en ligne.
      </p>
      <Link
        href="/overview"
        className="mt-8 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
      >
        Réessayer
      </Link>
    </main>
  );
}
