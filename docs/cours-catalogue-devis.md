# Cours senior — Catalogue produits/services et gestion des devis

Ce chapitre accompagne les modules `products` et `quotes`. L’objectif n’est
pas un simple CRUD : nous construisons un agrégat commercial multi-tenant,
auditable et sûr en concurrence.

## 1. Partir des invariants

Un invariant est une règle qui doit rester vraie quel que soit le contrôleur ou
l’ordre des requêtes.

Pour le catalogue :

- un article appartient à un seul tenant ;
- un SKU est unique dans un tenant, mais peut exister chez une autre entreprise ;
- prix et coût ne sont jamais négatifs ;
- un taux de taxe reste entre 0 et 100 ;
- un article déjà utilisé est archivé plutôt que supprimé ;
- un article archivé ne peut plus entrer dans un nouveau devis.

Pour les devis :

- client et articles appartiennent au tenant authentifié ;
- les montants sont calculés par le serveur ;
- un devis envoyé n’est plus modifiable ;
- chaque changement suit une machine à états ;
- le numéro est unique et produit atomiquement ;
- une écriture concurrente ne peut pas écraser une version plus récente ;
- les lignes gardent l’état commercial observé au moment de leur création.

Ces règles vivent dans les services. Le contrôleur traduit seulement HTTP vers
une commande métier.

## 2. Un catalogue unifié

Le modèle historique `Product` est conservé, mais son champ `type` distingue :

```text
PRODUCT  article matériel ou vendu à l’unité
SERVICE  prestation vendue à l’heure, au jour, au mois, etc.
```

| Champ | Rôle |
|---|---|
| `salePrice` | prix de vente de référence |
| `costPrice` | coût interne facultatif |
| `taxRate` | taxe par défaut |
| `currency` | devise ISO sur trois lettres |
| `unit` | `unit`, `hour`, `day`, etc. |
| `archivedAt` | archivage logique |

Le SKU utilise `@@unique([tenantId, sku])`. PostgreSQL autorise plusieurs
valeurs `NULL` : les articles sans SKU restent possibles, les SKU renseignés
sont uniques par entreprise.

### Pourquoi archiver ?

Supprimer un produit référencé par un ancien devis détruirait une partie de la
traçabilité. L’API expose donc :

```text
POST /api/v1/products/:id/archive
POST /api/v1/products/:id/restore
```

Une ligne conserve aussi un `productId` facultatif avec `ON DELETE SET NULL`.
C’est une protection pour les opérations administratives exceptionnelles ; le
chemin métier normal reste l’archivage.

## 3. Isolation multi-tenant

Le body ne reçoit jamais de `tenantId`. Le tenant vient de l’identité :

```ts
const tenantId = this.requireTenant(actor);
```

Chaque lecture ajoute cette portée :

```ts
await prisma.product.findFirst({
  where: { id: productId, tenantId },
});
```

Cela bloque les IDOR : connaître l’identifiant d’une ressource concurrente ne
permet pas de la lire. Le même contrôle est appliqué au client et aux produits
chargés lors de la création d’un devis.

## 4. DTO et décimaux

Montants et quantités sont reçus comme chaînes :

```json
{
  "quantity": "2.500",
  "unitPrice": "125000.00",
  "discountRate": "10.00",
  "taxRate": "18.00"
}
```

Un nombre JSON est un flottant IEEE-754 et certaines fractions décimales ne
sont pas représentables exactement. Une chaîne contrôlée par `@IsDecimal`,
puis convertie en `Prisma.Decimal`, préserve la valeur monétaire.

Les DTO limitent aussi à 100 lignes, 3 décimales pour la quantité, 2 pour les
prix et taux, 160 caractères pour le libellé et une devise `[A-Z]{3}`.

La validation de forme appartient au DTO. La règle métier — positif, plage de
taux, devise compatible — appartient au service ou au calculateur.

## 5. La ligne est un instantané

Relire le prix actuel du produit pour afficher un ancien devis est une erreur :
une modification du catalogue changerait rétroactivement le document.

`QuoteLine` copie donc le libellé, la description, le SKU, l’unité, le prix,
la remise, la taxe et les totaux. `productId` sert à la navigation, pas au
recalcul. Une ligne libre sans produit est possible si elle fournit au minimum
un libellé et un prix unitaire.

## 6. Calcul monétaire

Pour chaque ligne :

```text
sous-total = arrondi(quantité × prix unitaire)
remise      = arrondi(sous-total × taux remise / 100)
taxable     = sous-total - remise
taxe        = arrondi(taxable × taux taxe / 100)
total       = arrondi(taxable + taxe)
```

L’arrondi est `ROUND_HALF_UP` à deux décimales. Exemple :

```text
2,5 × 125 000     = 312 500
remise 10 %       =  31 250
base taxable      = 281 250
taxe 18 %         =  50 625
total             = 331 875
```

Le devis additionne les valeurs déjà arrondies des lignes. Cette politique
doit rester stable et sera partagée plus tard avec factures et avoirs. Le
calculateur est une fonction pure dans
`src/modules/quotes/quote-calculator.ts`, testable sans base.

## 7. Numérotation concurrente

Le format est `DEV-2026-000001`. `DocumentSequence` possède la clé :

```text
(tenantId, documentType, year)
```

Dans la transaction, un `upsert` incrémente `nextValue` atomiquement. La
contrainte `(tenantId, number)` est une seconde défense.

Il ne faut jamais utiliser `quote.count() + 1` : deux requêtes simultanées
obtiendraient le même numéro et une suppression fausserait le compteur.

## 8. Transaction et version optimiste

Créer ou modifier un devis combine :

1. contrôle du client et des articles ;
2. génération éventuelle du numéro ;
3. calcul et écriture des lignes ;
4. écriture des totaux ;
5. historique du statut ;
6. journal d’audit.

Ces actions utilisent une transaction interactive Prisma `Serializable`. Sur
un conflit PostgreSQL `P2034`, le service réessaie au maximum trois fois.

Chaque devis a aussi une `version`. Le client renvoie la valeur lue :

```json
{ "version": 3, "notes": "Livraison incluse" }
```

Après mutation, elle devient `4`. Si un autre utilisateur a déjà écrit, l’API
répond `409 Conflict`. La transaction protège la base ; la version protège
l’utilisateur contre un écrasement silencieux.

## 9. Machine à états

```text
                    ┌──────────> ACCEPTED
                    │
DRAFT ──> SENT ─────┼──────────> REJECTED
  │                 ├──────────> EXPIRED
  │                 └──────────> CANCELLED
  └────────────────────────────> CANCELLED
```

Règles :

- un devis vide ou déjà expiré ne peut pas être envoyé ;
- `EXPIRED` exige une date de validité passée ;
- les quatre états finaux sont terminaux ;
- seul `DRAFT` peut être modifié ou supprimé.

Chaque transition ajoute un `QuoteStatusHistory`. `AuditLog` fournit en plus
une vue transverse de toutes les actions sensibles du SaaS.

## 10. RBAC

| Permission | Utilisateur | Manager | Admin |
|---|:---:|:---:|:---:|
| `products.read` | oui | oui | oui |
| `products.create/update/archive` | non | oui | oui |
| `quotes.read/create/update/send` | oui | oui | oui |
| `quotes.delete/change-status` | non | oui | oui |

Un rôle personnalisé reste soumis aux protections anti-escalade du module RBAC.

## 11. API du catalogue

```text
GET    /api/v1/products
POST   /api/v1/products
GET    /api/v1/products/:productId
PATCH  /api/v1/products/:productId
POST   /api/v1/products/:productId/archive
POST   /api/v1/products/:productId/restore
```

Exemple :

```json
{
  "type": "SERVICE",
  "name": "Audit de sécurité",
  "sku": "SERV-AUDIT-01",
  "unit": "day",
  "salePrice": "250000.00",
  "costPrice": "140000.00",
  "taxRate": "18.00",
  "currency": "XOF"
}
```

La liste accepte :

```text
?page=1&limit=20&search=audit&type=SERVICE&state=ACTIVE
```

`state` vaut `ACTIVE`, `ARCHIVED` ou `ALL`.

## 12. API des devis

```text
GET    /api/v1/quotes
POST   /api/v1/quotes
GET    /api/v1/quotes/:quoteId
PATCH  /api/v1/quotes/:quoteId
POST   /api/v1/quotes/:quoteId/send
POST   /api/v1/quotes/:quoteId/transition
DELETE /api/v1/quotes/:quoteId?version=1
```

Création avec ligne catalogue et ligne libre :

```json
{
  "clientId": "client_123",
  "issueDate": "2026-07-28",
  "validUntil": "2026-08-27",
  "currency": "XOF",
  "terms": "50 % à la commande, solde à la livraison",
  "lines": [
    {
      "productId": "product_123",
      "quantity": "2.000",
      "discountRate": "5.00"
    },
    {
      "label": "Frais de déplacement",
      "unit": "package",
      "quantity": "1.000",
      "unitPrice": "35000.00",
      "taxRate": "18.00"
    }
  ]
}
```

Envoi :

```json
{ "version": 1 }
```

Acceptation :

```json
{
  "version": 2,
  "status": "ACCEPTED",
  "comment": "Bon pour accord reçu par e-mail"
}
```

Le client doit déjà exister dans le tenant. Le futur module clients exposera
son CRUD ; la contrainte du devis est déjà appliquée.

## 13. Erreurs attendues

| Code | Cas |
|---|---|
| `400` | décimal invalide, taux hors limites, relation étrangère |
| `401` | session ou jeton invalide |
| `403` | permission absente ou pas de tenant |
| `404` | ressource absente dans le tenant |
| `409` | SKU dupliqué, version obsolète, transition interdite |
| `429` | limite de débit |

Une ressource d’un autre tenant apparaît comme introuvable afin de ne pas
révéler son existence.

## 14. Migration Prisma

La migration est
`prisma/migrations/20260728160000_catalog_quotes/migration.sql`. Elle renomme
`price` sans perdre les valeurs, remplace l’unicité globale du SKU, crée devis,
lignes, séquences et historique, puis provisionne les permissions.

Commandes normales :

```bash
npx prisma validate
npx prisma migrate dev
npx prisma generate
```

La base locale a précédemment signalé un drift. Si Prisma propose encore un
reset, ne l’acceptez pas si les données sont à conserver. Inspectez d’abord :

```bash
npx prisma migrate status
```

Réconciliez l’historique manquant ou sauvegardez les données avant toute
réinitialisation. En production, utilisez `prisma migrate deploy`, jamais
`migrate dev`.

## 15. Tests et exercices

La suite couvre les prix et taux invalides, l’archivage, les arrondis, la
version obsolète, l’envoi d’un devis vide et les transitions interdites.

```bash
npm run build
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
npx prisma validate
```

Exercices :

1. Ajouter des filtres par total et date.
2. Dupliquer un devis en nouveau brouillon.
3. Créer un job d’expiration automatique.
4. Partager la politique monétaire avec les futures factures.
5. Tester dix créations concurrentes et l’unicité de leurs numéros.

Les extensions naturelles sont le module clients, la génération PDF, l’envoi
e-mail, la facturation d’un devis accepté et le stock des `PRODUCT`.
