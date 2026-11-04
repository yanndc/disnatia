import { PERFORMANCE_CALC_VERSION } from "@/features/portfolio/performance-calc-version";
import { APP_COMMIT, APP_VERSION, appVersionLabel, appVersionTitle } from "@/lib/app-version";
import { cn } from "@/lib/utils";

/**
 * Badge de version affiché en bas de la navigation.
 * Version applicative (package.json) + SHA du build + version du moteur de calcul.
 */
export function AppVersionBadge({
  className,
  showCalculation = false,
}: {
  className?: string;
  /** Affiche aussi la version du moteur de calcul des indicateurs. */
  showCalculation?: boolean;
}) {
  const title = appVersionTitle(`calcul perf. v${PERFORMANCE_CALC_VERSION}`);

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 text-[11px] leading-none", className)}>
      <span
        className="font-medium tabular-nums text-slate-500"
        title={title}
        aria-label={`Version ${APP_VERSION}${APP_COMMIT ? `, build ${APP_COMMIT}` : ""}`}
      >
        {appVersionLabel()}
      </span>
      {showCalculation ? (
        <span
          className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
          title="Version de la méthode de calcul des indicateurs de performance"
        >
          calc v{PERFORMANCE_CALC_VERSION}
        </span>
      ) : null}
    </div>
  );
}
