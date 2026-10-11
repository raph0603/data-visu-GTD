# Module `map` : journal des décisions

Chaque entrée donne la décision, l'argument (mesure ou complexité), l'alternative
rejetée et les fichiers concernés. Les mesures sont rejouables avec les commandes
indiquées.

## D1. Fond de carte : world-atlas 2.0.2, `countries-50m`

**Statut** : adoptée le 2026-10-11.

**Décision** : la géométrie des pays vient de `world-atlas@2.0.2` (Natural Earth
4.1.0, licence ISC), au 1:50m.

**Mesures** (Node 24, gzip niveau 6, `topojson-client@3.1.0`) :

| Jeu | Brut | Gzip | Entités | Entités sans code | Points (GeoJSON) |
|---|---|---|---|---|---|
| 110m | 105,2 Ko | 37,5 Ko | 177 | 3 | 10 587 |
| **50m** | 738,7 Ko | **227,4 Ko** | **241** | 5 | 99 539 |
| 10m | 3 575,3 Ko | 931,9 Ko | 255 | 16 | 544 898 |

Points par pays, 110m → 50m : médiane 37 → 180 ; Irak 30 → 233 ;
Afghanistan 69 → 410 ; Liban 11 → 62 ; Colombie 100 → 623.

**Argument** :

- Budget. Le chargement initial (meta + country_year + region_year +
  géométrie) doit rester sous 2 Mo gzip. Le 50m en consomme 227 Ko (11 %), ce qui
  laisse environ 1,77 Mo aux agrégats.
- Couverture. Le 50m contient 61 entités absentes du 110m, dont Bahreïn,
  Singapour, Malte, Maldives, Hong Kong, Macao, Comores, Maurice, Seychelles,
  Grenade et Dominique. Avec le 110m, tout incident dans ces entités serait
  non représentable. Le nombre d'incidents GTD concernés sera chiffré à
  l'étape 1.2, quand le CSV sera disponible.
- Zoom sémantique. Le détail par pays agrandit un seul pays à l'écran. Au 110m,
  le Liban est un polygone de 11 points et l'Irak de 30 : le contour devient
  visiblement anguleux, et des points d'incidents réels tomberaient hors du
  polygone dessiné. Le 50m multiplie la résolution par 5 à 8.

**Alternatives rejetées** :

- 110m : 6 fois plus léger, mais 61 entités en moins et des contours trop
  grossiers pour le détail.
- 10m : tient dans le budget (932 Ko, 47 %), mais 5,5 fois plus de points que
  le 50m, donc un coût de tracé et de zoom plus élevé pour un gain invisible à
  l'échelle du monde.
- 110m pour l'overview et 50m pour le détail : deux géométries à garder
  cohérentes (identifiants, contours) pour économiser 190 Ko gzip, alors que le
  50m seul tient déjà dans le budget.

**Risque à mesurer à l'étape 3** : le temps de tracé SVG des 99 539 points en
overview. S'il est trop élevé, on simplifiera à l'exécution
(`topojson-simplify`) plutôt que de revenir au 110m.

**Rejouer** : `node scripts/measure-atlas.mjs`.

**Fichiers** : `package.json` ; `src/core/geo.ts` (étape 1.4).

## D2. Identifiants : code ISO 3166-1 numérique converti en alpha-3

**Statut** : adoptée le 2026-10-11.

**Constat vérifié dans les données**, et pas seulement dans le README du paquet :
dans `countries-50m.json`, `id` est une chaîne de 3 chiffres (par exemple `"250"`
pour la France). 236 géométries sur 241 en ont un, et les 236 se résolvent dans
ISO 3166-1. `properties` ne contient que `name`.

**Décision** : la clé de jointure de la carte est le code **alpha-3**
(`FRA`, `IRQ`). La table numérique → alpha-3 est générée depuis la base ISO
3166-1 de Debian `iso-codes`, embarquée dans `pycountry==26.2.16`.

**Argument** :

- La GTD ne fournit aucun code ISO, d'après les colonnes utilisées à ce jour
  (`country_txt`) ; à confirmer sur le CSV à l'étape 1.2. Une table de
  correspondance est donc nécessaire dans tous les cas. Autant qu'elle aboutisse
  à un code lisible dans `mapping_pays.csv` et dans l'URL (`c=IRQ` plutôt que
  `c=368`).
- La source est traçable et versionnée, et la génération est déterministe :
  deux exécutions donnent le même SHA-256.
- La base `iso3166-3` de pycountry contient aussi 31 codes retirés (URSS,
  Yougoslavie, etc.), utiles pour la politique des entités historiques de
  l'étape 1.2.

**Alternatives rejetées** :

- Garder le code numérique comme clé : illisible dans l'URL et dans le
  tableau de correspondance.
- Table saisie à la main : risque d'erreur, et contraire à la règle « ne rien
  inventer ».
- Paquet npm `i18n-iso-countries` : maintenu par la communauté, avec une
  provenance des données moins traçable que Debian `iso-codes`.

**Rejouer** :
`python preprocess/build_iso3166_table.py`, puis `npm test`.
Le test `src/core/iso3166.test.ts` échoue si une géométrie codée du 50m n'a plus
d'alpha-3, si un code est dupliqué ou si la liste des géométries sans code change.

**Fichiers** : `preprocess/build_iso3166_table.py`,
`preprocess/requirements.txt`, `src/core/iso3166.ts` (généré),
`src/core/iso3166.test.ts`.

## D3. Code partagé `036` : Australie et îles Ashmore-et-Cartier

**Statut** : adoptée et implémentée le 2026-10-11 dans `src/core/geo.ts`.

**Constat** : dans le 50m (et le 10m), deux géométries portent `036` :
« Australia » et « Ashmore and Cartier Is. », un territoire extérieur australien
sans code ISO propre.

**Décision** : `featureFor("AUS")` renvoie la fusion des géométries de même code
(`topojson.merge`). L'entité prend le nom de la plus grande géométrie
(`d3.geoArea`), donc « Australia ». Le résultat ne dépend pas de l'ordre des
géométries dans le fichier.

**Alternatives rejetées** : garder la première géométrie trouvée (dépend de
l'ordre du fichier) ; supprimer Ashmore (perte silencieuse d'un territoire).

**Vérification** : le test « merges the geometries that share a code » compare
l'aire de `AUS` à la somme des aires des deux géométries sources, calculée
indépendamment de `geo.ts`. Si l'on remplace la fusion par « garder la
première », ce test échoue. Une erreur de sens d'enroulement des anneaux
ferait aussi échouer ce test, car l'aire deviendrait celle du reste du globe.

## D4. Géométries sans code ISO

**Statut** : ouverte, à trancher à l'étape 1.2 avec les chiffres du CSV.

**Constat** : 5 géométries du 50m n'ont pas d'`id` : Kosovo, N. Cyprus,
Somaliland, Siachen Glacier et Indian Ocean Ter. Elles ne peuvent donc pas être
jointes par code.

**À faire** : compter les incidents GTD rattachés à ces entités. Pour chacune,
la politique par défaut est `not_representable` avec un compteur visible ;
l'alternative est un code attribué explicitement, à chiffrer.

## D5. Chargeur partagé `src/core/geo.ts`

**Statut** : adoptée et implémentée le 2026-10-11. C'est un nouveau fichier de
`src/core/`, donc partagé avec le module `atlas`.

**Décision** : `geo.ts` expose :

- `loadCountryAtlas(url?, fetchTopology?)`, mémoïsé par URL ;
- `buildCountryAtlas(topology)`, une fonction pure ;
- un `CountryAtlas` qui contient :
  - `countries`, une entité par code alpha-3, triées par code ;
  - `uncoded`, les entités sans code ISO utilisable ;
  - `featureFor(iso3)` ;
  - `topology`.

**Arguments** :

- **Fichier séparé (`?url`)**. La géométrie (739 Ko bruts) n'est pas incluse
  dans le JavaScript. Vite l'émet comme fichier à nom haché
  (`assets/countries-50m-<hash>.json`, vérifié par un build). Le navigateur peut
  donc la garder en cache indépendamment du code, et le JS reste petit à
  analyser.
- **Mémoïsation de la promesse plutôt que du résultat**. Si `map` et `atlas`
  demandent la carte en même temps, un seul téléchargement et un seul calcul ont
  lieu (fusions, index). Un échec est retiré du cache, pour qu'une coupure
  réseau passagère ne bloque pas la carte jusqu'au rechargement de la page.
- **`featureFor` par `Map`**. L'accès coûte O(1), contre O(n) pour un
  `Array.find` sur 235 entités, appelé à chaque survol et à chaque rendu.
- **Les entités sans code restent dessinables**. Les jeter laisserait des trous :
  le nord de la Somalie (Somaliland), le Kosovo, le nord de Chypre. Une absence
  de territoire se lirait comme de la mer. Le module `map` les dessinera avec
  l'encodage « non représentable ».
- **`topology` est exposée**. Les modules peuvent ainsi calculer les frontières
  (`topojson.mesh`) ou les voisins sans qu'on doive modifier `geo.ts`, ce qui
  exigerait une proposition écrite.
- **Ordre par code**. Il est déterministe, ce qui donne un ordre DOM stable. Le
  module `map` pourra trier autrement pour la navigation clavier, par exemple par
  nom affiché.
- **`fetchTopology` injectable**. Les tests tournent sans réseau et sans
  remplacer d3.

**Alternatives rejetées** :

- `import topology from "…countries-50m.json"`. La géométrie entrerait dans le
  bundle JS : environ 227 Ko gzip de plus à télécharger et analyser avant
  l'affichage, et aucun cache séparé du code.
- Mémoïser le résultat seulement : deux appels simultanés déclencheraient deux
  téléchargements.
- Jeter les entités sans code : trous dans la carte.

**Vérification** : `npm test` exécute 10 tests dans `src/core/geo.test.ts`. Quatre
comportements ont été volontairement cassés un par un, et chacun a fait
échouer exactement le test prévu :

| Comportement cassé | Test qui échoue |
|---|---|
| Pas de fusion des codes partagés | merges the geometries that share a code |
| Pas de mémoïsation | fetches a given URL once |
| Échec gardé en cache | does not keep a failed load |
| Entités sans code jetées | keeps geometries without ISO code |

**Fichiers** : `src/core/geo.ts`, `src/core/geo.test.ts`, `package.json`
(`@types/geojson`, `@types/topojson-specification` déclarés explicitement,
car `geo.ts` les importe directement).

## D6. Correspondance des noms de pays GTD (`preprocess/mapping_pays.csv`)

**Statut** : 185 lignes `direct` adoptées ; 20 lignes en attente de décision,
mises par défaut en `not_representable`. Mesuré le 2026-10-11.

**Données** : 181 691 incidents, 205 valeurs distinctes de la colonne pays, 1970
à 2017, aucune ligne pour 1993. Chaque nom correspond à un seul code pays GTD.

**Méthode, sans rien deviner en silence** :

1. `propose_country_mapping.py` propose `direct` seulement si le nom GTD est
   identique à un nom ISO 3166-1 (`name`, `official_name` ou `common_name`
   dans pycountry) **et** si ce code a une forme dans la carte. Cela donne
   172 noms.
2. 13 variantes de nom ont été vérifiées une par une et passées en `direct` :
   Turkey, Russia, Democratic Republic of the Congo, Bosnia-Herzegovina,
   Macedonia, Ivory Coast, Macau, Swaziland, Brunei, St. Kitts and Nevis,
   St. Lucia, Falkland Islands, Vatican City. La colonne `note` donne le nom
   ISO correspondant.
3. Les 20 autres noms (3 537 incidents, soit 1,95 %) restent en
   `not_representable`, la politique par défaut du brief.

**Mesure de l'alternative « réaffectation par coordonnées »**
(`d3.geoContains` sur le 50m, avec un filtre par rectangle englobant) :

| Nom GTD | Incidents | Années | Sans coordonnées | Où tombent les points |
|---|---|---|---|---|
| West Bank and Gaza Strip | 2 227 | 1972-2017 | 12 | PSE 2 167, ISR 48 |
| West Germany (FRG) | 541 | 1970-1990 | 13 | DEU 528 |
| Yugoslavia | 203 | 1973-2002 | 1 | Kosovo 112, SRB 59, HRV 13, BIH 11, MNE 4, MKD 1, SVN 1, aucune forme 1 |
| Kosovo | 196 | 1999-2017 | 2 | Kosovo (forme sans code) 194 |
| Rhodesia | 83 | 1978-1980 | 25 | ZWE 56, ZMB 2 |
| Soviet Union | 78 | 1978-1991 | 4 | AZE 24, RUS 18, ARM 10, LVA 7, LTU 6, EST 4, GEO 3, KGZ 2 |
| Guadeloupe | 56 | 1980-1991 | 17 | aucune forme 36, FRA 3 |
| Zaire | 50 | 1972-1997 | 6 | COD 43, UGA 1 |
| East Germany (GDR) | 38 | 1970-1990 | 0 | DEU 38 |
| Martinique | 12 | 1981-1992 | 1 | aucune forme 8, FRA 3 |
| Serbia-Montenegro | 11 | 2003-2006 | 0 | SRB 10, Kosovo 1 |
| Czechoslovakia | 10 | 1972-1992 | 1 | CZE 8, SVK 1 |
| East Timor | 10 | 2000-2008 | 2 | TLS 8 |
| French Guiana | 7 | 1983-1997 | 0 | FRA 7 |
| North Yemen | 6 | 1974-1988 | 2 | YEM 4 |
| People's Republic of the Congo | 4 | 1972-1982 | 1 | COG 2, AGO 1 |
| South Yemen | 2 | 1971-1983 | 1 | YEM 1 |
| International | 1 | 2002 | 0 | aucune forme 1 |
| New Hebrides | 1 | 1980 | 0 | VUT 1 |
| South Vietnam | 1 | 1972 | 0 | VNM 1 |

**Limite de la réaffectation par coordonnées** : la France du 50m contient bien
la Guadeloupe (3 polygones), la Martinique et la Guyane. Pourtant, 27 incidents
de Guadeloupe partagent un même point de Pointe-à-Pitre, sur la côte, à 1,7 km
du contour simplifié : le test les place en mer. Au 1:50m, les villes côtières
sortent souvent des polygones, ce qui rend la réaffectation fragile.

**Propositions, à trancher** :

| Groupe | Noms | Incidents | Proposition | Argument |
|---|---|---|---|---|
| A. Territoire entièrement contenu dans un seul pays actuel | FRG, GDR → DEU ; Rhodesia → ZWE ; Zaire → COD ; East Timor → TLS ; North et South Yemen → YEM ; People's Rep. of the Congo → COG ; New Hebrides → VUT ; South Vietnam → VNM | 736 | `successor` | Les coordonnées le confirment : 682 des 686 points localisés tombent dans le pays proposé. Les autres tombent juste de l'autre côté d'une frontière (raids transfrontaliers, coordonnées approximatives). |
| B. État éclaté entre plusieurs pays | Yugoslavia, Soviet Union, Serbia-Montenegro, Czechoslovakia | 302 | `not_representable` et compteur | Aucun successeur unique n'existe. Réaffecter par coordonnées imposerait une étape point-dans-polygone dans le preprocess Python, pour 0,17 % des incidents, dont 113 tomberaient de toute façon au Kosovo. |
| C1. Territoire contesté avec un code ISO | West Bank and Gaza Strip → PSE | 2 227 | `direct` | La forme PSE existe dans le 50m, et 98 % des points localisés y tombent. Laisser cette entité non représentable cacherait l'une des zones les plus touchées. |
| C2. Territoire contesté sans code ISO | Kosovo | 196 | Au choix : `not_representable`, ou code `XKX` attribué à la forme « Kosovo » | Le code `XKX` n'est pas ISO (c'est un code réservé à l'usage des utilisateurs). Il exigerait de modifier `src/core/geo.ts`, donc une proposition de diff. |
| D. Territoire inclus dans la forme d'un autre pays | Guadeloupe, Martinique, French Guiana → FRA | 75 | Nouvelle politique `part_of` | Ces îles sont dessinées comme parties de la France : elles prennent la couleur de FRA, qui doit donc inclure leurs incidents. Il faut ajouter `part_of` aux politiques autorisées. |
| E. Sans lieu | International | 1 | `not_representable` | Il n'y a rien à dessiner. |

**Effet chiffré** : avec toutes les propositions, il resterait 499 incidents non
représentables (0,27 %), et 303 (0,17 %) si le Kosovo reçoit `XKX`. Avec les
valeurs par défaut actuelles, il y en a 3 537 (1,95 %).

**Rejouer** :

- `python preprocess/propose_country_mapping.py` (noms non couverts) ;
- `python -m pytest preprocess` (validité de la table) ;
- `python preprocess/export_policy_points.py | npx tsx scripts/measure-country-reassignment.ts`
  (le tableau ci-dessus).

**Fichiers** :

- `preprocess/mapping_pays.csv`, `preprocess/country_mapping.py` ;
- `preprocess/test_country_mapping.py`, `preprocess/pytest.ini` ;
- `preprocess/gtd_source.py`, `preprocess/country_geometry.py` ;
- `preprocess/propose_country_mapping.py`, `preprocess/export_policy_points.py` ;
- `scripts/measure-country-reassignment.ts`.

## D7. Encodage du CSV : Windows-1252 plutôt que latin-1

**Statut** : à trancher. Le brief demande latin-1, que `gtd_source.ENCODING`
applique pour l'instant.

**Constat** : la lecture en UTF-8 strict échoue à l'octet 7127 (`0xE9`, « é »).
Le fichier contient de nombreux octets de la plage `0x80` à `0x9F` : 31 426 ×
`0x94`, 29 121 × `0x93`, 7 631 × `0x92`, 2 039 × `0x96`, etc. En Windows-1252,
ce sont les guillemets « ” », l'apostrophe ’ et le tiret –. En latin-1, ce sont
des caractères de contrôle invisibles (U+0093…). Aucun des 5 octets non définis
en Windows-1252 (`0x81`, `0x8D`, `0x8F`, `0x90`, `0x9D`) n'apparaît.

**Proposition** : `ENCODING = "cp1252"`. Les noms de pays sont en ASCII, donc
le mapping n'est pas affecté. Les textes affichés dans la fiche d'incident
(T10 : résumés, cibles) le sont.

**Alternative rejetée** : rester en latin-1. Les guillemets des résumés
deviendraient des caractères de contrôle dans `incidents/<iso3>.json`.
