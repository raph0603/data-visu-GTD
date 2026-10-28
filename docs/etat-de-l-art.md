# État de l'art : quoi représenter, et comment, pour l'atlas et la comparaison de pays

Recherche faite le 28 octobre 2026 pour la vue « Carte par pays » (globe, D19 et D20).
Chaque section donne ce que disent les études, puis ce qu'on en tire pour la vue, et
dit si c'est fait ou non.

> **Limite** : la plupart des études ont été lues sous forme de résumés ou par des sources
> secondaires. Les chiffres cités doivent être vérifiés dans les textes complets avant
> d'être repris dans le rapport.

---

## 1. Le terrorisme se concentre en quelques lieux, et sous l'échelle du pays

**Études**

- LaFree, Morris et Dugan (2006) se demandent si les attentats se concentrent dans un petit nombre de
  « points chauds » nationaux, et si cette concentration dure dans le temps. Ils répartissent les
  pays en quatre trajectoires. Leur cadre vient de la criminologie, où les crimes se concentrent bien
  plus dans des lieux que chez des individus.
- Python, Illian, Jones-Todd et Blangiardo (2019) modélisent la dynamique **infranationale** du
  terrorisme entre 2010 et 2016. Selon eux, les travaux antérieurs ne captaient pas systématiquement
  ces motifs à l'intérieur des pays.
- Une étude publiée en 2019 dans le *Journal of Quantitative Criminology* descend jusqu'au tronçon de
  rue, et observe des points chauds stables.

**Ce qu'on en tire**

Une carte par pays cache l'essentiel, c'est-à-dire *où* dans le pays. Elle subit aussi le problème de
l'unité spatiale modifiable : le motif dépend du découpage choisi. Il faut donc montrer les attentats
à leur position, dès le niveau monde, sans exiger de sélectionner un pays.

**Fait (D20)** : le calque « Attentats » est le calque par défaut. Les 181 691 incidents y apparaissent
en hexagones de densité, qui deviennent des points en zoomant.

## 2. Une densité de points se lit mieux en hexagones

**Études**

- Carr et coll. (1987) ont proposé le regroupement hexagonal contre la superposition des points dans
  les nuages très denses ; la transparence seule ne suffit plus au-delà d'un certain nombre de points.
- Les points d'un hexagone sont en moyenne plus proches de son centre que ceux d'un carré de même
  aire. Le regroupement se fait en un seul passage sur les données.
- La limite connue : on perd la position exacte de chaque point.

**Ce qu'on en tire**

La GTD place la plupart des incidents au centre de leur ville. Des milliers de points se superposent
au même endroit (Bagdad : plusieurs milliers d'incidents), et un nuage de points ferait croire à
« un point ». Les hexagones rendent la densité ; les points reviennent quand on zoome assez pour les
séparer (détail à la demande, section 9).

**Fait** :
- les hexagones gardent la même taille à l'écran à tout zoom, et la légende donne leur taille en km ;
- ils cèdent la place aux points sous environ 1 500 incidents visibles ou sous 5 km par hexagone ;
- la taille des points suit le nombre de morts.

## 3. Une choroplèthe de comptages favorise les grands pays

**Études**

La cartographie thématique pose une règle constante : on lit une choroplèthe comme une intensité, pas
comme un total, donc elle doit représenter un **taux**. Pour des totaux, on recommande des symboles
proportionnels. Slocum et coll. (2009), cité par une source secondaire, notent que les lecteurs
lisent les valeurs d'une choroplèthe comme des probabilités. Gimond (« Pitfalls to avoid ») et des
guides de cartographie le répètent.

**Ce qu'on en tire**

Colorer les pays selon le nombre d'incidents fait paraître la Russie ou le Brésil plus touchés qu'un
petit pays qui l'est davantage. La GTD ne contient pas de population, donc on ne peut pas calculer de
taux par habitant sans données externes (Banque mondiale), avec leur licence et leur prétraitement.

**Fait** : la choroplèthe n'est plus le calque par défaut. Le calque « Pays » reste disponible pour
classer les pays (T1), en échelle logarithmique, et le rang chiffré figure dans l'infobulle et le
panneau.

**À faire** : ajouter une mesure « par million d'habitants », ou remplacer la choroplèthe par des
cercles proportionnels au centre de chaque pays.

## 4. Les morts pèsent plus que les incidents

**Études**

Le Global Terrorism Index (Institute for Economics and Peace) combine plusieurs indicateurs avec des
poids différents :

| Indicateur | Poids |
|---|---|
| Incident | 1 |
| Mort | 3 |
| Blessé | 0,5 |
| Otages ou dégâts matériels | selon les sources |

Les scores sont pondérés sur cinq ans, puis convertis en une échelle logarithmique de 0 à 10. Les
sources secondaires ne s'accordent pas sur le quatrième indicateur.

**Ce qu'on en tire**

Aucune mesure unique ne suffit. Beaucoup d'attentats avec peu de morts (Irlande du Nord), ce n'est pas
la même chose que peu d'attentats très meurtriers (T4).

**Fait** : quatre mesures au choix, en échelle logarithmique : incidents, morts, blessés et morts par
incident.

**Non fait** : un indice composite de type GTI. Ses poids sont discutés, et les otages comme les
dégâts ne sont pas dans les 17 colonnes retenues.

## 5. La létalité dépend de l'organisation et du mode opératoire

**Études**

- Asal et Rethemeyer (2008, *Journal of Politics*) : la taille de l'organisation, son idéologie
  (religieuse en particulier), son contrôle d'un territoire et ses liens avec d'autres groupes
  prédisent sa létalité. Le soutien d'un État et l'âge du groupe ne la prédisent pas.
- Pape (2005) et Mroszczyk (2019), sur environ 142 000 incidents de la GTD : les attentats-suicides
  sont en moyenne plus meurtriers.
- Alakoc (2017) : les attentats commis par plusieurs auteurs le sont aussi.

**Ce qu'on en tire**

L'organisation est une clé d'entrée aussi importante que le pays (T7).

**Fait (D20)** :
- un filtre « Organisation » avec recherche, qui s'applique au globe, aux chiffres, à la frise et aux
  listes ;
- les organisations du panneau sont cliquables pour filtrer ;
- la frise d'activité 1970–2017 de chaque organisation.

**À faire dans l'atlas** : un filtre attentat-suicide et une couleur des points par type d'attaque
(T6, T8).

## 6. La GTD a changé de méthode de collecte

**Études**

- La collecte a été faite successivement par Pinkerton (1970–1997), le CETIS (1998–2008), l'ISVG
  (2008–2011) puis le START, avec la méthode actuelle en partie automatisée depuis 2012.
- Pape et coll. reprochent à la GTD une méthodologie inconstante, qui expliquerait une partie de la
  hausse récente. La réponse du START : les tendances restent lisibles, à condition de les interpréter
  avec prudence et avec d'autres sources.
- Les données de 1993 sont perdues.

**Ce qu'on en tire**

Une courbe brute laisse croire que toute hausse est réelle.

**Fait (D20)** :
- 1993 est hachurée ;
- deux traits pointillés marquent 1998 et 2012 dans la frise, avec leur explication au survol ;
- le panneau rappelle que les données vont de 1970 à 2017.

## 7. Animer ne suffit pas pour analyser

**Études**

- Robertson et coll. (2008, *IEEE TVCG*) comparent une animation de type Gapminder, des petits
  multiples et des traces superposées. L'animation est la moins efficace pour l'analyse ; les petits
  multiples sont les plus justes. L'animation garde un intérêt pour la présentation.
- Brehmer et coll. (2019), sur téléphone, nuancent : l'animation fait mieux ressortir les retournements
  de trajectoire.

**Ce qu'on en tire**

On garde la lecture animée pour raconter, en soutenance et pour le public. L'analyse doit pouvoir se
faire sans elle.

**Fait** :
- la frise des années reste toujours visible et la période se choisit en glissant dessus ;
- chaque pays sélectionné a sa petite courbe annuelle, toutes sur le même axe du temps ;
- l'échelle de couleur reste fixe pendant la lecture (D19).

## 8. Comparer : juxtaposer, superposer, ou encoder la différence

**Études**

Gleicher et coll. (2011), puis Gleicher (2018), montrent que toute vue de comparaison combine trois
procédés :
- la **juxtaposition** : les vues côte à côte ;
- la **superposition** : les éléments dans un même espace ;
- l'**encodage explicite** de la différence.

L'Yi, Jo et Seo (2021) relèvent, sur 127 articles, que la juxtaposition peut fonctionner là où l'on
croyait la superposition supérieure.

**Ce qu'on en tire**

Pour 2 à 4 pays d'ordres de grandeur très différents (Irak et France), superposer des courbes écrase
les petits pays.

**Fait** :
- **juxtaposition** : un tableau à une colonne par pays, et des petits multiples avec une échelle par
  pays dont le maximum est écrit ;
- **encodage explicite** : l'évolution en % avec flèche ↑↓, le rang actuel et le rang de la période
  comparée ;
- **superposition** : seulement sur le globe, avec les contours de couleur des pays.

**À faire** : un mode « indice base 100 » pour comparer des trajectoires sur une même échelle.

## 9. Vue d'ensemble, zoom et filtre, détail à la demande

**Étude**

Shneiderman (1996, « The Eyes Have It ») résume ainsi la conduite d'une exploration visuelle.

**Ce qu'on en tire, fait** : le zoom suit cet ordre.
- vue d'ensemble : le globe et sa densité ;
- zoom et filtre : vers une région, la période, l'organisation, la mesure ;
- détail : les points, puis la fiche d'un incident avec son résumé.

## 10. Nos données s'arrêtent en 2017

**Études**

Le Global Terrorism Index 2025 (données 2024) attribue 51 % des morts dues au terrorisme au Sahel.
L'édition 2026 (données 2025) place le Pakistan au premier rang pour la première fois. Ces chiffres
viennent de sources de presse et sont à vérifier dans les rapports de l'IEP.

**Ce qu'on en tire**

Notre extraction de la GTD (version 2018) ne peut pas montrer ce déplacement récent vers le Sahel. Il
faut le dire clairement, à l'écran et en soutenance.

**Fait** : une mention « Données de la GTD (version 2018), de 1970 à 2017 » dans le panneau.

---

## Synthèse pour l'atlas (incidents)

| Recommandation | Justification | État |
|---|---|---|
| Incidents à leur position dès le niveau monde | §1, §9 | fait |
| Hexagones à taille d'écran constante, puis points | §2 | fait |
| Taille des points = morts, couleur = une seule rampe | §4, palette du projet | fait |
| Villes les plus touchées comme repères | pas de fond de carte hors ligne | fait |
| Filtre par organisation | §5 | fait |
| Filtre attentat-suicide, couleur par type d'attaque | §5 (T6, T8) | à faire |
| Ruptures de collecte et 1993 signalées | §6 | fait |
| Part des incidents sans coordonnées (2,5 %) signalée | qualité des données | à faire |

## Synthèse pour la comparaison de pays

| Recommandation | Justification | État |
|---|---|---|
| Jusqu'à 4 pays, couleur d'identité et nom toujours ensemble | palette validée (D20) | fait |
| Tableau juxtaposé, écarts en % et rang passé | §8 | fait |
| Petits multiples annuels | §7, §8 | fait |
| Tout désélectionner, retirer un pays | ergonomie | fait |
| Taux par habitant | §3 | à faire (données externes) |
| Indice base 100 | §8 | à faire |
| Indice composite de type GTI | §4 | écarté (poids discutés, colonnes absentes) |

---

## Sources

- LaFree, Morris, Dugan, *Identifying cross-national global terrorist hot spots* : [START](https://www.start.umd.edu/publication/identifying-cross-national-global-terrorist-hot-spots), [PDF](https://ccjs.umd.edu/sites/ccjs.umd.edu/files/pubs/Cross-National.pdf)
- Python, Illian, Jones-Todd, Blangiardo (2019), modélisation infranationale : [résumé](https://typeset.io/pdf/a-bayesian-approach-to-modelling-subnational-spatial-4bd58f40t1.pdf)
- Concentration des attentats à l'échelle de la rue (J. Quant. Criminol., 2019) : [PDF](https://springerlink.bibliotecabuap.elogim.com/content/pdf/10.1007/s10940-019-09411-2.pdf)
- LaFree, Dugan, Xie, Singh, diffusion spatiale (ETA) : [Springer](https://link.springer.com/doi/10.1007/s10940-011-9159-1)
- Carr et coll. (1987), regroupement hexagonal, via la vignette du paquet R hexbin : [vignette](https://anorien.csc.warwick.ac.uk/CRAN/web/packages/hexbin/vignettes/hexagon_binning.pdf), [chapitre sur les points superposés](https://f0nzie.github.io/dataviz-rsuite/overlapping-points.html)
- Choroplèthes et comptages : [Gimond, *Pitfalls to avoid*](https://mgimond.github.io/Spatial/pitfalls-to-avoid.html), [TMU GIS blog](https://gis.blog.torontomu.ca/2020/03/26/the-graduated-colour-map-a-minefield-for-armchair-cartographers/)
- Global Terrorism Index, méthodologie : [Vision of Humanity](https://www.visionofhumanity.org/understanding-the-global-terrorism-index-methodology/), [Wikipédia](https://en.wikipedia.org/wiki/Global_Terrorism_Index)
- Global Terrorism Index 2025 et 2026 : [Africanews (2025)](https://www.africanews.com/amp/2025/06/23/sahel-region-hardest-hit-by-terrorism-worldwide-says-global-terrorism-index-2025/), [Africanews (2026)](https://www.africanews.com/amp/2026/03/19/sahel-accounts-for-nearly-half-of-all-terror-related-deaths-report/), [Vision of Humanity](https://www.visionofhumanity.org/maps/global-terrorism-index/)
- Asal et Rethemeyer (2008), *The Nature of the Beast* : [START](https://www.start.umd.edu/publication/nature-beast-organizational-structures-and-lethality-terrorist-attacks)
- Létalité des attentats-suicides : [Mroszczyk, *To Die or to Kill*](https://terrorismresearch.uark.edu/files/2020/07/To-Die-or-to-Kill_-An-Analysis-of-Suicide-Attack-Lethality.pdf), [Alakoc (IJCV)](https://ijcv.org/index.php/ijcv/article/view/3089), [Pape, Pew (2005)](https://www.pewresearch.org/religion/2005/10/21/in-gods-name-evaluating-the-links-between-religious-extremism-and-terrorism/)
- Méthode de collecte de la GTD : [Wikipédia](https://en.wikipedia.org/wiki/Global_Terrorism_Database), [codebook 2016 archivé](https://webarchive.library.unt.edu/web/20161103051957/http://www.start.umd.edu/gtd/downloads/Codebook.pdf)
- Robertson et coll. (2008), *Effectiveness of Animation in Trend Visualization* : [PDF](https://faculty.cc.gatech.edu/~stasko/papers/infovis08-anim.pdf) ; Brehmer et coll. (2019) : [arXiv](https://arxiv.org/pdf/1907.03919)
- Gleicher et coll. (2011) et Gleicher (2018) : [*Considerations for Visualizing Comparison*](https://pages.graphics.cs.wisc.edu/VisSnacks/papers/comparison) ; L'Yi, Jo, Seo (2021) : [arXiv](https://arxiv.org/pdf/2009.00192)
- Outils antérieurs sur la GTD : [GTD Data Rivers (START)](https://start.umd.edu/gtd/features/GTD-Data-Rivers.aspx), [Lee, *Exploring Global Terrorism Data*](https://www.cs.umd.edu/sites/default/files/scholarly_papers/JoonghoonLee_1.pdf)
- Shneiderman (1996), *The Eyes Have It: A Task by Data Type Taxonomy for Information Visualizations*, IEEE Symposium on Visual Languages (référence classique, non relue ici).
