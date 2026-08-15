-- MedFinder Gestion — Phase 1C, correctif post-verification cloud
-- Trouvaille (rejeu des tests d'integration contre le projet cloud) :
-- `budget_line_balances` (1C.3) est definie avec security_invoker=true afin
-- que l'isolation RLS s'applique au role appelant reel (§10 du plan
-- corrige) — mais le calcul qu'elle expose passe par la fonction
-- app_private.budget_line_available(), a laquelle seul `revoke` avait ete
-- applique (aucun grant complementaire, contrairement a can_access_expense/
-- can_access_employee_documents qui sont, elles, appelees depuis des
-- policies RLS et grantees a authenticated en consequence).
--
-- Avec security_invoker=true, l'appel a la fonction a l'interieur de la vue
-- s'execute sous le role appelant reel (pas sous le proprietaire de la
-- vue) : le privilege EXECUTE est verifie contre CE role avant meme que le
-- contexte SECURITY DEFINER de la fonction ne s'applique. Sans grant a
-- authenticated, toute requete directe sur la vue par un client
-- authentifie echoue avec "permission denied for function
-- budget_line_available", meme pour un role parfaitement autorise —
-- confirme par 2 echecs de tests/integration/budget.test.ts rejoues contre
-- le projet cloud (support.demo et orgb.demo, tous deux cense recevoir un
-- resultat vide, pas une erreur).
--
-- Pas un probleme de securite (la fonction ne fait que lire un montant deja
-- filtre par la ligne budget_lines visible via RLS, elle n'accorde aucun
-- acces supplementaire) — uniquement un oubli de grant, corrige ici selon
-- le standard app_private (§14 du plan corrige : revoke puis grant cible).

grant execute on function app_private.budget_line_available(uuid) to authenticated;

comment on function app_private.budget_line_available is
  'Formule complete (§4 du plan corrige) : planned - engage_actif - '
  'paye_sur_engagement - paye_hors_engagement. Aucun double comptage. '
  'GRANT EXECUTE a authenticated necessaire (voir tete de migration) : '
  'appelee directement par la vue security_invoker budget_line_balances, '
  'qui s''execute sous le role appelant reel — sans ce grant, tout acces '
  'via la vue echoue avec "permission denied", meme pour un role autorise.';
