# Phase 2A — Moteur comptable complet — Rapport de clôture

Statut : **VALIDÉE FONCTIONNELLEMENT, EN ATTENTE DE VOTRE VALIDATION**
avant tout début de Phase 2B — conformément à votre instruction explicite
du 17/08/2026 ("commence Phase 2A uniquement... arrêt pour validation").
Aucune ligne de Phase 2B (états financiers) ni des sous-phases suivantes
n'a été commencée.

## 1. Périmètre livré (conforme à `docs/phase-2-plan.md` §2A)

- **Écritures manuelles avec séparation saisie/validation obligatoire** :
  workflow `Draft → Submitted → Approved/Rejected → Posted → Reversed`.
  Le créateur ne peut jamais valider sa propre écriture (garde d'acteur,
  même mécanisme que `approve_expense_request`). Exception SoD formelle
  disponible (justification + validation DIRECTEUR_GENERAL/SUPER_ADMIN +
  audit), mirror exact du mécanisme déjà prouvé sur les dépenses en 1C.4.
- **Plan comptable** : seed minimal MedFinder (18 comptes — trésorerie,
  créances, immobilisations, amortissements, dettes fournisseurs, emprunt
  FDI, capital, revenus, charges) appliqué à toutes les organisations
  existantes + auto-seedé pour toute future organisation. Entièrement
  administrable (création/désactivation). Un compte référencé par au
  moins une ligne d'écriture ne peut plus être supprimé physiquement,
  même via `service_role` (nouveau trigger défense-en-profondeur, même
  patron que l'immutabilité des périodes/écritures déjà en place).
- **Journaux, exercices, périodes** : UI de gestion complète
  (`/comptabilite`) — les policies RLS et le moteur (déjà existants
  depuis 1C.1) sont réutilisés sans modification.
- **`app_private.post_journal_entry` élargie** : accepte désormais aussi
  le statut `approved` (chemin manuel) en plus de `draft` (chemin
  automatique dépenses/PAPEJ, inchangé) — voir §3 pour les deux
  correctifs appliqués après découverte en vérification directe.
- **UI `/comptabilite`** : plan comptable, journaux, exercices/périodes
  (création + clôture), liste des écritures (automatiques et manuelles),
  formulaire de création d'écriture manuelle multi-lignes avec équilibre
  affiché en temps réel côté client (jamais la source de vérité), fiche
  détail avec actions de workflow complètes et historique d'approbation.

## 2. Ce qui n'a pas été recréé (conforme à la vérification §12 du plan)

Confirmé par l'implémentation réelle : `chart_of_accounts`,
`fiscal_years`, `accounting_periods`, `journals`, `journal_entries`/
`journal_entry_lines`, `post_journal_entry` (élargie, pas remplacée),
`reverse_journal_entry` (totalement inchangée), `create_and_post_two_line_entry`
(inchangée, toujours utilisée automatiquement par `justify_expense_request`
et `record_grant_receipt`), le moteur `numbering_sequences`, le patron
SoD/exception des dépenses (répliqué à l'identique, pas modifié). Aucune
permission catalogue ajoutée — `accounting.post`/`accounting.view` déjà
seedées depuis la Phase 1A couvrent tout le périmètre 2A.

## 3. Deux défauts réels trouvés et corrigés — par vérification directe, pas par relecture de code

**Défaut n°1 — contournement du workflow SoD** (trouvé en testant
réellement le formulaire dans le navigateur, pas en relisant le SQL) :
la première version de `post_journal_entry` acceptait tout statut
`draft` sans distinguer une écriture manuelle d'une écriture
automatique — un COMPTABLE pouvait créer un brouillon manuel et cliquer
directement "Comptabiliser", **sans jamais passer par Soumettre/
Approuver**, contournant entièrement la séparation saisie/validation
exigée. Corrigé par la migration `20260818090003` : `draft` n'est plus
accepté que pour les écritures automatiques (`source_type <> 'manual'`) ;
une écriture manuelle exige désormais `approved`.

**Défaut n°2 — régression du premier correctif sur la contre-passation**
(trouvé par mon propre test d'intégration, pas par relecture) : le
correctif n°1 bloquait aussi la contre-passation d'une écriture manuelle
**légitimement approuvée et postée** — `reverse_journal_entry` crée une
nouvelle ligne héritant du `source_type` de l'originale (`manual`) mais
démarrant à `draft`, puis la poste immédiatement dans la même
transaction ; le correctif n°1 bloquait ce chemin aussi. Corrigé par la
migration `20260818090004` : seule une écriture manuelle **racine**
(`reversed_entry_id IS NULL`) exige `approved` — une ligne de
contre-passation (`reversed_entry_id IS NOT NULL`) suit le chemin
`draft` inchangé, cohérent avec le fait que `reverse_journal_entry` est
déjà elle-même gardée par `accounting.reverse` + justification
obligatoire.

Une collision de nommage incidente a aussi été corrigée dans
`accounting-core.test.ts` (fixtures génériques préexistantes utilisant
`source_type: 'manual'` par convention arbitraire, sans lien avec le
nouveau workflow) — changée en `'expense'`, aucun impact sur ce que ce
fichier teste réellement (invariants génériques de posting/immutabilité).

Les deux correctifs ont été appliqués par vous via l'éditeur SQL
Supabase (même procédure que les migrations initiales), puis
re-vérifiés par rejeu complet des tests concernés avant de continuer.

## 4. Migrations appliquées (4, dans l'ordre, toutes confirmées appliquées par vous)

```
20260818090001_manual_journal_entries.sql                  (workflow SoD + journal_entry_approvals)
20260818090002_chart_of_accounts_seed_and_immutability.sql (seed 18 comptes + trigger immutabilité)
20260818090003_fix_manual_entry_sod_bypass.sql              (correctif défaut n°1)
20260818090004_fix_manual_entry_reversal_guard.sql          (correctif défaut n°2)
```

## 5. Tests — couverture réelle

**15 nouveaux tests d'intégration** (`tests/integration/manual-journal-entries.test.ts`) :
création (2 lignes minimum, refus `not_authorized` sans `accounting.post`),
**refus direct de comptabilisation d'un brouillon manuel non approuvé**
(verrouille le défaut n°1), soumission, auto-approbation refusée,
validateur distinct approuve puis comptabilise (chemin `approved`),
rejet, **contre-passation d'une écriture manuelle postée** (verrouille
le défaut n°2), exception SoD (non-DG refusé, auto-validation refusée
même SUPER_ADMIN, validateur DG distinct fonctionne), isolation
multi-organisation, immutabilité d'un compte utilisé (suppression
refusée même via `service_role`) vs compte jamais utilisé (suppression
autorisée).

**Non-régression** : `accounting-core.test.ts` (18 tests, dont posting/
immutabilité/contre-passation/isolation), `expenses.test.ts`,
`papej.test.ts`, `budget.test.ts` — tous rejoués sans aucun changement
de résultat attendu, confirmant que le chemin automatique (dépenses/
PAPEJ) fonctionne exactement comme avant Phase 2A.

**Rejeu complet en une seule passe continue** (exigence non négociable,
même discipline que la clôture Phase 1C) :

| Suite | Résultat | Détail |
|---|---:|---|
| Unitaire | 64/64 | 7 fichiers |
| Intégration | **192/192** | 19 fichiers (18 existants + `manual-journal-entries.test.ts`), une seule passe continue (461s) |
| E2E Playwright | **17/17** | 7 fichiers, une seule passe isolée (3.3min) |
| **Total** | **273/273** | Aucune combinaison "vert isolé / rouge groupé" |

## 6. Incident réseau rencontré pendant la vérification — diagnostiqué, pas ignoré

Un premier rejeu combiné (intégration puis E2E) a rencontré des échecs
`Request rate limit reached` (Supabase Auth, 6 tests) et un timeout de
hook — diagnostic immédiat : tous les échecs partageaient exactement la
même cause, aucune assertion métier différente. Attente de dissipation
(15 min) puis rejeu complet propre (192/192).

Le rejeu E2E suivant a ensuite rencontré un échec de connexion
(`page.waitForURL` timeout au login) sur un test **totalement extérieur
à Phase 2A** (`budget-workflow.spec.ts`, transfert budgétaire, code
non touché par cette session). Diagnostic direct plutôt que supposition :
`curl` vers l'endpoint santé Supabase Auth a mesuré **3,8s** (contre
~0,1-0,8s en fonctionnement normal) au moment de l'échec, confirmant une
dégradation réseau réelle et non un défaut applicatif. Le serveur de
développement (actif depuis ~6h) a été redémarré par précaution ; un
nouveau `curl` quelques minutes plus tard a mesuré 0,78s (retour à la
normale), et le rejeu a immédiatement réussi (2/2 puis 17/17 sur la
suite complète). Documenté honnêtement ici plutôt que masqué, conforme
à la discipline de diagnostic déjà appliquée tout au long de ce projet.

## 7. Vérification finale

```bash
npx tsc --noEmit     # 0 erreur
npm run lint          # 0 erreur, 0 avertissement
npm run build           # succes, 26 routes (+ /comptabilite, /comptabilite/[id])
git grep eyJhbGci        # 0 resultat reel
git status               # propre apres commit (voir §9)
```

## 8. Vérification visuelle directe (navigateur, pas seulement les tests)

Connecté en tant que `comptable.demo@medfinder.test` (rôle COMPTABLE) :
page `/comptabilite` affichée avec plan comptable (18 comptes seedés
visibles en tête de liste), 6 journaux, écritures existantes avec statut
correctement coloré. Formulaire "Nouvelle écriture manuelle" rempli et
soumis réellement (pas simulé au niveau RPC) : création réussie,
redirection vers la fiche, lignes et totaux affichés correctement. C'est
cette vérification visuelle directe — pas la suite de tests — qui a
révélé le défaut n°1 (§3), confirmant l'utilité de ne jamais se fier
uniquement aux tests automatisés pour une fonctionnalité de sécurité
nouvelle.

## 9. Commits

Un commit atomique regroupant migrations + backend + UI + tests +
correctifs (voir `git log` après ce rapport) — même discipline que les
sous-jalons 1C.1-1C.5.

## 10. Risques et dette

| Sujet | Détail | Action recommandée |
|---|---|---|
| Dropdown "Compte" à ~780 options dans le formulaire d'écriture manuelle | Accumulation historique de comptes de test (héritage documenté Phase 1C, immutabilité des comptes utilisés) | Non bloquant pour un usage réel (peu d'organisations), mais à surveiller si le nombre de comptes réels grandit ; un filtre de recherche serait une amélioration UX future, hors périmètre 2A |
| Incident réseau Supabase pendant la vérification | §6 — diagnostiqué comme transitoire, confirmé résolu par mesure directe avant/après | Aucune action requise ; pattern déjà documenté 3 fois dans ce projet |
| `run_monthly_depreciation` (2E), rapprochement bancaire (2D), etc. | Pas encore construits, prévus dans l'ordre §0.6 du plan | Suivre le plan Phase 2 |

## 11. Prochaine étape

**Je m'arrête ici pour votre validation**, comme demandé. Phase 2A est
livrée avec preuve : 273/273 tests verts en passes continues, deux
défauts réels trouvés et corrigés (pas dissimulés), typecheck/lint/build
propres, `git status` propre. **Aucune ligne de Phase 2B (états
financiers) n'a été commencée** — j'attends votre confirmation avant de
démarrer.
