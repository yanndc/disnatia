import { execSync } from "node:child_process";
import type { NextConfig } from "next";
import pkg from "./package.json";

/**
 * Métadonnées de build exposées à l'UI (badge de version en bas de la sidebar).
 * Sur Vercel le SHA vient de l'environnement ; en local on interroge git, sinon `dev`.
 */
function gitCommitShort(): string {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (fromVercel) return fromVercel.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_GIT_COMMIT: gitCommitShort(),
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;

