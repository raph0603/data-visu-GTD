# Product

## Register

product

## Users

Les quatre profils de `src/core/tasks.ts` :

- **U1, journalistes de données** : préparent un article, ont peu de temps, veulent des tendances, des chiffres clés et des incidents à citer.
- **U2, étudiants et chercheurs** : explorent longtemps un conflit, un groupe ou une période.
- **U3, analystes d'ONG et d'institutions** : évaluent une zone d'intervention, veulent une synthèse.
- **U4, public curieux** : découvre le sujet, sans formation.

La vue « Carte par pays » sert d'abord U4 et U1 : comprendre en dix secondes où et quand le terrorisme a frappé. La profondeur (pays, incidents, comparaison) reste accessible à la demande pour U2 et U3. Elle est aussi présentée en soutenance, au vidéoprojecteur.

## Product Purpose

Application web statique qui rend explorable la Global Terrorism Database (181 691 attentats, 1970 à 2017, sauf 1993). Quatre vues partagent un état et une palette ; chacune est présentée seule par un étudiant puis fusionnée dans la même application.

Réussite : un visiteur qui n'a jamais vu l'outil lance la lecture, voit le terrorisme se déplacer d'une région à l'autre, plonge dans un pays et en ressort avec un chiffre juste et un incident précis, sans avoir lu de mode d'emploi.

## Brand Personality

Sobre, précis, grave. Le sujet, ce sont des morts : la vue informe, elle ne met pas en scène. Le ton est celui d'une infographie de presse sérieuse, pas d'un écran de surveillance.

## Anti-references

- L'écran de surveillance : fond noir, rouge sang, points qui pulsent ou explosent.
- Le tableau de bord en cartes identiques, où dix panneaux ont le même poids (la version D18 de cette vue).
- Le globe décoratif de page d'accueil, qui tourne sans rien dire.

## Design Principles

1. **La carte d'abord.** La donnée est la surface principale ; l'interface s'efface autour.
2. **Un niveau, une question.** Monde : où et quand. Pays : combien et qui. Incident : que s'est-il passé.
3. **Zéro mesuré n'est pas « pas de donnée ».** Les deux restent visibles et distincts partout (1993, morts inconnus).
4. **Gravité sans spectacle.** Le mouvement sert à s'orienter, jamais à impressionner.
5. **Jamais la couleur seule.** Chaque valeur se lit aussi en texte : infobulle, étiquette, panneau.

## Accessibility & Inclusion

- WCAG 2.2 AA : contraste du texte, navigation au clavier (tourner, zoomer, remonter d'un niveau).
- Daltonisme : rampe séquentielle à une teinte, catégories Okabe–Ito validées (D18), noms toujours à côté des couleurs.
- `prefers-reduced-motion` : pas de rotation automatique, déplacements remplacés par des coupes.
- Lisible projeté dans une salle éclairée.
