---
version: 1
slug: "src-shell-main-ts"
primary_target: "src/shell/main.ts"
related_targets: ["src/shell/style.css","src/modules/map/map.css"]
---

# Surface brief : le site (shell) et l'habillage des vues

Scope : en-tête, navigation, page de garde, cadre « planche » des quatre vues, vues en préparation, pied de page ; habillage de la vue « Carte par pays » (panneau, barre, boutons) aligné sur le même monde. Mode : Experience (le travail mène dès le premier écran).

Audience : U1 à U4 (PRODUCT.md), soutenance au vidéoprojecteur. Tâche : comprendre le sujet en dix secondes, choisir une planche par sa question, retrouver la même grammaire dans chacune. Contraintes épinglées par Alban : sobre, couleurs claires, fond blanc ; ni « site vitrine » ni « tableau de bord ». Palette des données inchangée (D19 à D22) ; citation GTD obligatoire.

Moment mémorable : la page de garde, où la planche 1 (le globe de la carte) et la table des planches tiennent ensemble sur une seule feuille.

## Direction contract

THESIS : le site est un atlas thématique. Chaque vue est une planche numérotée qui pose sa question (1 Où ? 2 Qui ? 3 Comment ? 4 Quoi ?), avec sa carte, sa légende en cartouche et sa source. Il refuse l'en-tête à onglets posé sur un tableau de bord de cartes arrondies.

OWN-WORLD : papier blanc, encre presque noire, terre gris clair ; filets d'encre d'un pixel, aucun coin arrondi au-delà de 2 px, aucune ombre. Une seule famille grotesque (Libre Franklin), forts contrastes de graisse ; folios en gros chiffres. Cadres de planche à filet fin, cartouches de légende encadrés, table des planches en lignes séparées par des filets. La couleur est réservée aux données (rampe bleue, identités Okabe–Ito sans bleu).

STORY : le visiteur comprend qu'il ouvre un atlas de 181 691 attentats en quatre planches, voit la planche 1 sous forme de carte qui dit quelque chose, lit trois chiffres sourcés, choisit une planche par sa question et y retrouve titre-question, cartouche et source.

FIRST VIEWPORT : en-tête de 84 px fermé par un filet d'encre ; titre de l'atlas à gauche, folios « 1 Où ? · 2 Qui ? · 3 Comment ? · 4 Quoi ? » à droite, le courant souligné d'un filet épais, les planches en préparation en pointillés. Dessous, à gauche (environ 62 %), le cadre « Planche 1 · Où frappe le terrorisme ? » avec le globe de la choroplèthe et son cartouche de légende ; à droite, « 181 691 attentats en 48 ans », une phrase, trois chiffres sourcés, puis la table des planches. Action principale : « Ouvrir la planche 1 », et un clic sur le globe.

FORM : atlas thématique, troisième de mes candidats après la signalétique et la fiche de situation, choisi par Alban dans le tour « plus sûr ». seed:9c3c811cf2290d63

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Signature : tourner les planches. Changer de vue est un changement de feuille (fondu de 200 ms, rien pour qui réduit les animations) ; le bouton Retour revient à la planche précédente, puis à la page de garde.

## Décisions ouvertes

- Les questions des planches 2 à 4 (Qui ? Comment ? Quoi ?) sont à confirmer avec les autres membres de l'équipe.
