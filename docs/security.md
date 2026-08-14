# MedFinder Gestion — Sécurité, RBAC, RLS, Audit

Statut : Phase 0 — Proposition en attente de validation.

## 1. Authentification

- Supabase Auth (email/mot de passe ; magic link optionnel plus tard).
- MFA obligatoire pour : `SUPER_ADMIN`, `DIRECTEUR_GENERAL`, `DIRECTEUR_TECHNIQUE`,
  `COMPTABLE`. Recommandé (non bloquant Phase 1) pour `RH`, `MANAGER`.
- **Bootstrap du premier SUPER_ADMIN** (procédure sûre, à exécuter une seule fois) :
  1. Créer le compte via Supabase Auth (dashboard ou script serveur avec
     `service_role`, jamais exposé côté client).
  2. Insérer manuellement la ligne `memberships` liant ce compte au rôle
     `SUPER_ADMIN` sur l'organisation « MedFinder Haiti », via migration SQL
     one-shot exécutée par un opérateur humain (pas via l'UI, pas de route API
     publique permettant l'auto-élévation).
  3. Forcer la configuration MFA à la première connexion.
  4. Aucun identifiant n'est jamais committé dans le dépôt — mot de passe initial
     communiqué hors bande (canal sécurisé), changement obligatoire à la première
     connexion.
- Reset password : flux standard Supabase Auth (email + lien à expiration courte).
- Sessions : JWT Supabase, expiration + refresh token ; l'organisation active est
  résolue côté serveur à chaque requête (jamais lue depuis un simple state client
  non revérifié).

## 2. Modèle RBAC

Deux couches, toutes deux vérifiées **côté serveur** :

1. **Rôle** (`roles` + `role_permissions`) = ensemble de permissions par défaut.
2. **Permission individuelle** (`user_permission_overrides`) = exception ponctuelle
   et traçable (accorder ou retirer une permission précise à un utilisateur donné,
   avec justification, auteur, expiration optionnelle).

Résolution effective d'une permission pour un utilisateur sur une organisation :
`permissions(rôle) ∪ overrides(grant) − overrides(revoke)`, calculée par une
fonction Postgres `has_permission(user_id, organization_id, permission_code)`
réutilisée à la fois par les policies RLS et par les Server Actions (source unique
de vérité, pas de logique dupliquée en TypeScript).

Rôles définis en Phase 1 (catalogue complet dans `docs/permissions-matrix.md`) :
`SUPER_ADMIN`, `DIRECTEUR_GENERAL`, `DIRECTEUR_TECHNIQUE`, `COMPTABLE`, `RH`,
`MANAGER`, `AGENT_TERRAIN`, `SUPPORT`, `EMPLOYE`.

Règles explicites du prompt maître appliquées strictement :
- `DIRECTEUR_GENERAL` et `DIRECTEUR_TECHNIQUE` n'ont **pas** automatiquement
  `employee.view_salary` — permission distincte, accordée explicitement si besoin.
- `AGENT_TERRAIN` : accès strictement scoping à ses propres prospects/visites/
  tâches/objectifs/dépenses autorisées (policy RLS filtrant sur `assigned_agent_id
  = auth.uid()` en plus du filtre organisation).
- `SUPPORT` : aucun accès comptabilité/finance.
- `COMPTABLE` : ne peut pas gérer les rôles/permissions (`role.manage` réservé
  `SUPER_ADMIN`/`DIRECTEUR_GENERAL`). `DIRECTEUR_TECHNIQUE` dispose de
  `user.manage` (comptes techniques uniquement) mais pas de `role.manage`.

## 3. Séparation des fonctions (SoD)

Contrôles appliqués en base (pas seulement en UI) :
- `expense_requests.requester_id != expense_approvals.approver_id` (contrainte
  applicative vérifiée côté serveur + policy RLS interdisant l'insertion d'une
  approbation par le demandeur).
- Paiement (`expenses.paid_by`) différent de l'approbateur lorsque l'effectif de
  l'organisation le permet (règle souple, avec `is_exception` traçé sinon).
- Rapprochement bancaire réalisé par un utilisateur différent du payeur lorsque
  possible.
- Toute exception (petite équipe, indisponibilité) exige `exception_reason` +
  validation `DIRECTEUR_GENERAL` + entrée `audit_logs` — jamais silencieuse.

## 4. Stratégie RLS (Row Level Security)

Principe : **RLS activé sur 100 % des tables exposées**, sans exception, dès la
migration qui les crée. Aucune table n'est temporairement « ouverte » pour
accélérer le développement.

Patron de policy standard (exemple conceptuel, détaillé en Phase 1 dans les
migrations) :

```sql
-- Lecture : appartenance à l'organisation + permission de vue du module
create policy "select_scoped" on expense_requests
for select using (
  organization_id = current_org_id()
  and has_permission(auth.uid(), organization_id, 'expense.view')
);

-- Écriture sensible : permission dédiée, pas seulement la lecture
create policy "approve_scoped" on expense_approvals
for insert with check (
  organization_id = current_org_id()
  and has_permission(auth.uid(), organization_id, 'expense.approve')
  and approver_id = auth.uid()
  and approver_id != (select requester_id from expense_requests where id = expense_id)
);
```

Cas particuliers :
- **Salaires** : `employees` séparée en colonnes visibles par défaut vs. colonnes
  sensibles exposées uniquement via une vue restreinte + `employee.view_salary`.
- **Agent terrain** : policy additionnelle `assigned_agent_id = auth.uid()` sur
  `crm_prospects`, `crm_visits`, `crm_tasks`, `agent_objectives`.
- **Audit logs** : `select` réservé à `audit.view` ; **aucune** policy `insert`/
  `update`/`delete` pour les rôles applicatifs — écriture uniquement via trigger
  `security definer` déclenché par les opérations métier elles-mêmes.
- **Périodes comptables fermées** : policy `update`/`insert` sur `journal_entries`
  bloquant toute écriture dont `period_id` référence une période `status = 'closed'`,
  sauf procédure exceptionnelle dédiée (fonction RPC réservée, elle-même auditée).

### Matrice de tests RLS obligatoire (voir aussi roadmap.md §Tests)

| Scénario | Attendu |
|---|---|
| Utilisateur org A lit une donnée org B | 0 ligne retournée |
| Agent terrain lit `employees.salary` | Refusé |
| Support lit `journal_entries` | Refusé |
| Comptable tente `role_permissions.insert` | Refusé |
| Employé lit son propre dossier RH | Autorisé (champs limités) |
| Employé lit le dossier RH d'un collègue | Refusé |
| Demandeur insère sa propre approbation de dépense | Refusé |
| Utilisateur sans `accounting.close_period` ferme une période | Refusé |

## 5. Clé `service_role`

- Utilisée exclusivement dans du code serveur (Route Handlers / Server Actions /
  jobs), jamais importée dans un composant client, jamais dans le bundle envoyé
  au navigateur.
- Stockée en variable d'environnement Vercel (scope serveur uniquement), jamais
  dans `.env` committé, jamais dans `localStorage`/cookies, jamais loggée (y
  compris en cas d'erreur — filtrage explicite dans le gestionnaire d'erreurs).
- Réservée aux opérations impossibles sous RLS normal (ex. bootstrap initial,
  jobs planifiés système) — toute opération utilisateur standard passe par la
  clé anon + RLS.

## 6. Journal d'audit

- Table `audit_logs` append-only (voir data-model.md §O). Écriture déclenchée par
  triggers Postgres `security definer` sur les tables sensibles (pas par du code
  applicatif qui pourrait être contourné).
- Champs enregistrés : utilisateur, action, module, type d'objet, ID objet,
  ancienne/nouvelle valeur (jsonb), horodatage, IP (si disponible via en-tête
  transmis par le serveur), user agent, organisation, résultat.
- Actions couvertes a minima : création/modification employé, modification
  salaire, approbation/rejet/annulation dépense, paiement, clôture comptable,
  modification budget, changement de permission/rôle, suppression logique,
  contre-passation, clôture de contribution/PAPEJ, verrouillage paie.
- Non modifiable depuis l'interface standard : aucune route applicative n'expose
  d'update/delete sur `audit_logs` ; RLS n'autorise que `select`.

## 7. Classification des données sensibles (§80) et application

| Niveau | Exemples | Contrôle |
|---|---|---|
| Public interne | nom, fonction, département | Visible à tout utilisateur authentifié de l'organisation |
| Confidentiel | contrat, salaire | Permission dédiée (`contract.manage`, `employee.view_salary`) |
| Très sensible | NIF, NINU, CIN, coordonnées bancaires | Colonnes isolées, vue restreinte, permission dédiée, jamais dans les exports par défaut, masquage partiel à l'affichage (`****1234`) |

## 8. Stockage documents

- Buckets Supabase Storage **privés** uniquement pour RH/finance/PAPEJ/contrats.
- Accès via URL signée à durée limitée générée côté serveur après vérification
  de permission — jamais d'URL publique permanente pour un document sensible.
- Métadonnées (`documents`) séparées du binaire : permet une policy RLS sur les
  métadonnées cohérente avec la policy de génération d'URL signée.

## 9. Audit de sécurité pré-production (§60 — checklist de clôture finale)

- [ ] Aucun secret dans le dépôt (scan automatisé + revue manuelle `.env.example`).
- [ ] RLS activé et testé sur 100 % des tables exposées (matrice §4 exécutée).
- [ ] RBAC : parcours des 9 rôles avec comptes de test dédiés.
- [ ] IDOR : tentative d'accès à un objet d'une autre organisation par ID direct.
- [ ] Mass assignment : Server Actions n'acceptent que des champs whitelistés
      (schémas Zod stricts, `.strict()`), jamais un objet brut du client.
- [ ] Uploads : validation type MIME + taille + scan minimal, stockage privé.
- [ ] Injection SQL : requêtes paramétrées uniquement (client Supabase / RPC),
      aucune concaténation de SQL dynamique côté serveur.
- [ ] XSS : échappement systématique (React échappe par défaut ; audit des
      `dangerouslySetInnerHTML` — usage interdit sauf contenu généré serveur
      strictement contrôlé).
- [ ] CSRF : Server Actions Next.js (protection native par origin-check) ; audit
      des Route Handlers exposant des mutations pour vérifier la même garantie.
- [ ] Logs : vérification qu'aucun mot de passe, `service_role`, token, donnée RH
      très sensible n'apparaît dans les logs serveur.
- [ ] Rate limiting sur routes critiques (login, reset password, actions
      financières exposées en API).

## 10. Sauvegarde et restauration

- Sauvegardes automatiques Supabase (point-in-time recovery) activées dès la
  création du projet `production`.
- Export logique périodique (`pg_dump` planifié) additionnel, stocké hors
  Supabase (ex. stockage objet séparé), pour ne pas dépendre d'un seul
  fournisseur en cas d'incident.
- Documents (Storage) : réplication/export périodique séparé des métadonnées DB.
- **Restauration testée** : procédure documentée et exécutée au moins une fois
  sur un environnement neuf avant la validation finale (§81) ; résultat consigné
  dans le rapport de clôture de la phase concernée.
- Procédure de restauration documentée dans `docs/roadmap.md` (mise à jour à
  chaque phase, §66).

## 11. Décisions de sécurité nécessitant validation utilisateur

Voir `docs/roadmap.md` §Décisions — notamment : politique MFA exacte par rôle,
fournisseur d'export de sauvegarde hors Supabase, durée de rétention des logs
d'audit et des documents RH après fin de contrat.

## 12. Politique SUPER_ADMIN sur ses propres rôles/permissions (audit pré-Phase 1B)

Règle exacte implémentée (`app_private.has_permission`,
`public.admin_assign_role`, `public.admin_revoke_role` — voir
`supabase/migrations/20260813100009_admin_rpc_functions.sql` et
`20260813100013_mfa_enforcement.sql`) :

- **Tout rôle sauf SUPER_ADMIN** (DIRECTEUR_GENERAL compris) : un acteur ne
  peut **jamais** s'auto-assigner ni s'auto-retirer un rôle, quelle que soit
  la permission qu'il détient par ailleurs. Toute tentative renvoie
  `self_elevation_blocked` (si `role.manage` est détenu) ou `not_authorized`
  (sinon) — jamais silencieuse, toujours un refus explicite.
- **SUPER_ADMIN** : seul rôle exempté de l'interdiction d'auto-modification —
  un SUPER_ADMIN peut s'assigner ou se retirer n'importe quel rôle à
  lui-même, **à condition que sa session courante ait déjà franchi le défi
  MFA (AAL2)**, faute de quoi `has_permission`/`is_super_admin` renvoient
  faux avant même d'atteindre la logique métier (aucun contournement possible
  via cette voie). Ce choix est délibéré : SUPER_ADMIN est le rôle technique
  de dernier recours (accès global, bootstrap, reprise après incident) — lui
  interdire toute auto-gestion créerait un risque de blocage total du système
  (aucun autre rôle ne peut lui accorder ou retirer un rôle) sans bénéfice de
  sécurité proportionné, puisqu'il détient déjà, par construction, le niveau
  de confiance maximal du système.
- **Aucune modification silencieuse** : toute assignation, retrait,
  suspension, override de permission ou changement de paramètres
  d'organisation — accordée, refusée, ou en erreur — déclenche
  systématiquement une écriture dans `audit_logs`, via deux mécanismes
  complémentaires (voir §6) :
  1. Le trigger générique `app_private.audit_row_trigger` sur toute écriture
     réussie dans `organizations`, `users`, `memberships`, `roles`,
     `role_permissions`, `membership_roles`, `user_permission_overrides`.
  2. Un appel explicite à `app_private.write_audit_log(..., 'denied')` dans
     chaque fonction `admin_*` avant de renvoyer un refus (nécessaire car
     une exception SQL annulerait la transaction et perdrait la trace — voir
     l'en-tête de `20260813100009_admin_rpc_functions.sql`).
- **Preuve testée** (`tests/integration/mfa-enforcement.test.ts`,
  `tests/integration/admin-negative.test.ts`) : un DIRECTEUR_GENERAL
  pleinement authentifié MFA (AAL2) reste bloqué sur l'auto-assignation
  (`self_elevation_blocked`) ; un MANAGER/COMPTABLE sans `role.manage` est
  bloqué en amont (`not_authorized`) ; chaque cas produit une ligne
  `audit_logs` avec `result = 'denied'`.
