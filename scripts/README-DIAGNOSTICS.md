# Guide: Lancer les diagnostics live (scripts)

## Problème

Les diagnostics échouaient avec l'erreur:
```
PrismaClientKnownRequestError: Error opening a TLS connection: self-signed certificate in certificate chain
```

Cela vient de la vérification stricte des certificats TLS côté Node.js quand on connect à Supabase depuis une machine locale.

## Solution

Lancer les scripts diagnostics avec `NODE_TLS_REJECT_UNAUTHORIZED=0` pour désactiver la vérification TLS stricte en dev local:

### Windows PowerShell
```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED='0'; npx tsx scripts/diagnose-session-vs-import.ts
$env:NODE_TLS_REJECT_UNAUTHORIZED='0'; npx tsx scripts/diagnose-session-by-owner.ts
```

### macOS/Linux bash
```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/diagnose-session-vs-import.ts
NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/diagnose-session-by-owner.ts
```

## Scripts disponibles

- `diagnose-session-vs-import.ts`: Compare P&L live vs écart titres/import (valeurs de marché)
- `diagnose-session-by-owner.ts`: Répartition du P&L séance par propriétaire
- Voir `scripts/` pour tous les diagnostics disponibles

## Résultat attendu

Les diagnostics affichent maintenant les données en temps réel sans erreur TLS, permettant de:
- Valider la cohérence app vs Disnat
- Vérifier la répartition par propriétaire/compte
- Inspirer les corrections identifiées par le tableau de conciliation UI

## ⚠️ Sécurité

`NODE_TLS_REJECT_UNAUTHORIZED=0` ne doit être utilisé que localement en développement. Ne jamais utiliser en production.
