# Méthode : faire une bonne interface de visualisation

Une fiche à garder (et à citer dans le rapport). Chaque règle dit **pourquoi**, puis
**comment le vérifier**, avec l'endroit où la vue « Carte par pays » l'applique.

---

## 0. Partir des tâches, pas du décor

- Chaque élément de l'écran sert une tâche de l'utilisateur (T1 à T12 dans `src/core/tasks.ts`).
  S'il n'en sert aucune, on le retire. C'est ainsi que les dix panneaux de D18 sont devenus le
  globe de D19.
- La taille et le contraste suivent l'importance : ce qui sert la tâche principale domine (le
  globe), le reste est secondaire (panneau, barre du bas).
- **Vérifier** : le test des cinq secondes. On montre l'écran à quelqu'un pendant cinq secondes et
  on lui demande ce qu'il a compris. S'il ne sait pas où regarder, la hiérarchie est ratée.

## 1. La couleur

**La procédure, dans l'ordre :**

1. **Donner un rôle à chaque couleur**, avant d'en choisir aucune.

   | Rôle | Palette | Exemple dans la vue |
   |---|---|---|
   | Grandeur (combien) | séquentielle : une teinte, du clair au foncé, régulière en luminosité | le bleu du globe et des hexagones |
   | Polarité (au-dessus / en dessous) | divergente : deux teintes et un gris neutre au milieu | non utilisée |
   | Identité (lequel) | catégorielle : teintes bien distinctes, ordre fixe, 6 à 8 au plus | les 4 pays, les 5 types d'attaque |
   | État (alerte, hausse) | réservée, toujours avec un mot ou une icône | ↑ en rouge brique, ↓ en vert |

2. **Partir d'une palette éprouvée** plutôt que d'en inventer une : ColorBrewer (Brewer), Viridis
   ou Cividis pour les grandeurs, Okabe–Ito pour les catégories (conçue pour le daltonisme). Le
   projet utilise Blues et Okabe–Ito (`src/core/palette.ts`).

3. **Vérifier par le calcul, pas à l'œil** :
   - contraste du texte d'au moins 4,5:1, et de 3:1 pour les éléments graphiques (WCAG 2.2 AA) ;
   - séparation des catégories sous daltonisme : simulateur de Chrome DevTools (*Rendering ›
     Emulate vision deficiencies*) ou le validateur de la skill dataviz utilisé pour D20 et D21.

4. **Les règles qui évitent les erreurs classiques** :
   - jamais d'arc-en-ciel pour une grandeur : sa luminosité n'est pas monotone, donc l'œil y voit
     des frontières qui n'existent pas ;
   - la couleur suit l'entité, pas son rang : retirer un pays ne recolore pas les autres ;
   - le texte reste en encre neutre ; une pastille colorée l'accompagne ;
   - jamais la couleur seule : toujours un nom, un motif ou une forme en plus ;
   - zéro et « pas de donnée » sont deux choses : gris clair contre hachures.

5. **L'interface reste en gris neutres, avec un seul accent.** La couleur forte est réservée aux
   données ; sinon, les boutons concurrencent la carte.

**Exercice** : passe une capture d'écran en niveaux de gris. Si la hiérarchie ne se lit plus,
c'est que la luminosité est mal utilisée, et non la teinte.

## 2. La typographie et la mise en page

- **Une seule famille de police** suffit en interface (ici `system-ui`). La hiérarchie vient de la
  taille et de la graisse, avec un rapport d'environ 1,2 entre deux niveaux (12, 14, 17, 20, 24 px).
- **Chiffres tabulaires** dans les tableaux (`font-variant-numeric: tabular-nums`), pour que les
  colonnes s'alignent.
- **Espacements sur une grille** de 4 ou 8 px. On rapproche ce qui va ensemble et on écarte le reste
  (loi de proximité de la Gestalt) ; on aligne sur peu d'axes.
- **Éviter** les cartes identiques partout et les bordures en trop : ce sont elles qui donnent l'air
  « tableau de bord générique ».
- **Textes** : un bouton dit ce qu'il fait, avec un verbe et un objet (« Tout désélectionner »).
  L'unité est toujours écrite (« 1 297 morts par million d'habitants »).

## 3. Les boutons et les contrôles

- **Utiliser les contrôles natifs** (`button`, `select`, `input type=range`, `checkbox`) : le
  clavier et les lecteurs d'écran fonctionnent sans effort.
- **Choisir le bon contrôle** :

  | Besoin | Contrôle |
  |---|---|
  | Un choix parmi 2 à 5 options | boutons segmentés (Mesure, Attentats-suicides) |
  | Activer ou désactiver | case à cocher (par million d'habitants) |
  | Un choix parmi des centaines | champ avec recherche (Organisation, pays) |
  | Une plage de valeurs | brossage sur un histogramme, curseur double au clavier (période) |

- **Ressembler à un bouton** : fond ou bordure, curseur en main, cible d'au moins 24 × 24 px
  (WCAG 2.2), 44 px pour le tactile.
- **Prévoir tous les états** : repos, survol, focus clavier visible, actif, sélectionné
  (`aria-pressed`, `aria-checked`), désactivé (avec la raison en infobulle), chargement.
- **Trois lois utiles** :
  - Fitts : une cible grande et proche se vise plus vite ;
  - Hick : plus il y a d'options visibles, plus la décision est lente, d'où les réglages rares
    repliés ;
  - Jakob : l'utilisateur attend ce qu'il connaît déjà ailleurs (molette pour zoomer, Échap pour
    fermer).
- **Retour immédiat et retour arrière** : réponse en moins de 100 ms, toute action s'annule (×,
  Échap), et l'état est dans l'URL pour pouvoir le partager.

## 4. Les animations

- **Une question avant chaque animation : quel changement aide-t-elle à suivre ?** Un objet qui se
  déplace, le passage d'un état à un autre, l'orientation (le vol vers un pays). Si la réponse est
  « aucun », on n'anime pas.
- **Durées** :
  - 100 à 200 ms pour une micro-interaction (survol, bouton) ;
  - 200 à 400 ms pour une transition de vue ;
  - 0,6 à 1,5 s pour un déplacement de caméra, selon la distance (ici 0,45 à 1,7 s).
- **Courbes** : *ease-out* (rapide puis doux) pour ce qui répond à un geste. Pas de rebond ni
  d'élastique dans une interface de données.
- **Fluidité** : animer `transform` et `opacity` plutôt que `width`, `height` ou `top`, qui forcent
  un recalcul de la mise en page. 60 images par seconde laissent 16 ms par image, à mesurer dans
  l'onglet *Performance* de DevTools.
- **Transitions de données** : interpoler les valeurs (la couleur d'un pays d'une année à l'autre)
  pour que l'œil suive le même objet (Heer et Robertson 2007, *Animated Transitions in Statistical
  Data Graphics*).
- **Une animation n'est pas une analyse** (Robertson et coll. 2008) : il faut toujours une version
  statique, comme la frise et les petits multiples.
- **`prefers-reduced-motion` est obligatoire** : sans rotation automatique, et avec des coupes à la
  place des déplacements.

## 5. Les interactions

- **Vue d'ensemble, zoom et filtres, puis détail à la demande** (Shneiderman 1996).
- **L'infobulle complète, elle ne remplace pas** : au toucher, il n'y a pas de survol, donc chaque
  valeur doit aussi se lire dans le panneau ou un tableau.
- **Liaison entre les vues** (*brushing and linking*) : ce qu'on survole ou sélectionne à un endroit
  s'allume ailleurs, par exemple un pays survolé sur le globe dans le panneau.
- **Découvrabilité** : une aide au premier usage, qui disparaît ensuite (« Glissez pour tourner… »).
  Un geste caché, comme Maj+clic, doit être doublé d'un bouton visible.
- **Clavier** : tout ce qui se fait à la souris doit se faire au clavier.

## 6. Vérifier avant de rendre

- **Test utilisateur rapide** : 3 à 5 personnes, de vraies tâches (« trouve le pays le plus touché
  en 2014 »). On observe sans aider et on note où elles hésitent. Selon Nielsen, cinq personnes
  suffisent à trouver la plupart des problèmes.
- **Grille d'évaluation** : les 10 heuristiques de Nielsen (état visible du système, contrôle et
  retour arrière, cohérence, prévention des erreurs, etc.).
- **Outils** :
  - Lighthouse ou axe pour l'accessibilité ;
  - DevTools pour le daltonisme et la performance ;
  - une capture en niveaux de gris ;
  - un affichage à 200 % de zoom ;
  - un parcours au clavier seul.

---

## Références

- T. Munzner, *Visualization Analysis and Design*, CRC Press, 2014.
- C. Ware, *Information Visualization: Perception for Design*, Morgan Kaufmann.
- C. Brewer, ColorBrewer ; M. Okabe et K. Ito, *Color Universal Design* (palette Okabe–Ito).
- J. Heer et G. Robertson, « Animated Transitions in Statistical Data Graphics », *IEEE TVCG*, 2007.
- G. Robertson et coll., « Effectiveness of Animation in Trend Visualization », *IEEE TVCG*, 2008.
- B. Shneiderman, « The Eyes Have It », IEEE Symposium on Visual Languages, 1996.
- J. Nielsen, *10 Usability Heuristics for User Interface Design*, 1994.
- W3C, *Web Content Accessibility Guidelines (WCAG) 2.2*.
