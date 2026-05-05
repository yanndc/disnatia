import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    }),
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

/** Après HMR ou changement de schéma, le singleton peut être une vieille classe sans certains modèles. */
function hasUsdCadDelegate(client: PrismaClient): boolean {
  const d = (client as unknown as { usdCadDailyRate?: { findFirst?: unknown } })
    .usdCadDailyRate;
  return typeof d?.findFirst === "function";
}

function getSingletonPrisma(): PrismaClient {
  const cached = globalForPrisma.prisma;
  if (cached && hasUsdCadDelegate(cached)) return cached;

  if (cached) {
    void cached.$disconnect().catch(() => {});
    delete globalForPrisma.prisma;
  }

  const client = createPrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
  }
  return client;
}

export const prisma = getSingletonPrisma();
