import { NextResponse } from "next/server";
import { parseDisnatHistoryHtml } from "@/lib/csv/disnat-html";
import { describeDisnatPage } from "@/lib/csv/disnat-diagnostics";
import {
  clientCodeFromDisnatHtml,
  clientCodeFromDisnatUrl,
  parseDisnatSummaryHtml,
} from "@/lib/csv/disnat-summary";
import { prisma } from "@/lib/db/prisma";
import { POST as importRoutePost } from "@/app/api/imports/route";

export const maxDuration = 300;

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

  let payload: { html?: string; url?: string };
  try {
    payload = (await request.json()) as { html?: string; url?: string };
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
  const summary = parseDisnatSummaryHtml(html);
  if (summary) {
    // `clientCodeFromDisnatHtml` : repli pour les favoris générés avant l'envoi de `url`.
    const clientCode = clientCodeFromDisnatUrl(payloadUrl) ?? clientCodeFromDisnatHtml(html);
    if (!clientCode) {
      const diagnostic = describeDisnatPage(html, payloadUrl);
      return NextResponse.json(
        {
          ok: false,
          error:
            "Encaisse non rattachée : ouvre la « Vue d'ensemble » d'un client précis (pas « Tous les comptes »), puis relance le favori.",
          diagnostic: diagnostic.hint,
        },
        { status: 422, headers },
      );
    }
    const asOfDate = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
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
