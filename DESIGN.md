---
name: Atlas du terrorisme
description: Atlas thématique de la Global Terrorism Database, une planche numérotée par question.
colors:
  ink: "#1d1d1b"
  ink-pressed: "#000000"
  ink-secondary: "#4d4c48"
  ink-muted: "#5f5e5a"
  paper: "#ffffff"
  wash: "#f6f6f3"
  accent-soft: "#f1f1ee"
  rule: "#d6d5cf"
  hairline: "#e2e1dc"
  strong-line: "#c9c8c1"
  sea: "#f3f5f7"
  graticule: "#e3e7eb"
  land: "#e8e7e2"
  land-receded: "#ecebe6"
  land-explored: "#fbfbf9"
  focus: "#0072b2"
  warning-bg: "#fdf3dc"
  warning-line: "#e6c36a"
  delta-worse: "#9b2c12"
  delta-better: "#1f6b3a"
  data-blue: "#1f5f99"
  data-blue-soft: "#eaf1f8"
  data-point: "#2f6496"
  data-zero: "#efeeea"
  data-nodata-stroke: "#8c8c86"
  data-other: "#8a8983"
  data-identity-1: "#009E73"
  data-identity-2: "#D55E00"
  data-identity-3: "#CC79A7"
  data-identity-4: "#E69F00"
  data-attack-bombing: "#0072B2"
typography:
  display:
    fontFamily: "'Libre Franklin Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "clamp(40px, 3.9vw, 60px)"
    fontWeight: 780
    lineHeight: 1.02
    letterSpacing: "-0.025em"
    fontFeature: "tnum"
  headline:
    fontFamily: "'Libre Franklin Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "28px"
    fontWeight: 720
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  numeral:
    fontFamily: "'Libre Franklin Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "40px"
    fontWeight: 260
    lineHeight: 0.9
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  title:
    fontFamily: "'Libre Franklin Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "24px"
    fontWeight: 760
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  title-question:
    fontFamily: "'Libre Franklin Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "22px"
    fontWeight: 720
    lineHeight: 1.2
  title-panel:
    fontFamily: "'Libre Franklin Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  figure:
    fontFamily: "'Libre Franklin Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.25
    fontFeature: "tnum"
  lede:
    fontFamily: "'Libre Franklin Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "'Libre Franklin Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  body-view:
    fontFamily: "'Libre Franklin Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "tnum"
  label:
    fontFamily: "'Libre Franklin Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
  caption:
    fontFamily: "'Libre Franklin Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  none: "0px"
  sm: "2px"
  full: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  gutter: "48px"
  gutter-mobile: "16px"
  masthead: "84px"
  masthead-mobile: "64px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "0 18px 0 20px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.ink-pressed}"
    textColor: "{colors.paper}"
  button-play:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "0 18px 0 14px"
    height: "44px"
  button-tool:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "5px 12px 5px 10px"
    height: "36px"
  button-tool-active:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.ink}"
  segmented-option:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.sm}"
    padding: "6px 11px"
    height: "34px"
  segmented-option-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  chip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "3px 9px"
    typography: "{typography.caption}"
  input-search:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "40px"
  folio:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 14px"
    height: "44px"
  frame-plate:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "20px 24px 24px"
  frame-planche:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "14px 20px 10px"
  cartouche:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.none}"
    padding: "12px 16px"
    width: "296px"
  toc-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "10px 8px 10px 0"
  toc-row-hover:
    backgroundColor: "{colors.wash}"
  tooltip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  banner-warning:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
---

# Design System: Atlas du terrorisme

## Overview

**Creative North Star: "La planche d'atlas imprimé"**

Le site se lit comme un atlas thématique relié : une page de garde, puis une planche numérotée par vue, chacune titrée par sa question (1 Où ? 2 Qui ? 3 Comment ? 4 Quoi ?), avec sa carte, sa légende en cartouche et sa ligne de source. Le papier est blanc, l'encre presque noire, la terre gris clair. Tout ce qui structure la page est un filet d'encre d'un pixel ; rien ne flotte, rien n'est arrondi au-delà de 2 px, rien ne porte d'ombre portée.

La couleur appartient aux données. La rampe bleue de magnitude et les quatre identités Okabe–Ito non bleues sont les seuls signaux colorés à l'écran ; l'interface (états actifs, boutons, sélection, bords du globe) porte l'encre. Les seules exceptions chromatiques hors données sont fonctionnelles : le bleu du focus, l'ocre du bandeau d'avertissement, le rouge et le vert des écarts.

Une seule famille, Libre Franklin en variable, fait tout le travail par contraste de graisse : gros folios très légers (260 à 300) contre des questions grasses (720 et plus). La densité est celle d'une planche imprimée : marges de 48 px, filets plutôt que boîtes, chiffres tabulaires partout où l'on compare. Ce monde remplace l'ancien shell (fond gris cassé, en-tête à onglets) : il ne doit pas y revenir.

**Key Characteristics:**
- Papier blanc, encre `#1d1d1b`, filets d'un pixel comme seule structure.
- Cadres de planche et cartouches à filet d'encre, coins droits.
- Une seule famille grotesque, folios légers contre questions grasses.
- Couleur réservée aux données ; états actifs à l'encre.
- Un mouvement signature : la page tourne (fondu de 200 ms).

## Colors

Une encre chaude presque noire sur papier blanc, quelques gris de filet, et la couleur des données héritée telle quelle de `src/core/palette.ts` (fichier gelé).

### Primary
- **Encre d'imprimerie** (ink) : texte courant, titres, filets de cadre, bord du globe (limbe), fond des boutons pleins, des options actives et des puces, soulignement du folio courant, sélection de texte. C'est la seule couleur « d'action » du système.
- **Encre pressée** (ink-pressed) : survol des boutons pleins (« Ouvrir la planche 1 », « Lire »), et rien d'autre.

### Neutral
- **Encre seconde** (ink-secondary) : lede, résumés de la table des planches, valeurs de légende, options non actives.
- **Encre éteinte** (ink-muted) : sources, notes, noms de vue, pied de page, axes.
- **Papier** (paper) : fond de page et fond de tout cadre, cartouche et infobulle.
- **Lavis** (wash) : survol d'une ligne de la table des planches, fond des encadrés du panneau (pays survolé, résumé d'incident), état ouvert d'un bouton outil.
- **Lavis de ligne active** (accent-soft) : ligne active du tableau des chiffres.
- **Filet** (rule) : séparateurs entre lignes de la table des planches, sous la tête de planche, au-dessus de la source et de la mise en garde.
- **Filet fin** (hairline) : séparateurs internes de la vue carte (panneau, frise, lignes de tableau), bords des boutons discrets.
- **Filet appuyé** (strong-line) : bords des champs, contrôles segmentés, boutons outils, cadre des pastilles de légende ; couleur de la barre de défilement.

### Monde du globe
- **Mer plate** (sea) : sphère du globe, sans éclairage, sur la couverture comme dans la vue.
- **Graticule** (graticule) : quadrillage de 10°, trait de 0,6.
- **Terre** (land), **terre en retrait** (land-receded), **terre explorée** (land-explored) : terre neutre sous la couche d'incidents, contexte qui recule au niveau pays, pays exploré.

### Fonctionnelles
- **Bleu de focus** (focus) : anneau de focus clavier uniquement.
- **Bandeau d'avertissement** (warning-bg, warning-line) : bandeau « Extrait de test » dans l'en-tête.
- **Écart défavorable / favorable** (delta-worse, delta-better) : texte des variations dans le panneau, messages d'erreur de la vue, bouton « Partager » confirmé.

### Données (héritées, D19 à D22)
- **Rampe de magnitude** : `d3.interpolateBlues` de 0,25 à 1, monotone en clarté ; choroplèthe, hexagones, cartouche.
- **Bleu des données** (data-blue, data-blue-soft) : barres de la frise dans la période, fenêtre des courbes ; c'est la rampe hors du globe.
- **Point de base** (data-point) : incidents des pays non sélectionnés.
- **Zéro** (data-zero) et **pas de donnée** (hachures de data-nodata-stroke sur blanc) : deux encodages distincts, jamais confondus.
- **Identités** (data-identity-1 à 4) : vert bleuté, vermillon, pourpre, orangé, dans cet ordre fixe, toujours accompagnés du nom.
- **Types d'attaque** : les cinq couleurs Okabe–Ito de `ATTACK_TYPE_COLORS` (dont data-attack-bombing), les autres en data-other.

### Named Rules
**The Encre pour l'interface Rule.** Tout état d'interface (actif, pressé, sélectionné, courant) se dit à l'encre, plein ou souligné. Une couleur de série ne colore jamais un texte ni un contrôle.

**The Couleur aux données Rule.** La rampe bleue et les identités ne servent qu'à encoder des données. Hors données, seuls le focus, l'avertissement et les écarts ont droit à une teinte.

## Typography

**Display Font:** Libre Franklin Variable (avec system-ui, -apple-system, Segoe UI, sans-serif)
**Body Font:** la même
**Label/Mono Font:** la même ; seule exception, les touches clavier de l'aide (`ui-monospace`, Cascadia Mono, Consolas)

**Character:** une grotesque américaine sobre, travaillée en variable sur toute l'étendue des graisses : le chiffre de folio presque filiforme répond à une question très grasse, comme sur une planche d'atlas. Le canevas du globe utilise la même famille.

### Hierarchy
- **Display** (780, clamp(40px, 3.9vw, 60px), 1,02, chiffres tabulaires) : le titre chiffré de la page de garde, « 181 691 attentats en 48 ans ».
- **Numeral** (260, 40px, 0,9) : numéros de la table des planches ; le numéro de planche prend 1,6 em du titre à la même graisse, le folio de l'en-tête 24px en 300.
- **Headline** (720, 28px, 1,15, −0,015 em ; 22px sous 720 px) : titre-question de chaque planche.
- **Title** (760, 24px, 1,15 ; 20px sous 720 px) : titre de l'atlas dans l'en-tête.
- **Title question** (720, 22px, 1,2) : question dans la table des planches. **Title panel** (650, 24px, 1,2) : titre du panneau de la vue carte.
- **Figure** (600, 19px, 1,25, tabulaires) : valeurs chiffrées du panneau.
- **Lede** (400, 18px, 1,5 ; 17px sur téléphone ; 34 em au plus) : la phrase de la page de garde, chiffres clés en 680 à l'encre.
- **Body** (400, 16px, 1,5) : texte du shell. **Body view** (400, 14px, 1,4, tabulaires) : base de la vue carte.
- **Label** (13px) et **Caption** (12px) : cartouche, sources, notes, pied de page, contrôles.

### Named Rules
**The Folio léger, question grasse Rule.** Un numéro de planche est toujours en graisse 260 à 300, sa question en 640 à 720. Le contraste de graisse, pas la couleur ni la taille seule, fait la hiérarchie.

**The Typographie française Rule.** Tout texte posé par le shell passe par `fr()` : apostrophe courbe, espace fine insécable avant ? ! ; et insécable avant :. La citation anglaise de la GTD est posée telle quelle.

**The Chiffres alignés Rule.** Partout où l'on compare des nombres (titres chiffrés, folios, légendes, tableaux, frise), les chiffres sont tabulaires.

## Layout

La page est une feuille : un en-tête de 84 px (64 px sur téléphone) fermé par un filet d'encre, puis la page de garde ou une planche, puis le pied de page (colophon) ouvert par un filet d'encre. Les marges latérales valent 48 px (16 px sous 720 px).

La page de garde est une grille 62 / 38 : à gauche le cadre de la planche 1 (hauteur définie, entre 560 et 780 px, pour que le globe tienne dans le cadre), à droite le titre chiffré, la phrase, le bouton, la table des planches, et la mise en garde calée en bas ; gouttière de 48 px. Sous 1100 px, une seule colonne : intro, planche, table, mise en garde.

Chaque vue vit dans un cadre de planche à filet d'encre (14 / 20 / 10 px de marge intérieure) : tête de planche (numéro et question à gauche, nom de la vue à droite) séparée par un filet, corps, puis ligne de source au-dessus d'un filet. La vue carte prend la hauteur restante (`--shell-chrome`, 256 px réservés) : globe et panneau de 372 px (500 px en comparaison), frise en dessous ; sous 980 px, tout s'empile.

Sous 720 px, les quatre folios deviennent une bande de quatre colonnes égales sur toute la largeur, numéro au-dessus de la question, et le cartouche passe sous la carte au lieu de la couvrir.

Rythme : pas de 4 px, avec 8, 12, 16, 24, 32 et 48 px comme paliers récurrents. Cibles d'interaction de 44 px au moins pour les folios, le bouton Lire et les métriques.

### Named Rules
**The Une feuille Rule.** La page de garde tient sur un écran de 1440 × 900 : planche 1, chiffres et table des planches ensemble.

## Elevation & Depth

Le système est plat. Aucune ombre portée, aucun flou, aucun éclairage du globe (`--cv-shadow: none`). La profondeur se dit par le filet (encre pour un cadre, gris pour une séparation), par un lavis très clair pour un encadré, et par la superposition franche d'un cartouche à fond papier sur la carte. Le bas du panneau défilant s'estompe par un masque de 36 px au lieu de couper une ligne.

L'ombre CSS sert seulement d'outil de trait, jamais d'élévation : le soulignement du folio est une ombre intérieure (`inset 0 -1px` au survol, `inset 0 -3px` pour la planche courante), et le point de légende porte un anneau de 1 px.

### Named Rules
**The Pas d'ombre Rule.** Rien ne s'élève au-dessus du papier. Un panneau flottant (filtres, aide, infobulle) se détache par un filet d'encre, pas par une ombre.

## Shapes

Coins droits pour tout ce qui encadre (cadre de planche, cartouche, légende de la vue, panneau, frise) ; 2 px au plus pour les contrôles (boutons, champs, segments, puces, infobulle, bandeau). Les seuls cercles sont des données ou le monde : le globe et sa silhouette de chargement, les points d'incident, les pastilles d'identité. Filets d'un pixel ; 1,5 px pour la fenêtre de période et le pointillé des planches en préparation ; 3 px pour le folio courant. Les icônes sont des SVG maison sur une grille de 24, trait 1,8, extrémités carrées.

### Named Rules
**The Deux pixels Rule.** Aucun coin arrondi au-delà de 2 px, sauf un cercle qui est une donnée ou le globe.

## Components

### Buttons
- **Shape :** coins à peine adoucis (2 px).
- **Primaire :** plein d'encre, texte papier, 48 px de haut, 17px en 620, flèche SVG à droite. Survol : encre pressée et flèche qui avance de 3 px ; appui : descend de 1 px. « Lire » suit la même forme en 44 px.
- **Outil :** fond papier, filet appuyé, 36 px, icône et mot (« Filtres », « Partager ») ; survol : filet d'encre ; ouvert ou actif : filet d'encre et lavis ; confirmé : vert d'écart.
- **Discret :** préréglages de période et bouton « Monde » en filet fin ; lien-bouton souligné à l'encre.

### Chips
- **Style :** puce pleine d'encre, texte papier, 12px, coupée par une ellipse.
- **État :** l'option active d'un préréglage ou d'un sélecteur de légende passe elle aussi au plein d'encre.

### Cards / Containers
- **Cadre de planche :** coins droits, filet d'encre d'un pixel, fond papier, 20 / 24 px (page de garde) ou 14 / 20 px (vue).
- **Cartouche :** coins droits, filet d'encre, fond papier, 296 px sur la page de garde ; titre en 680, rampe de 12 px, graduations à tiret d'encre, clés « aucun attentat » et « pas de donnée ».
- **Encadrés internes :** lavis sans filet, 2 px (pays survolé, résumé d'incident).
- **Ombres :** aucune (voir Elevation & Depth).

### Inputs / Fields
- **Style :** filet appuyé, fond papier, 2 px, 40 px de haut (recherche) ou 34 px (organisation, comparaison).
- **Focus :** anneau de focus commun (2 px plein, bleu de focus, décalé de 3 px dans le shell, 2 px dans la vue ; à l'intérieur, à −2 px, pour les éléments pleine largeur comme les folios, les lignes de table et le globe).
- **Cases :** `accent-color` à l'encre.

### Navigation
- **Folios :** dans l'en-tête, à droite du titre ; numéro 24px en 300, question 18px en 640. Survol : filet d'encre d'un pixel sous le folio ; courant : filet de 3 px posé sur le filet de l'en-tête. Planche en préparation : question en encre seconde, soulignée d'un pointillé de 1,5 px. Sur téléphone : bande de quatre colonnes, 56 px de haut.
- **Table des planches :** lignes séparées par des filets, numéro de 40 px à gauche, question, nom de la vue, mention « en préparation » soulignée en pointillé, puis le résumé. Survol : lavis et question soulignée.

### Contrôles segmentés
Cadre en filet appuyé à 2 px de marge intérieure ; option active pleine d'encre en 600, options inactives en encre seconde qui passent à l'encre au survol.

### Frise du temps
Barres de 40 px, gris neutre hors période, bleu des données dans la période, encre au survol ; années manquantes hachurées ; fenêtre de période cernée d'un filet d'encre de 1,5 px ; changements de méthode en tirets éteints ; poignées d'encre de 6 px.

### Planche en préparation
Mention « en préparation » en pointillé dans la tête de planche, titre en 680, liste des tâches promises entre un filet d'encre et des filets gris (identifiant en 300, libellé en 640, exemple entre guillemets français), et l'état brut de l'application replié dans un `details`.

### Mouvement
- **Tourner la page :** fondu d'opacité de 200 ms, ease-out, à chaque changement de page ou de planche.
- **États :** 150 à 160 ms ease-out (fond, couleur, filet).
- **Vue carte (D22) :** contenu du panneau et panneau de filtres qui montent de 6 px en 180 à 200 ms, fenêtre de lecture qui glisse en 300 ms, barres qui changent de hauteur en 200 ms, tous en `cubic-bezier(0.25, 1, 0.5, 1)` ; silhouette du globe qui respire pendant le chargement.
- `prefers-reduced-motion` coupe toutes ces transitions et animations.

## Do's and Don'ts

### Do:
- **Do** encadrer chaque vue d'un filet d'encre d'un pixel avec, dans l'ordre, numéro et question, nom de la vue, corps, ligne de source.
- **Do** poser toute légende de carte dans un cartouche à coins droits, filet d'encre et fond papier.
- **Do** dire un état actif à l'encre : plein (`#1d1d1b`, texte blanc) ou filet de 3 px.
- **Do** composer les numéros de planche en 260 à 300 et les questions en 640 à 720, chiffres tabulaires.
- **Do** passer tout texte du shell par `fr()` et garder la citation GTD en anglais, telle quelle, en pied de page.
- **Do** distinguer « zéro » (aplat clair) et « pas de donnée » (hachures) sur toute carte et toute légende.
- **Do** couper toute transition et animation sous `prefers-reduced-motion`.

### Don't:
- **Don't** revenir à un en-tête à onglets posé sur un tableau de bord de cartes arrondies, ni au fond gris cassé de l'ancien shell.
- **Don't** utiliser d'ombre portée ou de flou pour détacher un élément ; une ombre intérieure ne sert qu'à tracer un filet.
- **Don't** arrondir un cadre ou un contrôle au-delà de 2 px.
- **Don't** colorer un texte, un bouton ou un état d'interface avec une couleur de série ou la rampe bleue.
- **Don't** introduire une deuxième famille de caractères, ni pour les titres ni sur le canevas.
- **Don't** modifier la palette des données ici : elle vit dans `src/core/palette.ts`, gelé.
