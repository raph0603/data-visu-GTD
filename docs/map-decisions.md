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
