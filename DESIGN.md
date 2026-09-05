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
`components/preview/preview-primitives.tsx`. Le shell de prévisualisation
n'est pas restauré dans l'application.
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
les cartes des autres modules, la sidebar, le header, les préférences de thème,
les permissions, les requêtes ou les helpers métier.

## Contrat de présentation

`app/(app)/direction/page.tsx` conserve les accès et calculs actuels.
`DirectionDashboard` reçoit leurs résultats ; les primitives sont des composants
serveur sans accès aux données. Le prototype fournit uniquement le langage visuel.
Le parcours reste une consultation et la navigation utilise les routes existantes.
