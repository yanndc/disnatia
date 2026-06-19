"use client";

/**
 * Boundary d'erreur pour le dashboard — capture les erreurs non-attrapées
 * (ex. PrismaClientInitializationError quand Supabase est injoignable).
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center gap-4 rounded-2xl border border-rose-200 bg-rose-50/40 p-8 text-center">
      <h2 className="text-xl font-semibold text-slate-950">
        Impossible de charger les données
      </h2>
      <p className="max-w-md text-sm text-slate-500">
        La connexion à la base de données a échoué.{" "}
        {error.message ? `Détail : ${error.message.slice(0, 200)}` : ""}
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
      >
        Réessayer
      </button>
    </div>
  );
}
