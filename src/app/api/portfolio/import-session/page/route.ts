import { NextResponse } from "next/server";
import { parseDisnatHistoryHtml } from "@/lib/csv/disnat-html";
import { describeDisnatPage } from "@/lib/csv/disnat-diagnostics";
import { parseDisnatHoldingsByClient } from "@/lib/csv/disnat-positions";
import {
  clientCodeFromDisnatHtml,
  clientCodeFromDisnatUrl,
  disnatActiveClientCode,
  disnatClientDirectory,
  parseDisnatSummaryHtml,
  parseDisnatSummaryScopes,
} from "@/lib/csv/disnat-summary";
import { prisma } from "@/lib/db/prisma";
import { POST as importRoutePost } from "@/app/api/imports/route";

export const maxDuration = 300;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Taux USD→CAD le plus récent (Banque du Canada) à la date donnée. */
async function latestUsdCadRate(date: Date): Promise<number | null> {
  const row = await prisma.usdCadDailyRate
    .findFirst({ where: { rateDate: { lte: date } }, orderBy: { rateDate: "desc" } })
    .catch(() => null);
  return row && row.usdToCad > 0 ? row.usdToCad : null;
}

/** Origines autorisées à appeler cet endpoint depuis un favori (page Disnat ouverte). */
const ALLOWED_ORIGINS = ["https://tmw.secure.vmd.ca", "https://www.disnat.com"];

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "content-type, x-disnat-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** Préflight CORS pour le favori. */
export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}

/**
 * Import déclenché par le favori « Envoyer à DisnatIA ».
 *
 * Le favori poste le HTML de la page Disnat (`Détail du compte → Vue d'ensemble → Historique`)
 * avec le jeton d'import. On réutilise le parseur d'onglet et la route d'import existante,
 * donc dédup / projection / cours restent inchangés.
 */
export async function POST(request: Request) {
  const headers = corsHeaders(request.headers.get("origin"));
  const expected = process.env.DISNAT_IMPORT_TOKEN?.trim();
  if (!expected) {
    return NextResponse.json(
      { error: "Import par favori désactivé : DISNAT_IMPORT_TOKEN manquant sur le serveur." },
      { status: 503, headers },
    );
  }

  const token = request.headers.get("x-disnat-token")?.trim();
  if (token !== expected) {
    return NextResponse.json({ error: "Jeton invalide." }, { status: 401, headers });
  }

  let payload: { html?: string; url?: string; clientCode?: string };
  try {
    payload = (await request.json()) as { html?: string; url?: string; clientCode?: string };
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400, headers });
  }

  const html = payload.html ?? "";
  if (html.length < 500) {
    return NextResponse.json(
      { error: "Contenu de page trop court — ouvre l'onglet « Historique » avant d'envoyer." },
      { status: 422, headers },
    );
  }

  const payloadUrl = typeof payload.url === "string" ? payload.url : "";

  // Page « Vue d'ensemble » : on enregistre l'encaisse officielle du client (ligne de totaux).
  // Le titulaire affiché au-dessus de la ligne (`YANN DE CHAMPLAIN`) est relié à son code client
  // par les libellés « NOM - CODE » de la liste « Compte ».
  const asOfDate = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

  // Les cellules d'encaisse empilent « CAD » puis « USD » : on convertit la seconde ligne avec
  // le taux de la page (cellule « Taux »), sinon celui du jour (Banque du Canada).
  const rawScopes = parseDisnatSummaryScopes(html);
  const rawSummary = rawScopes[0]?.totals ?? parseDisnatSummaryHtml(html);
  const usdCadRate = rawSummary?.rate ?? (await latestUsdCadRate(asOfDate));
  const converted = usdCadRate ? parseDisnatSummaryScopes(html, usdCadRate) : rawScopes;
  const scopes = converted.length > 0 ? converted : rawScopes;

  const scope = scopes[0] ?? null;
  const summary = scope?.totals ?? rawSummary;
  if (summary) {
    const directory = disnatClientDirectory(html);
    const pageCodes = new Set(directory.values());

    // Cas idéal : la page donne les totaux **par client** (« Mes comptes → Vue d'ensemble ») —
    // encaisse, titres et total déjà convertis en CAD par Disnat : rien à répartir.
    const perClient = scopes.flatMap((entry) => {
      const code = entry.clientName ? directory.get(entry.clientName) : null;
      return code
        ? [
            {
              clientCode: code,
              cashCad: entry.totals.cashCad,
              securitiesCad: entry.totals.securitiesCad,
              totalCad: entry.totals.totalCad,
            },
          ]
        : [];
    });

    if (perClient.length > 0) {
      await prisma.$transaction(
        perClient.map((client) =>
          prisma.disnatClientCashSnapshot.upsert({
            where: { clientCode_asOfDate: { clientCode: client.clientCode, asOfDate } },
            create: {
              clientCode: client.clientCode,
              asOfDate,
              cashCad: client.cashCad,
              securitiesCad: client.securitiesCad,
              totalCad: client.totalCad,
            },
            update: {
              cashCad: client.cashCad,
              securitiesCad: client.securitiesCad,
              totalCad: client.totalCad,
            },
          }),
        ),
      );

      return NextResponse.json(
        {
          ok: true,
          mode: "summary",
          split: perClient.length > 1,
          // Compatibilité : les favoris antérieurs à la liste `clients` lisent ce champ.
          clientCode: perClient.map((client) => client.clientCode).join(" + "),
          asOfDate: asOfDate.toISOString().slice(0, 10),
          rate: usdCadRate,
          cashCad: round2(perClient.reduce((sum, client) => sum + client.cashCad, 0)),
          securitiesCad: round2(perClient.reduce((sum, client) => sum + client.securitiesCad, 0)),
          totalCad: round2(perClient.reduce((sum, client) => sum + client.totalCad, 0)),
          clients: perClient,
        },
        { headers },
      );
    }

    if (scopes.length > 1) {
      return NextResponse.json(
        {
          ok: false,
          code: "MULTIPLE_CLIENTS",
          error:
            "Cette page contient les totaux de plusieurs clients — ouvre la « Vue d'ensemble » d'un seul client (ou choisis-le dans la liste « Compte »), puis relance le favori.",
          diagnostic: describeDisnatPage(html, payloadUrl).hint,
        },
        { status: 422, headers },
      );
    }

    const scopeCode =
      (scope?.clientName ? (directory.get(scope.clientName) ?? null) : null) ??
      disnatActiveClientCode(html);

    // Vue agrégée (« Vue d'ensemble » = tous les comptes) : le total additionne les clients.
    // La valeur des titres se répartit **par client** avec les numéros de compte du tableau
    // « Titres » (Σ CAD + Σ USD × taux = « Valeur des titres » affichée, au cent près) ;
    // l'encaisse, qui n'existe qu'en un seul total, est répartie au prorata de cette valeur.
    if (!scopeCode && pageCodes.size > 1) {
      const securitiesByClient = parseDisnatHoldingsByClient(html, usdCadRate);
      const shares = [...securitiesByClient.entries()]
        .map(([code, value]) => ({ code, value: round2(value) }))
        .filter((entry) => entry.value > 0)
        .sort((a, b) => b.value - a.value);
      const securitiesTotal = round2(shares.reduce((sum, entry) => sum + entry.value, 0));

      if (shares.length < 2 || securitiesTotal <= 0) {
        const known = [...directory.entries()].map(([name, code]) => `${code} (${name})`).join(" · ");
        return NextResponse.json(
          {
            ok: false,
            code: "AGGREGATE_VIEW",
            error: `Vue agrégée de ${pageCodes.size} clients : choisis ton client dans la liste « Compte » avant d'envoyer — ${known}.`,
            diagnostic: describeDisnatPage(html, payloadUrl).hint,
          },
          { status: 422, headers },
        );
      }

      const clients = shares.map((entry) => {
        const cashCad = round2((summary.cashCad * entry.value) / securitiesTotal);
        return {
          clientCode: entry.code,
          cashCad,
          securitiesCad: entry.value,
          totalCad: round2(entry.value + cashCad),
        };
      });
      // Le prorata laisse des cents : on les reporte sur le plus gros client pour que la somme
      // des encaisses égale exactement l'encaisse affichée par Disnat.
      const gap = round2(summary.cashCad - round2(clients.reduce((sum, c) => sum + c.cashCad, 0)));
      if (gap !== 0) {
        clients[0].cashCad = round2(clients[0].cashCad + gap);
        clients[0].totalCad = round2(clients[0].securitiesCad + clients[0].cashCad);
      }

      await prisma.$transaction(
        clients.map((client) =>
          prisma.disnatClientCashSnapshot.upsert({
            where: { clientCode_asOfDate: { clientCode: client.clientCode, asOfDate } },
            create: {
              clientCode: client.clientCode,
              asOfDate,
              cashCad: client.cashCad,
              securitiesCad: client.securitiesCad,
              totalCad: client.totalCad,
            },
            update: {
              cashCad: client.cashCad,
              securitiesCad: client.securitiesCad,
              totalCad: client.totalCad,
            },
          }),
        ),
      );

      return NextResponse.json(
        {
          ok: true,
          mode: "summary",
          split: true,
          asOfDate: asOfDate.toISOString().slice(0, 10),
          rate: summary.rate,
          cashCad: summary.cashCad,
          securitiesCad: summary.securitiesCad,
          totalCad: summary.totalCad,
          clients,
        },
        { headers },
      );
    }

    // Ordre : titulaire affiché, puis code envoyé par le favori, puis URL, puis déduction du HTML.
    const payloadClient = (payload.clientCode ?? "").trim().toUpperCase();
    const clientCode =
      scopeCode ??
      (/^[A-Z0-9]{4,8}$/.test(payloadClient) ? payloadClient : null) ??
      clientCodeFromDisnatUrl(payloadUrl) ??
      clientCodeFromDisnatHtml(html);
    if (!clientCode) {
      const diagnostic = describeDisnatPage(html, payloadUrl);
      return NextResponse.json(
        {
          ok: false,
          code: "CLIENT_REQUIRED",
          error:
            "Encaisse non rattachée : indique ton code client Disnat (ex. 5KFZE) pour créditer le bon client.",
          diagnostic: diagnostic.hint,
        },
        { status: 422, headers },
      );
    }
    await prisma.disnatClientCashSnapshot.upsert({
      where: { clientCode_asOfDate: { clientCode, asOfDate } },
      create: {
        clientCode,
        asOfDate,
        cashCad: summary.cashCad,
        securitiesCad: summary.securitiesCad,
        totalCad: summary.totalCad,
      },
      update: {
        cashCad: summary.cashCad,
        securitiesCad: summary.securitiesCad,
        totalCad: summary.totalCad,
      },
    });
    return NextResponse.json(
      {
        ok: true,
        mode: "summary",
        clientCode,
        asOfDate: asOfDate.toISOString().slice(0, 10),
        cashCad: summary.cashCad,
        securitiesCad: summary.securitiesCad,
        totalCad: summary.totalCad,
      },
      { headers },
    );
  }

  const parsed = parseDisnatHistoryHtml(html);
  if (!parsed.ok) {
    const diagnostic = describeDisnatPage(html, payloadUrl);
    const message = parsed.error ?? "Aucune transaction trouvée.";
    return NextResponse.json(
      {
        error: `${message} [${diagnostic.hint}]`,
        diagnostic: diagnostic.hint,
      },
      { status: 422, headers },
    );
  }

  const results: { account: string; status: string; detail: string }[] = [];
  for (const account of parsed.accounts) {
    const formData = new FormData();
    formData.append(
      "file",
      new File([account.csv], `${account.accountNumber}_${account.currency}.csv`, {
        type: "text/csv",
      }),
    );
    formData.append("accountKey", account.accountKey);
    formData.append("accountLabel", account.label);

    const syntheticRequest = new Request("http://localhost/api/imports", {
      method: "POST",
      body: formData,
    });
    try {
      const response = await importRoutePost(syntheticRequest);
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        txInserted?: number;
        txSkipped?: number;
      };
      const isDuplicate = response.status === 409;
      results.push({
        account: account.label,
        status: response.ok ? "ok" : isDuplicate ? "duplicate" : "error",
        detail: response.ok
          ? `${body.txInserted ?? 0} ajoutée(s)${body.txSkipped ? `, ${body.txSkipped} doublon(s)` : ""}`
          : isDuplicate
            ? "déjà à jour"
            : (body.error ?? `Erreur ${response.status}`),
      });
    } catch (cause) {
      results.push({
        account: account.label,
        status: "error",
        detail: cause instanceof Error ? cause.message : "Erreur d'import",
      });
    }
  }

  const created = results.filter((row) => row.status === "ok").length;
  const duplicates = results.filter((row) => row.status === "duplicate").length;
  const failed = results.filter((row) => row.status === "error");

  return NextResponse.json(
    {
      ok: created > 0,
      updated: created,
      duplicates,
      errors: failed.length,
      accounts: results,
      errorAccounts: failed.map((row) => `• ${row.account} — ${row.detail}`),
      skipped: parsed.skipped,
      rowsTotal: parsed.rowsTotal,
    },
    { headers },
  );
}
