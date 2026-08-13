# MedFinder Gestion — Roadmap, tests, risques, décisions

Statut : Phase 0 — Proposition en attente de validation.
Rappel absolu (§8 du prompt maître) : une phase n'est terminée que si les 15
critères sont satisfaits (schéma + migrations + RLS testé + permissions testées
+ APIs sécurisées + UI fonctionnelle + workflows fonctionnels + tests verts +
aucun secret exposé + données de test isolées + preuves fournies + build vert +
TypeScript vert + lint vert + aucune régression connue). Aucune phase n'est
déclarée terminée sur la seule base de « le code existe ».

## Phase 0 — Architecture (en cours, ce livrable)

Livrables : `architecture.md`, `data-model.md`, `security.md`,
`permissions-matrix.md`, `accounting-design.md`, ce fichier. **Arrêt obligatoire
ici pour validation utilisateur avant tout code métier** (§72, §82).

## Phase 1 — Socle MVP

Objectif métier (§73, priorité absolue) : permettre à Jean Alix Pierre de se
connecter, voir le dashboard, ajouter des employés, créer comptes bancaires/
caisse, enregistrer le financement PAPEJ (850 000 HTG), définir les lignes
budgétaires, demander/approuver/payer une dépense avec justificatif, voir le
budget restant en temps réel, consulter historique et audit, exporter un
rapport PAPEJ.

Contenu :
1. Organisation, Auth, utilisateurs, rôles, permissions (RBAC minimal viable).
2. Dashboard Direction (version simplifiée, sections Finance + PAPEJ + RH).
3. Journal d'audit (trigger-based, opérationnel dès les premières écritures).
4. Paramètres (organisation, devise, numérotation, catégories de base).
5. Employés, départements, postes, contrats (sans payroll), documents RH.
6. Dépenses (workflow complet §accounting-design.md §4), caisse, banque, budget.
7. Module PAPEJ complet avec rapport exportable (PDF/Excel).

**Critère de sortie** : le parcours §73 (14 étapes) est exécuté de bout en bout
sur un environnement de test, avec preuves (captures/logs), tests RLS des rôles
concernés au vert, `npm run build` / `tsc` / lint verts.

## Phase 2 — Finance & Comptabilité

Plan comptable, journaux, écritures automatiques + manuelles, clients,
fournisseurs, facturation, paiements, rapprochement bancaire, immobilisations,
états financiers, prêt FDI (avec génération automatique du tableau
d'amortissement dès saisie des conditions réelles), module Dons & Subventions
complet.

## Phase 3 — RH & Payroll

Présence, congés (workflow employé → manager/RH → validation), recrutement
(ATS léger avec pipeline et grille de notation configurable), payroll (moteur
configurable, workflow préparation → verrouillage), avances employés, fiches
de paie PDF.

## Phase 4 — CRM MedFinder

Agents terrain, prospects, visites (mobile-first, capture GPS optionnelle),
onboarding, statuts Standard/Pro, objectifs, commissions (uniquement sur
encaissement confirmé).

## Phase 5 — Intégration MedFinder Public

API dédiée, scoped, rate-limitée, revue de sécurité spécifique. Aucun accès
direct base-à-base dans aucun sens. Conception détaillée différée à
l'ouverture de cette phase (hors périmètre Phase 0).

## Phase 6 — Analytics et pilotage

Prévisions, cash-flow forecast, KPI avancés, alertes, comparaison
budget/réalisé, tendances, projections.

---

## Stratégie de tests (transverse à toutes les phases)

| Type | Portée |
|---|---|
| Unitaires | Règles de calcul (budget disponible, payroll, amortissement FDI/actifs), fonctions `has_permission`, moteur de numérotation |
| Intégration API | Chaque Server Action / Route Handler mutante : cas autorisé + cas refusé |
| RLS | Matrice complète `security.md` §4, rejouée à chaque migration touchant une policy |
| Workflow | Voir liste obligatoire ci-dessous |
| E2E (Playwright) | Parcours critiques : dépense bout-en-bout, clôture de période, paie bout-en-bout, rapport PAPEJ |

### Tests obligatoires (repris du prompt maître §63)

**Finance** : double approbation si configurée ; refus d'auto-approbation ;
budget insuffisant bloque l'engagement ; annulation de dépense tracée ;
justificatif requis avant comptabilisation ; rapprochement bancaire cohérent.

**Comptabilité** : `debit = credit` toujours vrai à l'état `posted` ; écriture
sur période fermée refusée ; contre-passation crée une nouvelle écriture sans
toucher l'originale ; suppression d'une écriture validée impossible (aucune
route ne l'expose).

**Payroll** : calcul conforme aux composants configurés ; validation DG requise
avant paiement ; verrouillage empêche toute modification silencieuse après
paiement ; permissions respectées (`payroll.view_all` vs `payroll.view_own`).

**RLS** : chaque rôle testé avec un compte dédié sur les scénarios de
`security.md` §4.

## Données de démonstration (seed DEV)

- Seed exécuté uniquement sur l'environnement `dev`, jamais `staging` (données
  réalistes non fictives-financières) ni `production`.
- Contenu minimal : 5 employés fictifs, 3 fournisseurs, un budget fictif, des
  transactions fictives — clairement marqués (ex. préfixe `[DEMO]` ou
  organisation `MedFinder Demo` distincte) pour ne jamais être confondus avec
  les données réelles de MedFinder Haiti.

## Risques techniques identifiés

| Risque | Impact | Mitigation |
|---|---|---|
| Règles fiscales/payroll haïtiennes non figées | Blocage calcul paie réel | Moteur configurable dès la conception (§39), pas de dépendance à un taux en dur |
| Conditions FDI non signées définitivement | Tableau d'amortissement provisoire erroné | `loans.is_provisional`, régénération automatique à la saisie des conditions réelles |
| Complexité RLS avec permissions granulaires + overrides | Policies difficiles à maintenir, risque de trou de sécurité | Fonction unique `has_permission()` réutilisée partout, matrice de tests systématique à chaque migration |
| Équipe réduite (2 fondateurs) exécutant les rôles de séparation des fonctions | Séparation des fonctions difficile à respecter strictement | Mécanisme d'exception tracé + validation DG explicite plutôt qu'un blocage rigide impraticable |
| Multi-devise et taux de change | Incohérence si recalcul rétroactif | Taux figé à la saisie, jamais recalculé (ADR-006) |
| Volume de tables (55+) dès Phase 1/2 | Dérive de portée, retard | Découpage strict par phase, Phase 1 limitée au parcours §73 |
| Intégration future avec le site public | Couplage accidentel prématuré | Aucun accès direct interdit par principe (ADR-001), API dédiée différée en Phase 5 |

## Décisions nécessitant l'approbation de Jean Alix Pierre avant Phase 1

- **D1 — Accès base de données** : confirmer client Supabase typé + RPC
  transactionnelles (ADR-003) plutôt qu'un ORM tiers (Prisma/Drizzle).
- **D2 — MFA** : confirmer la liste des rôles pour lesquels le MFA est
  obligatoire dès Phase 1 (proposition : SUPER_ADMIN, DG, DT, COMPTABLE).
- **D3 — Portée d'approbation MANAGER** : confirmer que le périmètre
  d'approbation d'un manager correspond à `employees.manager_employee_id`
  (hiérarchie directe) et non à une notion d'équipe/département distincte.
- **D4 — Sauvegarde hors Supabase** : choisir le fournisseur de stockage pour
  l'export logique périodique (`pg_dump`) indépendant de Supabase.
- **D5 — Rétention des données** : durée de conservation des documents RH et
  des logs d'audit après fin de contrat / clôture d'exercice.
- **D6 — Conditions FDI réelles** : dès disponibles, transmettre taux, durée,
  grâce et date de décaissement définitifs pour remplacer les valeurs
  provisoires (3–5 %, jusqu'à 10 ans, grâce 6–12 mois).
- **D7 — Séparation des fonctions en pratique** : valider le mécanisme
  d'exception tracée (§3 de `security.md`) comme solution praticable vu la
  taille actuelle de l'équipe.
- **D8 — Domaine et déploiement** : confirmer la disponibilité du sous-domaine
  `gestion.medfinderhaiti.com` et l'accès DNS nécessaire pour le pointer vers
  Vercel en Phase 1 tardive ou Phase 2.

Aucune de ces décisions ne bloque la poursuite de la conception, mais **D1 à
D3** doivent être tranchées avant le premier commit de code métier (migrations
incluses), car elles affectent directement le schéma et les policies RLS.

## Documentation à maintenir à chaque phase (§66)

README, architecture, schéma, migrations, rôles, workflows, tests, procédure
setup, procédure production, procédure backup, procédure restauration — mise à
jour obligatoire avant de déclarer une phase close, avec rapport de clôture
(§71) : fonctionnalités réalisées, fichiers créés/modifiés, migrations, tests
exécutés + résultats, risques restants, dette technique, points nécessitant
validation utilisateur, commit git, prochaine phase.
