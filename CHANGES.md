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
