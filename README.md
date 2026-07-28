# API SaaS de gestion commerciale

Backend NestJS 11 + Prisma 7 + PostgreSQL destiné aux PME, conçu dès le
départ comme une application multi-tenant.

## Module disponible : authentification locale

- inscription atomique d’une entreprise et de son administrateur ;
- mots de passe Argon2id ;
- access JWT court et refresh JWT rotatif ;
- refresh token en cookie HttpOnly, `SameSite=Strict` ;
- sessions par appareil, révocation ciblée ou globale ;
- détection du rejeu d’un refresh token ;
- verrouillage temporaire et limitation de débit anti-bruteforce ;
- validation d’e-mail ;
- oubli/réinitialisation/changement de mot de passe ;
- guards JWT et rôles pour les futurs modules métier ;
- documentation Swagger en développement.

Le cours qui explique chaque choix et chaque flux est dans
[`docs/cours-authentification.md`](docs/cours-authentification.md).

## Gestion des utilisateurs, rôles et permissions

- invitations à usage unique avec choix du mot de passe par le collaborateur ;
- utilisateurs strictement isolés par tenant ;
- rôles système immuables et rôles personnalisés ;
- permissions atomiques chargées en base à chaque requête ;
- hiérarchie par rang et prévention des escalades de privilèges ;
- suspension immédiate avec révocation des sessions ;
- protection du dernier administrateur actif ;
- journal d’audit transactionnel.

Le cours dédié est dans
[`docs/cours-gestion-utilisateurs-rbac.md`](docs/cours-gestion-utilisateurs-rbac.md).

## Catalogue produits/services et devis

- catalogue unifié avec distinction `PRODUCT` / `SERVICE` ;
- SKU unique par tenant, prix, coût, taxe, devise et unité ;
- archivage logique préservant l’historique ;
- devis numérotés atomiquement par tenant et par année ;
- lignes snapshot, calculs décimaux et cycle de vie contrôlé ;
- contrôle de concurrence par version ;
- transactions sérialisables et journal d’audit.

Le cours complet est dans
[`docs/cours-catalogue-devis.md`](docs/cours-catalogue-devis.md).

## Commandes, factures et paiements

- conversion atomique d’un devis accepté en commande confirmée ;
- commandes manuelles, versionnées et pilotées par machine à états ;
- conversion d’une commande en facture au brouillon ;
- numéro officiel attribué uniquement lors de l’émission ;
- factures émises immuables et annulation tracée ;
- paiements partiels, solde restant et détection des retards ;
- contrepassation des paiements sans destruction d’historique ;
- RBAC, snapshots, transactions sérialisables et audit.

Le cours complet est dans
[`docs/cours-commandes-factures.md`](docs/cours-commandes-factures.md).

## Démarrage

```bash
cp .env.example .env.development
npm install
npx prisma migrate dev
npx prisma generate
npm run start:dev
```

- API : `http://localhost:3000/api/v1`
- Swagger : `http://localhost:3000/api/docs`

## Qualité

```bash
npm run build
npm test -- --runInBand
npx prisma validate
```

Ne commitez jamais un fichier `.env.*`. Si un secret a déjà été versionné,
retirez le fichier de l’index Git et renouvelez immédiatement le secret.

Pour une image de production, générez Prisma et compilez dans un étage de
build, puis élaguez avec `npm prune --omit=dev --omit=optional`. Les
dépendances optionnelles actuelles proviennent du CLI Prisma et ne sont pas
requises par le serveur compilé.
