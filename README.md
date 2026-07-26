src/
├── common/                 # Code transversal (réutilisable partout)
│   ├── decorators/         # Ex: @CurrentUser(), @Roles()
│   ├── filters/            # Ex: HttpExceptionFilter (Global)
│   ├── guards/             # Ex: JwtAuthGuard, RolesGuard
│   ├── interceptors/       # Ex: LoggingInterceptor, TransformInterceptor
│   ├── pipes/              # Ex: ValidationPipe global
│   └── interfaces/         # Interfaces globales
├── config/                 # Configuration de l'application
│   ├── app.config.ts       # Config générale
│   ├── database.config.ts  # Config DB
│   └── env.validation.ts   # Validation Joi des .env
├── modules/                # Les domaines métiers (Cœur du SaaS)
│   ├── auth/               # Authentification & JWT
│   ├── users/              # Gestion des utilisateurs
│   ├── tenants/            # Gestion des entreprises/tenants (SaaS)
│   ├── clients/            # Gestion des clients
│   ├── products/           # Produits / Services
│   ├── billing/            # Devis, Factures, Commandes
│   └── notifications/      # Emails, Webhooks
├── prisma/                 # Couche d'accès aux données
│   ├── prisma.service.ts   # Service Prisma
│   ├── prisma.module.ts
│   └── schema.prisma       # Schéma de base de données
├── main.ts                 # Point d'entrée (Bootstrap)
└── app.module.ts           # Module racine