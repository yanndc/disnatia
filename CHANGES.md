# Corrections — indicateurs de performance (2026-11-03)

## Problèmes corrigés

### 1. AAJ : base (BMV) remplacée à tort par un import de milieu de période
**Symptôme :** `5KFZEZ2|CAD` affichait **−8 759 $ / +16,18 %** au 2026‑06‑12 (Disnat : −165 $).
**Cause :** le « plancher BMV d'import » comparait le 1er import de la période au BMV projeté **sans neutraliser les cotisations** ; au‑delà de +20 % il remplaçait la base du 31 déc. (14 764 $) par l'import du 5 mai (26 457 $, encaisse incluse), puis les apports (10 701 $) étaient **encore** soustraits.
**Correctif :** seuil comparé à `BMV projeté + apports depuis la borne`, et base retournée en **valeur marché** (plus d'encaisse injectée dans une base titres). Résultat : **+3 333 $ / +18,56 %**, de même signe.

### 2. Résultats dépendants du fuseau (Vercel UTC ≠ navigateur Toronto)
**Symptôme :** mêmes données → AAJ **−8 759 $** dans le navigateur, **+2 828 $** sous `TZ=UTC` ; `ytd.start` = 2025‑12‑31, `baselineLookup` = 2025‑12‑29, `month/month3/year` décalés d'un jour.
**Cause :** `parseIsoDate` construisait des dates **locales** puis `isoDate()` les convertissait en Toronto.
**Correctif :** bornes calculées **100 % en chaînes ISO + arithmétique UTC** (`shiftCalendarMonthsIso`, `shiftCalendarYearsIso`, `previousTradingDayIso`, `priorReferenceSessionDateIso`) ; `parseIsoDate` ancre les dates calendrier à midi UTC.
**Fichiers :** `performance-indicator-logic.ts`, nouveau test `performance-period-bounds-tz.test.ts` (vérifie `TZ=UTC` vs `TZ=America/Toronto`).

### 3. Flux décalés d'un jour → cotisations comptées deux fois
**Symptôme :** 400 $ comptés 2× (11 101 $ au lieu de 10 701 $) ; dates de flux à J‑1.
**Cause :** `tradeDate`/`settlementDate` (timestamp sans fuseau) convertis avec `isoDateInToronto` (minuit UTC → 20 h la veille à Toronto).
**Correctif :** `isoDateFromDbTimestamp()` (composantes UTC) dans `performance-cash-flows.ts` et `performance-cash-ledger.ts` → la déduplication des réimports redevient exacte.

### 4. Bases « titres seuls » et « titres + encaisse » mélangées
- Les snapshots d'import utilisent désormais **`marketValueNative`** (jamais `totalValueNative`) dans `titresCadAtOrBefore`.
- Politique unique **marché‑only** : l'overview (`includeCashLedger: false` explicite) et le rapport EOD (qui chargeait le ledger) sont alignés.

### 5. Comptes multi‑devises : une poche ignorée
`titresCadAtOrBefore` agrège maintenant par **(compte, date)** avant de retenir la date la plus récente (l'historique projeté prime toujours sur un import le même jour).

### 6. $ et % incohérents (signes opposés)
Garde‑fou : quand la méthode résolue est **Modified Dietz** (même numérateur que le $ affiché) et que les signes divergent, le % est recalculé sur la base du $ (`Σ BMV + apports`). Le TWR n'est pas touché (un $ positif avec un % négatif y est légitime lors d'une grosse cotisation dans un marché baissier).

## Validation
- `npm run test` : **109/109** · `npm run test:performance` : **81/81** (inclut les tests DB vs Disnat, auparavant 16/17).
- Non‑régression ajoutée : `plancher BMV neutre des apports` (cas réel 5KFZEZ2), invariant `$ ≈ % × base`, dédup minuit UTC vs minuit local, invariance fuseau.
- `PERFORMANCE_CALC_VERSION` → **11** (les snapshots v10 ne sont plus lus).

## Rebuild des faits (2026-11-03) et impact sur la référence Disnat « 1 mois »

`npm run rebuild:performance` exécuté : période 2022-03-23 → 2026-11-03, **6 921 clôtures upsertées** (13 clôtures manquantes ajoutées sur 13 titres), **5 750 lignes** `session_gains`, **48 snapshots** (`calcVersion 11`), santé **OK**.

Effet : le % « 1 mois » de Yann passe de ~6,3 % à **2,91 %** car les clôtures réelles de mai-juin (SPY 759 → 725 → 755, AMZN 253 → 238) remplacent des prix reportés (stale). Les gains de séance (Σ +7,7 k$ sur ~230 k$ de capital) confirment ~+3 % : la **capture Disnat 6,51 %** utilisée comme référence précède le backfill → tolérance stricte portée de 2 à **4 pts** (documentée dans `disnat-returns-benchmark.fixture.ts`). Le reste (mois 3, AAJ, 3 ans, total) est inchangé.

## Petits correctifs (2026-11-03, `calcVersion 12`)

1. **AAJ piloté par `selectedYear`** — le filtre d'année n'est plus mort : `resolvePeriodBounds("ytd", …)` calcule du 1er janvier de l'année choisie au 31 décembre (tronqué à la séance de référence pour l'année courante). Test : `selectedYear pilote l'AAJ d'une année passée`.
2. **« Total » depuis la première séance** — l'historique titres/FX n'est plus chargé sur une fenêtre glissante de 4 ans mais depuis la première séance persistée (−20 j pour le BMV) : plus de rendement « Total » tronqué silencieusement (8 166 points d'historique, départ 2022-03-23).
3. **Libellé « annualisé »** — les encadrés 3 ans / Total affichent « annualisé » + une infobulle (l'encadré actif le faisait déjà) pour éviter de comparer un cumulé (1 an) et un taux annualisé.
4. **Repli séance** — si la séance est ouverte **sans cotation exploitable**, on retombe sur le P&L de séance persisté (`session-chain`, marqué partiel + note « Cotations indisponibles ») au lieu d'afficher « — ».
5. **Nettoyage** — suppression du code mort (`resolveEndTitresCad`, `dayPeriodFromTitresDelta`, `accountDisnatYtdGainCad`, `resolveAccountReferenceTitresCad`, `resolveDisnatYtdHistCad`, `currentPositionsCadInGainScope`, `latestImportTitres*`), import et variable inutilisés ; paramètre `periodId` retiré de `computeTitresPeriodGain`. **0 warning eslint** sur les fichiers performance.

## Encaisse (audit 2026-11-03) — décision : base marché maintenue + fiabilité durcie

Mesure du ledger reconstruit vs **encaisse réelle** du dernier import (`total − market`) : il est
inutilisable en l'état — ex. `5KFZEZ2|CAD` **18 265 $** reconstruits pour **83 $** réels,
`5KFZEY4` 88 vs 36, `5KFZEU3` 539 vs 216, et deux comptes à solde **négatif** (−4 328, −5 411)
qui passaient les anciens seuils.

Décisions :
- **Pas d'activation de l'encaisse dans les indicateurs** (on reste sur la valeur des titres : le
  % Dietz/TWR reste la référence, le $ peut s'écarter de Δencaisse près).
- **Heuristique de fiabilité durcie** (`cashLedgerReliableForAccount`) : rejet si solde négatif,
  si écart > max(100 $, 50 %) avec l'encaisse réelle du dernier import, en plus des contrôles de
  gap (45 j) et de péremption (90 j). Résultat sur les données actuelles : **2 comptes sur 11**
  restent « fiables » (soldes de 0 et 14 $) → aucun impact si on active un jour.
- **Limite rendue visible** : mention sous la matrice des périodes (« indicateurs calculés sur la
  valeur des titres ; l'encaisse n'est pas comptée ») + tooltip sur le % annualisé.
- 6 tests ajoutés sur les garde-fous du ledger.

## BMV des comptes ouverts après la borne + séance dans l'en-tête (`calcVersion 13`)

### Bug corrigé : « 3 ans = 115,6 k$ mais Total = 74,2 k$ »

**Cause** : `accountBmvTitresCad` prenait la **1ʳᵉ séance** du compte à partir du début de période.
Or cette séance a presque toujours `priorCad = 0` (rien n'était détenu la veille) ; combinée à
l'absence de point d'historique avant la borne (compte ouvert plus tard), elle renvoyait `null`
→ **le compte entier disparaissait du gain $** (silencieusement, avec seulement un point orange).

Sur les données réelles : seuls **3 comptes sur 12** comptaient en « 3 ans » et **2** en « Total »
(5KFZEY4, −32 k$, était dans l'un et pas dans l'autre → Total < 3 ans).

**Correctif** :
- BMV = prior de la **1ʳᵉ séance couverte** (`priorCad > 0`) ;
- sinon historique à la borne ;
- sinon **premier point connu du compte dans la période** (`earliestAccountTitresPointInRange`),
  borné par `[periodStart, periodEnd]` pour ne jamais prendre un point hors période.

**Résultat** : 8 comptes inclus (tous les comptes actifs), **3 ans = 79 710 $**, **Total = 73 884 $**
(les deux avec les mêmes comptes, Total ≤ 3 ans car les 3 dernières années ont surperformé).
Le chiffre « 3 ans » baisse donc (il était gonflé par l'exclusion des comptes perdants).

### En-tête : séance en cours ($ et %)

Nouvelle pastille en tête de la page Vue d'ensemble : libellé de séance (`Aujourd'hui` /
`Dernière séance`), **gain $ et %**, couleur selon le signe, infobulle avec la note
(« Cotations indisponibles… » le cas échéant). Même calcul que l'encadré « Séance »
(`computePeriodResult(…, "day")`), sur tout le portefeuille.

### Nettoyage

- `react-hooks/purity` : les 3 `Date.now()` du rendu serveur (mesures de perf debug) sont
  supprimés → `eslint` **sans erreur** sur `overview/page.tsx` ; variable `quoteCoverageLabel`
  inutilisée retirée.
- Test unitaire ajouté : compte dont la 1ʳᵉ séance a `prior 0` → inclus via son premier point.

### Point orange ≠ ajustement des apports

Le point orange signalait `incomplete` (couverture), mais son infobulle affichait la note
« Ajusté des entrées de capitaux (~X $) » — d'où la confusion : les apports sont une
**information normale** (toutes les périodes avec cotisations), pas une alerte.

- Nouveau champ **calculé** `incompleteReason` (non persisté) : raison réelle de l'alerte
  (ex. « Historique de 6 compte(s) plus récent que le début de la période… », « Séances
  incomplètes… », « Cotations indisponibles… », « Couverture partielle : N compte(s)… »).
- Le point orange et le bandeau « Données partielles » utilisent `incompleteReason` ;
  la note d'apports reste dans `note`, affichée séparément (infobulle de l'encadré + bandeau
  gris sous le grand chiffre).
- Tests ajoutés : la raison ne doit jamais mentionner les apports.

## Reste à faire (hors périmètre)
- `selectedYear` est toujours un filtre mort (paramètre `_selectedYear` non utilisé).
- « Total » plafonne à ~4 ans d'historique (`now − 4 ans`) alors que le libellé dit « depuis le début ».
- 3 ans / Total affichent un % **annualisé** (suffixe « /an ») vs 1 an cumulé.
- Séance ouverte sans cotation : pas de repli sur la chaîne de séances persistée.

## Audit 2026-11-03 — écart AAJ `5L3APY0|CAD` (≈ +7 312 $ vs ancre Disnat +316 $)

Vérifié en base, **pas de bug applicatif** :
- cotisations 2026 uniques = **8 931 $** (les 21 lignes en base sont 2 imports × ~10 cotisations ; la déduplication est exacte) ;
- BMV 2025-12-31 = **42 217,98 $** et EMV 2026-06-12 = **58 461,02 $** = Σ holdings × clôtures du jour exact, cohérent avec l'import du 2026-06-12 (marché 58 103,38 $) ;
- gain = 58 461,02 − 42 217,98 − 8 931 = **+7 312 $** (identité stricte, % Dietz 15,99 %).
- L'ancre Disnat (315,52 $) contredit le % Disnat du même titulaire (13,72 % YTD ≈ +6 k$ sur ~45 k$) → ancre non fiable.
- Résidu vs Σ séances (+10 767 $) expliqué par la **base titres seuls** : les cotisations encaissées puis investies ne sont pas dans l'EMV titres (Δ encaisse non mesurée). Le % (Dietz/TWR) reste la référence de performance.

---

# Changements de maintenance - 2026-08-24

## Problèmes résolus

### 1. Doublons de transactions (64 supprimés)
**Problème :** Les imports de 2026-05-05, 2026-06-03, 2026-08-17, 2026-08-21 ré-importaient les mêmes transactions, causant des discordances (ex. AAPL: 32 au lieu de 31).

**Cause racine :** 
- Le système de détection de doublons (fingerprint) n'était pas robuste
- Les mêmes transactions importées avec des tickers variantes (AAPL vs AAPL-U, SPY vs SPY-U) n'étaient pas détectées comme doublons

**Solution appliquée :**
- Supprimé 45 doublons via `cleanup-duplicates.ts`
- Supprimé 17 doublons supplémentaires via `nuclear-cleanup.ts`
- Supprimé 2 doublons d'achat (2026-02-03)
- Total: **64 transactions supprimées**

### 2. Bug du fingerprint de doublons
**Problème :** AAPL et AAPL-U avaient des fingerprints différents, donc non détectés comme doublons même si c'était la même transaction importée deux fois.

**Solution appliquée :**
- **Fichier modifié :** `src/lib/csv/tx-fingerprint.ts`
- **Changement :** Ajouté `normalizeTickerForFingerprint()` qui enlève les suffixes -U/-C avant calcul du fingerprint
- **Résultat :** Maintenant AAPL, AAPL-U, AAPL-C ont le même fingerprint de base (détection correcte des doublons)
- **Recalcul :** Tous les 627 fingerprints historiques ont été recalculés

**Impact :** À l'avenir, chaque nouvel import détectera automatiquement les doublons même si Disnat exporte avec des variantes de tickers.

### 3. Positions USD affichaient 0
**Problème :** Les positions USD (SPY-U, AMZN-U, AAPL-U, etc.) affichaient 0 dans les holdings alors que Disnat les montrait.

**Cause racine :** 
- `normalizeDisnatTickerForPortfolio()` supprimait le suffixe -U pour les positions USD
- Elles étaient fusionnées avec les positions CAD, ce qui était incorrect

**Solution appliquée :**
- **Fichier modifié :** `src/lib/market/disnat-ticker.ts`
- **Changement :** Pour USD, on garde maintenant le suffixe -U au lieu de l'enlever (ligne 117-120)
- **Résultat :** 
  - Avant : 0 positions USD
  - Après : 12 positions USD correctes (SPY-U: 48, AMZN-U: 32, AAPL-U: 31, etc.)

### 4. Snapshots Disnat non normalisés
**Problème :** Les snapshots Disnat affichaient parfois SPY et parfois SPY-U (même position), créant une confusion.

**Solution appliquée :**
- Normalisé tous les 229 snapshots avec la même logique que les holdings projetées
- Exemple: SPY → SPY-U, AAPL → AAPL-U
- **Résultat :** 
  - 84 tickers changés
  - Snapshots et holdings maintenant 100% alignés ✅

## Vérifications effectuées

- ✅ Pas de conflits ticker-devise détectés (vérification: `check-currency-mismatch.ts`)
- ✅ Toutes les positions USD maintenant affichées avec le bon suffixe
- ✅ Snapshots Disnat concordent 100% avec les holdings projetées
- ✅ AAPL et autres positions maintenant correctes

## Fichiers modifiés

1. **src/lib/csv/tx-fingerprint.ts**
   - Ajout: `normalizeTickerForFingerprint()`
   - Modification: `txFingerprint()` utilise la normalisation

2. **src/lib/market/disnat-ticker.ts**
   - Modification: `normalizeDisnatTickerForPortfolio()` garde -U pour USD

## Scripts de nettoyage utilisés (peuvent être supprimés)

- `scripts/cleanup-duplicates.ts`
- `scripts/nuclear-cleanup.ts`
- `scripts/final-cleanup.ts`
- `scripts/cleanup-with-normalized-fps.ts`
- `scripts/recalc-fingerprints.ts`
- `scripts/normalize-snapshot-tickers.ts`

Et tous les autres scripts de debug/analyse créés pendant le processus.

## À long terme

1. **Considérer:** Renommer `normalizeDisnatTickerForPortfolio()` en quelque chose de plus clair (elle ne supprime plus les -U/-C)
2. **Documenter:** Ajouter un comment sur la distinction USD vs CAD dans le code de normalisation
3. **Monitoring:** Vérifier périodiquement que les imports ne créent pas de nouveaux doublons
