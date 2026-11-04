/**
 * Informations de version affichées dans l'UI (bas de la sidebar).
 *
 * Les valeurs sont injectées au build par `next.config.ts` (`env`) :
 * - `NEXT_PUBLIC_APP_VERSION` : `version` de package.json
 * - `NEXT_PUBLIC_GIT_COMMIT`  : SHA court du commit déployé
 * - `NEXT_PUBLIC_BUILD_TIME`  : horodatage du build
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION?.trim() || "dev";
export const APP_COMMIT = process.env.NEXT_PUBLIC_GIT_COMMIT?.trim() || "";
export const APP_BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME?.trim() || "";

/** Libellé compact : `v0.1.0 · 2a07972`. */
export function appVersionLabel(): string {
  const version = APP_VERSION.startsWith("v") ? APP_VERSION : `v${APP_VERSION}`;
  return APP_COMMIT ? `${version} · ${APP_COMMIT}` : version;
}

/** Infobulle détaillée (commit complet + date de build). */
export function appVersionTitle(extra?: string | null): string {
  const parts = [`Version ${APP_VERSION}`];
  if (APP_COMMIT) parts.push(`commit ${APP_COMMIT}`);
  if (APP_BUILD_TIME) {
    const date = new Date(APP_BUILD_TIME);
    if (!Number.isNaN(date.getTime())) {
      parts.push(
        `build ${date.toLocaleString("fr-CA", { timeZone: "America/Toronto" })}`,
      );
    }
  }
  if (extra) parts.push(extra);
  return parts.join(" · ");
}
