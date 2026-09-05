# MedFinder — contexte visuel existant

## Source de vérité

Les tokens `mf-*` de `app/globals.css` restent la source canonique.
Ce document décrit l'identité en place ; il ne crée pas une nouvelle palette.
Les polices restent Geist et Geist Mono, chargées par `app/layout.tsx`.

- Marine : `mf-navy-950`, `mf-navy-900`, `mf-navy-800`, `mf-navy-700`.
- Émeraude : `mf-emerald-700`, `mf-emerald-600`, `mf-emerald-500`, `mf-emerald-50`.
- Surfaces et séparateurs : `mf-surface`, `mf-border`, `background`.
- Danger : `mf-danger` ; avertissements : les nuances ambre déjà utilisées.
- La couleur complète un libellé explicite ; elle ne remplace pas une information.

## Variante Direction

La source visuelle canonique est le stash identifié par le message
`prototype-ui-apercu-direction`, créé avec `git stash push -u`.
Lors de la vérification, il est désigné par `stash@{0}` et résout vers
`83f40ad8da71ffa7098fe2942562a3c1604f0faa`. Ce SHA est une empreinte vérifiée
du stash nommé, pas une source indépendante choisie à sa place.
Les huit fichiers du prototype sont dans son troisième parent (fichiers
non suivis), `5eefeb8365bbcd7f0337b9a347502ef6269227f0`.
Les sources directes sont `app/(preview)/apercu/direction/page.tsx` et
`components/preview/preview-primitives.tsx`. Les routes et fichiers de
prévisualisation ne sont pas restaurés dans l'application.
La migration vers `/direction` reprend sa composition et ses primitives,
en remplaçant les variables `--p-*` par les tokens existants ci-dessus.

- Accueil hiérarchisé : organisation, titre, description, rôles.
- Indicateurs opérationnels autonomes, puis panneaux financiers nommés.
- Panneaux et cartes arrondis de 12 px, bordures fines, sans ombre ajoutée.
- Libellés courts en capitales espacées ; montants tabulaires dominants.
- Cartes imbriquées légèrement teintées ; espacement de 32 px entre sections.
- Barres de composition réservées à des montants déjà calculés et comparables.
- Zéro affiché comme zéro ; aucune série, variation ou valeur inventée.
- Grilles adaptatives, montants longs pouvant revenir à la ligne.

Cette variante appartient à `components/direction/`. Elle ne modifie pas
les cartes des autres modules, les permissions, les requêtes ou les helpers métier.

## Contrat de présentation

`app/(app)/direction/page.tsx` conserve les accès et calculs actuels.
`DirectionDashboard` reçoit leurs résultats ; les primitives sont des composants
serveur sans accès aux données. Le prototype fournit uniquement le langage visuel.
Le parcours reste une consultation et la navigation utilise les routes existantes.

## Shell authentifié issu du même stash

Le portage du shell est une étape distincte, autorisée après le dashboard.
Références : `app/(preview)/layout.tsx`, `preview-shell.tsx`, `preview-nav.tsx`,
`preview-account.tsx` et `preview-theme.tsx`, lus dans `stash@{0}^3`.
Seuls leurs comportements visuels sont intégrés aux composants de production.

- Sidebar de 292 px, fixe dans le viewport desktop (`lg`, 1024 px), navigation
  seule défilante ; compte, apparence et vraie action Déconnexion ancrés en bas.
- Groupes du prototype : Pilotage, Finance, Ressources humaines, Administration,
  puis Autres pour toute route non classée. Les entrées proviennent exclusivement
  du filtrage de permissions existant dans le layout serveur.
- Hover exact : rayon 80 px, smoothstep, déplacement maximal 9 px, lissage
  exponentiel de 140 ms, seuil 0,0015, marqueur de 22 px. Même effet au focus ;
  aucun déplacement ni boucle avec `prefers-reduced-motion: reduce`.
- Sous 1024 px : bouton Menu dans le header et tiroir, fermeture après navigation,
  par fond/Echap ; focus contenu dans le tiroir et restitué à la fermeture.
- Header : fil d'Ariane dérivé des liens autorisés, organisation à droite sur
  grand écran. La recherche fictive du prototype et ses palettes alternatives
  ne sont pas intégrées.

La source de tokens reste `app/globals.css`, avec son extension `app/theme.css`.
Les rôles neutres et leurs valeurs sombres proviennent de `preview-theme.tsx`,
sous les noms `--mf-*` ; aucune deuxième palette `--p-*` ne subsiste.
Les valeurs de marque marine/émeraude restent inchangées. Le thème adapte les
surfaces et textes des utilitaires existants sous `[data-mf-app]`, sans changer
les pages métier ni la couleur de fond des boutons de marque.

Clair/Sombre/Système reprend le store local du prototype. `mf-appearance` conserve
le choix, avec reprise de `mf-preview-appearance` si aucune préférence applicative
n'existe. Un script synchrone dans le head pose `data-mf-theme` avant affichage ;
le mode Système suit ensuite l'OS. Stockage refusé : fonctionnement en mémoire.
Aucune requête, variable d'environnement, préférence serveur ou authentification
n'est concernée. Les pages publiques restent hors de la portée des styles sombres.
