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

## Reste à faire (hors périmètre)
- `selectedYear` est toujours un filtre mort (paramètre `_selectedYear` non utilisé).
- « Total » plafonne à ~4 ans d'historique (`now − 4 ans`) alors que le libellé dit « depuis le début ».
- 3 ans / Total affichent un % **annualisé** (suffixe « /an ») vs 1 an cumulé.
- Séance ouverte sans cotation : pas de repli sur la chaîne de séances persistée.

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
