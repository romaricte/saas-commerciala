# Cours senior — Gestion des commandes, factures et paiements

Ce chapitre prolonge le flux catalogue et devis :

```text
DEVIS ACCEPTÉ → COMMANDE CONFIRMÉE → FACTURE ÉMISE → PAIEMENT
```

L’objectif est de séparer les responsabilités commerciales, opérationnelles et
financières. Une commande décrit ce que l’entreprise doit exécuter. Une facture
est une créance officielle. Un paiement est un événement financier traçable.

> Les obligations légales de facturation varient selon les pays. Cette
> architecture fournit les garanties techniques usuelles, mais les mentions
> obligatoires, taxes, règles de numérotation et durées de conservation doivent
> être validées avec un expert-comptable local.

## 1. Les invariants

### Commandes

- client, commande, devis et produits appartiennent au même tenant ;
- seul un devis `ACCEPTED` peut être converti ;
- un devis ne produit qu’une commande dans cette version ;
- une commande confirmée ne change plus de lignes ou de prix ;
- une commande vide ne peut pas être confirmée ;
- une commande facturée ne peut pas être annulée tant que sa facture est active ;
- toutes les mutations utilisent une version optimiste.

### Factures

- une facture au brouillon reste modifiable et supprimable ;
- son numéro officiel est attribué uniquement à l’émission ;
- une facture émise est immuable ;
- une facture émise n’est jamais supprimée : elle peut être annulée avec motif ;
- une facture encaissée ne peut pas être annulée directement ;
- les totaux sont calculés côté serveur avec `Prisma.Decimal` ;
- le montant payé et le solde sont modifiés dans la même transaction que le
  paiement ;
- un paiement n’est pas supprimé : il est contrepassé.

## 2. Trois documents, trois responsabilités

| Document | Question |
|---|---|
| Devis | Que proposons-nous au client ? |
| Commande | Que devons-nous exécuter ? |
| Facture | Que doit payer le client ? |

Fusionner ces documents dans une seule table produit rapidement des règles
contradictoires. Le devis doit pouvoir être refusé ou expirer. La commande
pilote l’avancement. La facture émise doit rester figée.

Chaque niveau possède donc ses propres lignes snapshot. Lors d’une conversion,
les lignes sont copiées depuis le document source. Les prix actuels du
catalogue ne sont jamais relus.

## 3. Cycle de vie des commandes

```text
DRAFT → CONFIRMED → IN_PROGRESS → FULFILLED
   │         │              │
   └─────────┴──────────────┴────→ CANCELLED
```

- `DRAFT` : commande manuelle encore modifiable ;
- `CONFIRMED` : engagement validé, contenu figé ;
- `IN_PROGRESS` : prestation ou préparation en cours ;
- `FULFILLED` : commande exécutée ;
- `CANCELLED` : état terminal.

La conversion d’un devis accepté crée directement une commande `CONFIRMED`.
Le client a déjà accepté le contenu et les prix : recréer un brouillon
modifiable affaiblirait la traçabilité.

Une commande manuelle est créée `DRAFT`, puis confirmée explicitement.

## 4. Cycle de vie des factures

Le statut documentaire est volontairement court :

```text
DRAFT → ISSUED → VOID
```

- `DRAFT` : aucune existence comptable officielle ;
- `ISSUED` : numéro attribué et contenu figé ;
- `VOID` : facture annulée avec date et motif, jamais effacée.

L’état de paiement est séparé :

```text
UNPAID → PARTIALLY_PAID → PAID
```

Pourquoi deux enums ? Une facture peut être `ISSUED` et `PARTIALLY_PAID`.
Utiliser un seul statut conduirait à remplacer l’information « émise » par
« partiellement payée » et compliquerait les règles d’annulation.

Le retard est une donnée dérivée :

```text
status = ISSUED
AND paymentStatus != PAID
AND dueDate < aujourd’hui
```

Il n’est pas stocké comme statut afin d’éviter un job obligatoire simplement
pour maintenir une valeur calculable.

## 5. Numérotation officielle

Commandes :

```text
CMD-2026-000001
```

Factures :

```text
FAC-2026-000001
```

`DocumentSequence` utilise la clé :

```text
(tenantId, documentType, year)
```

L’incrément est réalisé par `upsert` dans une transaction `Serializable`. Deux
requêtes simultanées ne peuvent donc pas obtenir le même numéro.

La commande reçoit son numéro à la création. La facture le reçoit seulement à
l’émission. Supprimer un brouillon de facture ne crée ainsi aucun trou dans la
séquence officielle.

Une facture annulée conserve son numéro. Réutiliser un numéro annulé casserait
l’audit et peut être interdit légalement.

## 6. Conversion par snapshot

### Devis vers commande

Conditions :

- devis du tenant ;
- statut `ACCEPTED` ;
- aucune commande déjà liée.

La transaction copie le client, la devise, les totaux et chaque ligne, puis
ajoute l’historique et l’audit.

### Commande vers facture

Conditions :

- commande `CONFIRMED`, `IN_PROGRESS` ou `FULFILLED` ;
- aucune facture déjà liée.

La facture créée reste `DRAFT`. Un responsable peut vérifier la date,
l’échéance et les mentions avant l’émission.

Les contraintes uniques sur `quoteId` et `orderId` constituent une seconde
défense contre les doubles clics et requêtes concurrentes.

La version actuelle gère une facture complète par commande. La facturation
partielle nécessitera une relation un-à-plusieurs et des quantités
`invoicedQuantity`.

## 7. Calcul et partage du domaine monétaire

Le calcul autrefois nommé `quote-calculator` est maintenant partagé dans :

```text
src/common/commerce/commercial-document-calculator.ts
```

Il applique la même politique aux devis, commandes et factures :

```text
sous-total = arrondi(quantité × prix)
remise      = arrondi(sous-total × taux remise)
taxe        = arrondi((sous-total - remise) × taux taxe)
total       = sous-total - remise + taxe
```

Les lignes manuelles et les produits utilisent aussi un résolveur partagé. On
évite ainsi trois implémentations dont les résultats pourraient diverger.

## 8. Paiements et contrepassation

Lors d’un règlement :

1. vérifier que la facture est `ISSUED` ;
2. comparer la version envoyée à la version courante ;
3. contrôler `0 < montant <= balanceDue` ;
4. créer le paiement ;
5. augmenter `amountPaid` ;
6. diminuer `balanceDue` ;
7. recalculer `paymentStatus` ;
8. incrémenter la version ;
9. écrire l’audit ;
10. valider toute la transaction.

Méthodes disponibles :

```text
CASH, BANK_TRANSFER, CARD, CHECK, MOBILE_MONEY, OTHER
```

Un paiement erroné n’est pas supprimé. La contrepassation renseigne :

- `reversedAt` ;
- `reversedById` ;
- `reversalReason`.

Puis elle recalcule les soldes dans la même transaction. L’historique financier
reste donc explicable.

Un remboursement réel n’est pas une contrepassation technique. Il devra être
modélisé plus tard comme remboursement ou avoir.

## 9. Concurrence

Commande et facture possèdent un champ `version`.

```json
{ "version": 4 }
```

Chaque écriture réussie incrémente la version. Un client envoyant une ancienne
version reçoit `409 Conflict`.

Les services combinent cette protection avec une transaction
`Serializable` et trois tentatives sur l’erreur Prisma `P2034`. Cette double
stratégie protège :

- la cohérence technique entre lignes, totaux, historique et audit ;
- l’utilisateur contre l’écrasement silencieux d’une modification.

## 10. Permissions

Permissions commandes :

```text
orders.read
orders.create
orders.update
orders.delete
orders.confirm
orders.change-status
```

Permissions factures :

```text
invoices.read
invoices.create
invoices.update
invoices.delete
invoices.issue
invoices.void
invoices.manage-payments
```

Le rôle `USER` peut préparer et confirmer des commandes, puis préparer des
factures. Le `MANAGER` possède tout le cycle, dont émission, annulation et
paiements. `ADMIN` reçoit automatiquement toutes les permissions.

Cette séparation permet de créer plus tard des rôles « Commercial »,
« Logistique » et « Comptable ».

## 11. API commandes

```text
GET    /api/v1/orders
POST   /api/v1/orders
POST   /api/v1/orders/from-quote/:quoteId
GET    /api/v1/orders/:orderId
PATCH  /api/v1/orders/:orderId
POST   /api/v1/orders/:orderId/confirm
POST   /api/v1/orders/:orderId/transition
DELETE /api/v1/orders/:orderId?version=1
```

Conversion d’un devis :

```json
{
  "expectedDeliveryDate": "2026-08-15",
  "notes": "Livraison au siège"
}
```

Transition :

```json
{
  "version": 2,
  "status": "IN_PROGRESS",
  "comment": "Préparation démarrée"
}
```

## 12. API factures

```text
GET    /api/v1/invoices
POST   /api/v1/invoices
POST   /api/v1/invoices/from-order/:orderId
GET    /api/v1/invoices/:invoiceId
PATCH  /api/v1/invoices/:invoiceId
POST   /api/v1/invoices/:invoiceId/issue
POST   /api/v1/invoices/:invoiceId/void
POST   /api/v1/invoices/:invoiceId/payments
POST   /api/v1/invoices/:invoiceId/payments/:paymentId/reverse
DELETE /api/v1/invoices/:invoiceId?version=1
```

Création depuis une commande :

```json
{
  "invoiceDate": "2026-07-28",
  "dueDate": "2026-08-27",
  "terms": "Paiement par virement sous 30 jours"
}
```

Émission :

```json
{ "version": 1 }
```

Paiement partiel :

```json
{
  "invoiceVersion": 2,
  "amount": "100000.00",
  "method": "BANK_TRANSFER",
  "paidAt": "2026-07-28T10:30:00.000Z",
  "reference": "VIR-2026-7841"
}
```

Contrepassation :

```json
{
  "invoiceVersion": 3,
  "reason": "Paiement saisi sur la mauvaise facture"
}
```

Filtres :

```text
?status=ISSUED&paymentStatus=PARTIALLY_PAID&overdue=true
```

## 13. Migration

La migration est :

```text
prisma/migrations/20260728190000_order_invoice_management/migration.sql
```

Elle crée les enums, commandes, factures, lignes, historiques et paiements,
étend `DocumentType`, ajoute les contraintes et provisionne le RBAC existant.

Elle a été créée avec `migrate dev --create-only`, relue, enrichie avec les
permissions, puis appliquée par :

```bash
npx prisma migrate dev
npx prisma generate
```

En production :

```bash
npx prisma migrate deploy
```

## 14. Tests

La suite vérifie notamment :

- les versions obsolètes ;
- l’interdiction de confirmer une commande vide ;
- l’impossibilité de convertir un devis non accepté ;
- l’annulation d’une commande facturée ;
- l’émission d’une facture vide ;
- le dépassement du solde ;
- l’annulation d’une facture encaissée ;
- le recalcul d’un paiement partiel.

Commandes qualité :

```bash
npm run lint
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
npx prisma validate
npx prisma migrate status
```

## 15. Prochaines extensions

1. Génération PDF avec snapshot des coordonnées légales du vendeur et client.
2. Envoi e-mail et journal de distribution.
3. Avoirs, remboursements et annulation comptable complète.
4. Factures partielles, acomptes et factures récurrentes.
5. Relances automatiques selon l’ancienneté de la créance.
6. Webhooks de paiement idempotents avec clé fournisseur.
7. Bons de livraison et décrément de stock à l’exécution.
