import { parseDisnatMoney, stripHtmlTags } from "./disnat-summary";

/**
 * Valeur des titres **par client** lue dans le tableau « Titres » de l'écran « Mes comptes ».
 *
 * Chaque ligne porte son numéro de compte (`COLUMN_ACCOUNT`, ex. `5KFZEY4`) — les 5 premiers
 * caractères donnent le client — et sa valeur au marché (`COLUMN_MARKET_VALUE`). Disnat publie
 * deux tableaux (« … en CAD » et « … en USD ») : le second est converti avec le taux de la ligne
 * de totaux de la page. La somme reconstitue exactement la « Valeur des titres » affichée.
 */
export function parseDisnatHoldingsByClient(
  html: string,
  usdCadRate: number | null,
): Map<string, number> {
  const totals = new Map<string, number>();
  if (!html) return totals;
  const rate = usdCadRate && usdCadRate > 0 ? usdCadRate : 1;

  // Deux blocs : « ACTIONS détenu(e)s dans le(s) compte(s) en CAD / en USD ».
  const blocks = [...html.matchAll(/ACTIONS\s+d[^<]{0,80}?en\s+(CAD|USD)/gi)];
  for (let index = 0; index < blocks.length; index += 1) {
    const start = blocks[index].index ?? 0;
    const end = index + 1 < blocks.length ? (blocks[index + 1].index ?? html.length) : html.length;
    const factor = blocks[index][1].toUpperCase() === "USD" ? rate : 1;

    for (const row of html.slice(start, end).matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)) {
      const body = row[0];
      const accountCell = body.match(/<td[^>]*\bCOLUMN_ACCOUNT\b[^>]*>[\s\S]*?<\/td>/i)?.[0];
      const valueCell = body.match(/<td[^>]*\bCOLUMN_MARKET_VALUE\b[^>]*>([\s\S]*?)<\/td>/i);
      if (!accountCell || !valueCell) continue;

      const account = (
        accountCell.match(/\btitle="([^"]+)"/)?.[1] ?? stripHtmlTags(accountCell)
      )
        .toUpperCase()
        .trim();
      if (!/^[A-Z0-9]{5,}$/.test(account)) continue;

      const marketValue = parseDisnatMoney(stripHtmlTags(valueCell[1]));
      if (marketValue === null) continue;

      const clientCode = account.slice(0, 5);
      totals.set(clientCode, (totals.get(clientCode) ?? 0) + marketValue * factor);
    }
  }

  return totals;
}
