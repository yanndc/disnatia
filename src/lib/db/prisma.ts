import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { coerceValidPostgresUrl } from "./coerce-postgres-url";
import { applyDatabaseEnvOverridesFromEnvLocal } from "./database-env-bootstrap";
import { normalizeRuntimePostgresUrl } from "./normalize-postgres-url";
import { firstEnvValue, RUNTIME_POSTGRES_URL_KEYS } from "./postgres-env";

applyDatabaseEnvOverridesFromEnvLocal();

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  /** Permet de jeter un client créé avant un changement de DATABASE_URL / HMR. */
  prismaResolvedConnectionString?: string;
};

/** En prod on ne met pas le client sur `globalThis` ; un cache module suffit pour éviter un client par proxy-get. */
let productionPrisma: PrismaClient | undefined;
let productionPrismaResolvedConnectionString: string | undefined;

/** Adapter runtime : ordre dans `RUNTIME_POSTGRES_URL_KEYS` (`postgres-env.ts`). */
function resolvePostgresConnectionString(): string {
  const url = firstEnvValue(RUNTIME_POSTGRES_URL_KEYS);
  if (!url) {
    throw new Error(
      "Aucune URL Postgres pour Prisma : définis une URI dans .env.local (voir src/lib/db/postgres-env.ts pour les noms acceptés).",
    );
  }
  return normalizeRuntimePostgresUrl(coerceValidPostgresUrl(url));
}

function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
    }),
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

/** Après HMR ou changement de schéma, le singleton peut être une vieille classe sans certains modèles. */
function hasExpectedDelegates(client: PrismaClient): boolean {
  const c = client as unknown as {
    usdCadDailyRate?: { findFirst?: unknown };
    portfolioDailyHolding?: { deleteMany?: unknown };
    chatMessage?: { findMany?: unknown };
  };
  return (
    typeof c.usdCadDailyRate?.findFirst === "function" &&
    typeof c.portfolioDailyHolding?.deleteMany === "function" &&
    typeof c.chatMessage?.findMany === "function"
  );
}

function getSingletonPrisma(): PrismaClient {
  const resolvedConn = resolvePostgresConnectionString();

  if (process.env.NODE_ENV === "production") {
    const cached = productionPrisma;
    const sameConnection =
      productionPrismaResolvedConnectionString === resolvedConn;
    if (cached && sameConnection && hasExpectedDelegates(cached)) {
      return cached;
    }

    if (cached) {
      void cached.$disconnect().catch(() => {});
      productionPrisma = undefined;
      productionPrismaResolvedConnectionString = undefined;
    }

    const client = createPrismaClient(resolvedConn);
    productionPrisma = client;
    productionPrismaResolvedConnectionString = resolvedConn;
    return client;
  }

  const cached = globalForPrisma.prisma;

  const sameConnection =
    globalForPrisma.prismaResolvedConnectionString === resolvedConn;

  if (cached && sameConnection && hasExpectedDelegates(cached)) {
    return cached;
  }

  if (cached) {
    void cached.$disconnect().catch(() => {});
    delete globalForPrisma.prisma;
    delete globalForPrisma.prismaResolvedConnectionString;
  }

  const client = createPrismaClient(resolvedConn);
  globalForPrisma.prisma = client;
  globalForPrisma.prismaResolvedConnectionString = resolvedConn;
  return client;
}

/**
 * Ne pas appeler `getSingletonPrisma()` une seule fois au chargement du module :
 * après passage local → Supabase (ou HMR), l’ancien adaptateur pg resterait sinon.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getSingletonPrisma();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});
