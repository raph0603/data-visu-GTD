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

**Statut** : close le 2026-10-11 (voir D6).

**Constat** : 5 géométries du 50m n'ont pas d'`id` : Kosovo, N. Cyprus,
Somaliland, Siachen Glacier et Indian Ocean Ter. Elles ne peuvent donc pas être
jointes par code.

**Résolution** :

- **Kosovo** est le seul de ces noms présent dans la GTD (196 incidents). Il
  reste `not_representable` (décision D6).
- **N. Cyprus et Somaliland** ne sont pas des noms GTD : la GTD rattache ces
  incidents à « Cyprus » et « Somalia ».
  - Ils sont donc comptés dans CYP et SOM.
  - Leurs formes sans code sont dessinées avec l'encodage « non
    représentable ».
  - Limite connue : la couleur de la Somalie ne s'étend pas au Somaliland,
    alors que ses incidents y sont comptés.
- **Siachen Glacier et Indian Ocean Ter.** n'ont aucun nom GTD.

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

**Statut** : adoptée le 2026-10-11. Les propositions A, B, C1, D et E sont
retenues ; pour C2, le Kosovo reste `not_representable`. La table compte
186 `direct`, 10 `successor`, 3 `part_of` et 6 `not_representable`, soit
499 incidents non représentables (0,27 %).

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

**Propositions** (tranchées le 2026-10-11, voir le statut) :

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

**Statut** : adoptée le 2026-10-11 ; elle remplace le latin-1 demandé par le
brief.

**Constat** : la lecture en UTF-8 strict échoue à l'octet 7127 (`0xE9`, « é »).
Le fichier contient de nombreux octets de la plage `0x80` à `0x9F` : 31 426 ×
`0x94`, 29 121 × `0x93`, 7 631 × `0x92`, 2 039 × `0x96`, etc. En Windows-1252,
ce sont les guillemets « ” », l'apostrophe ’ et le tiret –. En latin-1, ce sont
des caractères de contrôle invisibles (U+0093…). Aucun des 5 octets non définis
en Windows-1252 (`0x81`, `0x8D`, `0x8F`, `0x90`, `0x9D`) n'apparaît.

**Décision** : `ENCODING = "cp1252"` dans `preprocess/gtd_source.py`. Les noms
de pays sont en ASCII, donc le mapping n'est pas affecté. Les textes affichés
dans la fiche d'incident (T10 : résumés, cibles) le sont.

**Alternative rejetée** : rester en latin-1. Les guillemets des résumés
deviendraient des caractères de contrôle dans `incidents/<iso3>.json`.

**Vérification** : `python -m pytest preprocess`. Le test
`test_text_has_no_c1_control_characters` passe en cp1252. En latin-1, il échoue :
2 357 résumés contiennent alors des caractères de contrôle.

## D8. Contrat de données `src/core/contracts.ts`

**Statut** : adoptée le 2026-10-11, à faire valider par l'équipe. C'est un
nouveau fichier de `src/core/` : tous les modules liront ces formats.

**Décision** : cinq fichiers sous `public/data/<dataset>/`, chacun avec un
type, un validateur et une fonction de chargement (`fetchMeta`,
`fetchCountryYear`, etc.). Les règles communes :

- **Séries alignées sur un axe d'années.** Chaque série est un tableau indexé
  par `année - years.first`.
- **`null` exactement sur les années sans aucune ligne** (`meta.years.gaps`,
  ici 1993). Ailleurs, c'est une valeur mesurée, éventuellement 0.
- **Les victimes séparent `sum` et `known`.** `sum` est la somme des valeurs
  connues, `known` le nombre d'incidents dont la valeur est connue.
- **`country_year.json` contient les 235 pays dessinables**, y compris ceux
  sans incident, avec des zéros explicites. Les incidents sans pays
  représentable sont dans `notRepresentable`.
- **`top_events.json` garde, par pays et par année, les 5 incidents les plus
  meurtriers.**
- **`incidents/<iso3>.json` est stocké en colonnes**, avec des dictionnaires
  pour le type d'attaque, le type de cible et le groupe.

**Arguments** :

- **Tableaux alignés**. On accède à une année par son index, et les sommes
  préfixées se construisent directement. Poids mesuré : 26 Ko gzip pour 235
  pays × 48 ans. L'alternative, un format long avec une ligne
  `{iso3, year, …}` par pays et par année, répète les clés 11 280 fois ; son
  poids n'a pas été mesuré.
- **`null` plutôt que 0 en 1993**. La règle « jamais de 0 pour 1993 » ne peut
  pas être violée par erreur : le validateur refuse un 0 sur une année sans
  données, avec le message `entities.FRA.incidents: 1993 must be null`.
- **`sum` et `known`**. Un nombre de morts inconnu n'est jamais lu comme 0, et
  l'interface peut afficher la part connue (`knownShare`).
- **Tous les pays dessinables présents**. Un pays absent du fichier serait
  ambigu : pas de donnée, ou zéro ? Ici, une clé absente donne NaN et un zéro
  est toujours écrit.
- **Top 5 par année**. Le top 5 exact de n'importe quelle fenêtre fait partie
  de l'union des top 5 annuels : un incident du top 5 de la fenêtre est
  forcément dans le top 5 de son année. Coût mesuré : 12 847 incidents,
  262 Ko gzip, chargés à la demande.
- **Colonnes et dictionnaires**. Les chaînes répétées (type d'attaque, groupe)
  sont stockées une seule fois par fichier.
- **Validation au chargement**. Elle coûte O(taille) une fois. Une erreur du
  preprocess apparaît au chargement, avec le fichier et le chemin fautif, au
  lieu de produire une carte fausse.

**Alternatives rejetées** :

- Top 10 global par pays : une fenêtre de quelques années pourrait n'en
  contenir aucun.
- Calculer le top à partir de `incidents/<iso3>.json` : les 4 558 incidents
  sans coordonnées en seraient exclus, et il faudrait charger 1,1 Mo pour
  l'Irak.
- Zéro implicite pour les pays absents du fichier : on ne pourrait plus
  distinguer un zéro mesuré d'une donnée manquante.

**Vérification** : `npm test`, qui exécute `src/core/contracts.test.ts`
(26 tests sur des cas valides et invalides) et
`src/core/contracts.data.test.ts` (les 237 fichiers réels respectent le
contrat ; le test est sauté avec son motif si les fichiers n'ont pas été
générés).

**Fichiers** : `src/core/contracts.ts`, `src/core/contracts.test.ts`,
`src/core/contracts.data.test.ts`.

## D9. Index de fenêtres `YearlyIndex` (`src/core/series.ts`)

**Statut** : adoptée le 2026-10-11 ; nouveau fichier de `src/core/`.

**Décision** : `YearlyIndex` construit des sommes préfixées une seule fois, en
O(pays × années). `window(clé, métrique, de, à)` répond ensuite en O(1).

**Ce que renvoie une fenêtre** :

| Situation | Résultat |
|---|---|
| Fenêtre faite uniquement d'années sans données, hors période ou clé inconnue | NaN |
| Incidents présents mais aucune valeur de victimes connue | NaN |
| Aucun incident | 0 |
| Victimes connues dont la somme vaut 0 | 0 |
| Autres cas | La somme ; pour les victimes, `knownShare` donne la part connue |

**Argument** : le rang du tooltip (T1) et la variation de rang (T12) demandent
la valeur de tous les pays à chaque mouvement du curseur. En O(1), le coût ne
dépend pas de la largeur de la fenêtre. Le gain absolu reste modeste : une
somme directe coûterait environ 11 000 additions par mise à jour.

**Alternative rejetée** : additionner les années à chaque requête, en O(années)
par pays.

**Vérification** : `npm test` (17 tests). Trois défauts ont été injectés un
par un : lire une valeur inconnue comme 0, lire 1993 comme 0, lire un zéro
mesuré comme inconnu. Chacun fait échouer 2 tests.

## D10. Preprocess `preprocess/preprocess.py`

**Statut** : adoptée le 2026-10-11.

**Décisions et arguments** :

- **Colonnes explicites**. Seules 15 colonnes sur 135 sont lues, nommées
  uniquement dans `gtd_source.COLUMNS`. Le fichier est lu en cp1252 (D7).
- **Coordonnées invalides comptées comme absentes**. Une latitude hors
  [-90, 90] ou une longitude hors [-180, 180] est traitée comme une
  coordonnée manquante. Un seul cas : l'événement 198212240004 (Nicaragua,
  longitude -86185896). La valeur n'est pas corrigée (règle 4). Le total sans
  coordonnées valides passe ainsi de 4 557 à 4 558.
- **Blessés fractionnaires conservés**. Deux lignes du 2012-07-07 au Nigeria
  ont 8,5 blessés : les sommes peuvent être décimales.
- **Libellé du pays**. C'est le nom GTD de la ligne `direct` s'il en existe
  une, sinon le nom ISO (par exemple TLS → « Timor-Leste »).
- **Région d'un pays**. C'est sa région GTD la plus fréquente : DEU a 1 276
  incidents en Western Europe et 38 en Eastern Europe (la RDA) ; FRA en a
  2 693 en Western Europe, 68 aux Caraïbes et 7 en Amérique du Sud.
  `region_year.json` compte chaque incident dans sa propre région.
- **Sortie déterministe**. Les lignes sont triées par identifiant, les clés
  JSON triées, les dictionnaires triés, et aucun horodatage n'est écrit. Le
  test de double exécution lance la seconde dans un processus séparé : un
  ordre qui dépendrait d'un `set` y est détecté (vérifié en injectant ce
  défaut).
- **Dossier de sortie protégé**. Le script refuse de vider un dossier qui ne
  contient pas de `meta.json`.

**Limites connues** :

- **Aucun filtre sur le doute terroriste**. 29 001 incidents sont marqués
  « doute sur le caractère terroriste », et 13 784 ont une valeur inconnue. Ils
  sont tous comptés.
- **Porto Rico et les îles Vierges américaines** : voir D11.

**Rejouer** : `python preprocess/preprocess.py` (8 s), puis
`python -m pytest preprocess`. 26 tests, dont les contrôles sur le vrai CSV :
total des lignes, incidents par année, morts et blessés connus, fichiers par
pays, années sans données, double exécution.

## D11. Rapport de taille et décisions ouvertes

Mesuré le 2026-10-11 avec `python preprocess/size_report.py` (gzip niveau 6) :

| Fichier | Brut | Gzip |
|---|---|---|
| meta.json | 0,5 Ko | 0,4 Ko |
| agg/country_year.json | 181,2 Ko | 26,0 Ko |
| agg/region_year.json | 10,9 Ko | 4,2 Ko |
| géométrie countries-50m | 738,7 Ko | 230,6 Ko |
| **Chargement initial** | | **261,2 Ko, soit 12,8 % du budget de 2 Mo** |
| top_events.json (à la demande) | 2 031,9 Ko | 262,1 Ko |
| incidents/ (235 fichiers) | 46 063,6 Ko | 8 281,5 Ko |

Les 5 plus gros fichiers d'incidents :

| Fichier | Brut | Gzip | Gzip sans les résumés |
|---|---|---|---|
| IRQ | 8 157,3 Ko | 1 111,7 Ko | 235,0 Ko |
| PAK | 4 621,9 Ko | 838,3 Ko | 175,5 Ko |
| IND | 3 766,0 Ko | 778,1 Ko | 183,7 Ko |
| AFG | 4 470,3 Ko | 758,4 Ko | 181,1 Ko |
| PHL | 2 050,5 Ko | 421,5 Ko | 103,2 Ko |

La géométrie pèse 230,6 Ko avec le gzip de Python, contre 227,4 Ko avec celui
de Node (D1). Les deux implémentations ne compressent pas exactement de la
même façon.

**Décisions ouvertes** :

1. **Où mettre les résumés ?** Ils représentent environ 80 % du poids des
   fichiers d'incidents.
   - Les garder dans `incidents/<iso3>.json` : 1,1 Mo gzip à charger au zoom
     sur l'Irak.
   - Les sortir dans un fichier chargé seulement au clic sur un incident (T10) :
     235 Ko gzip pour les points de l'Irak. Cela modifie `contracts.ts` et
     demande donc une proposition de diff.
2. **Commiter `public/data/gtd/` ?** Le dossier pèse 48 Mo bruts. Trois options :
   - ne rien commiter et regénérer : 8 s, mais il faut le CSV et le `.venv` ;
   - commiter seulement `meta`, `agg` et `top_events` (environ 2,2 Mo) ;
   - tout commiter : chaque régénération modifiée alourdit alors l'historique.
3. **Porto Rico (PRI) et les îles Vierges américaines (VIR)**. La GTD étiquette
   « United States » les incidents situés dans ces territoires : 245 incidents
   tombent dans la forme de PRI et 3 dans celle de VIR, sur 1970-2017. Ils
   comptent donc pour les États-Unis, et ces deux formes afficheraient un 0 qui
   n'est pas un zéro mesuré.
   - Mesure : le test point-dans-polygone a porté sur les 48 pays dessinables
     sans incident. Seuls ces deux-là contiennent des incidents.
   - Option : ajouter au contrat un champ « compté avec USA » pour les dessiner
     comme non représentables, avec une explication dans le tooltip.

## D12. Résumés dans `summaries/<iso3>.json`

**Statut** : adoptée le 2026-10-12 ; tranche la décision ouverte 1 de D11.
Modifie `contracts.ts` (colonne `summary` retirée de `incidents/<iso3>.json`).

**Décision** : les résumés quittent les fichiers d'incidents. Chaque pays
dessinable a un fichier `summaries/<iso3>.json` qui associe un identifiant
d'incident à son résumé, pour tous ses incidents qui en ont un, avec ou sans
coordonnées. Les vues le chargent seulement à l'ouverture d'une fiche (T10),
par `ctx.data.summaries(iso3)`.

**Argument** : mesuré avec `size_report.py`, le fichier de points de l'Irak
passe de 1 111,7 Ko à 238,0 Ko gzip ; ses résumés (975,0 Ko gzip) ne sont
téléchargés qu'au premier clic sur un incident irakien.

**Alternative rejetée** : un fichier de résumés par pays et par année. Il
donnerait des téléchargements plus petits au clic, mais 11 280 fichiers.

## D13. Séries par groupe `agg/group_year.json`

**Statut** : adoptée le 2026-10-12.

**Décision** : les 3 537 groupes sont tous écrits, sans seuil, au même format
que `region_year.json`, et la clé est le nom GTD. « Unknown » (45,6 % des
incidents) reste une entité : c'est au leaderboard de l'exclure par défaut et
de le signaler.

**Argument** : 147,9 Ko gzip, chargés à la demande. Un seuil (par exemple
10 incidents, 592 groupes, 96,5 % des incidents) aurait fait disparaître des
groupes d'une fenêtre où ils comptent, et le total n'aurait plus égalé celui
des pays.

**Vérification** : la somme des groupes égale le nombre de lignes du CSV
(`test_groups_and_flow_count_every_row`, `contracts.data.test.ts`).

## D14. Cube de faits `cube.json`

**Statut** : adoptée le 2026-10-12 (remplace `flow.json`, qui n'avait pas encore
de lecteur).

**Décision** : un cube creux année × pays × type d'attaque × type de cible ×
type d'arme (`weaptype1_txt`, ajoutée à `gtd_source.COLUMNS`) × organisation ×
attentat-suicide, stocké en colonnes avec dictionnaires : 60 014 combinaisons (290 Ko gzip),
avec pour chacune le nombre d'incidents et, pour les morts et les blessés, la
somme connue et le nombre de valeurs connues. Les incidents sans pays
représentable ont le code pays `""`. `incidents/<iso3>.json` reçoit aussi le
type d'arme, pour que les points suivent les mêmes filtres.

**Argument** : tous les filtres de la vue pays (D18) s'appliquent à toutes ses
vues à partir d'un seul fichier : la carte, les chiffres clés, les courbes, les
répartitions, le flux, le classement, les organisations et les liens entre pays
restent cohérents. Sans le pays, le flux ne suivrait pas la sélection ; sans
l'organisation et le suicide, ces deux filtres ne s'appliqueraient qu'aux points.
Mesures (sur les noms de pays GTD, avant fusion en codes ISO) : 40 183 combinaisons sans
organisation ni suicide, 60 066 avec, soit une hausse de 50 % pour deux filtres de plus.

**Vérification** : la somme du cube égale le nombre de lignes du CSV, morts
connus compris (`test_groups_and_flow_count_every_row`, `contracts.data.test.ts`).

## D15. Colonne `suicide` dans `incidents/<iso3>.json`

**Statut** : adoptée le 2026-10-12.

**Décision** : 1 pour un attentat-suicide, 0 sinon (la colonne n'a aucune
valeur manquante dans le CSV de 2018). Elle permet T8 (« les attentats-suicides
sont-ils plus meurtriers ? ») dans l'atlas.

## D16. Métrique « morts par incident »

**Statut** : adoptée le 2026-10-12. Ajoute `YearlyIndex.mean` (`series.ts`)
et la métrique `lethality` (`meta.ts`).

**Décision** : sur une fenêtre, morts connus ÷ nombre d'incidents dont le
nombre de morts est connu, jamais une moyenne de moyennes annuelles. NaN si
aucune valeur n'est connue. La carte colore tous les pays, mais son classement
ne retient que les pays d'au moins 10 incidents sur la fenêtre
(`MIN_INCIDENTS_FOR_MEAN`) : une seule attaque de 50 morts ferait sinon d'un
pays le premier.

**Vérification** : `npm test` (`YearlyIndex.mean`, 3 cas dont « pas une
moyenne de moyennes »).

## D17. Citation et licence

**Statut** : adoptée le 2026-10-12.

**Décision** : `meta.json` porte la citation imposée par les conditions
d'utilisation de la GTD (section 4.a de l'EULA, copiée de la page Kaggle) et un
résumé de la licence ; le shell les affiche en pied de page.

**Point d'attention** : l'EULA (section 3.a) interdit de publier les données
elles-mêmes sans accord écrit, mais autorise la publication d'une analyse ou
d'une visualisation non commerciale. Mettre l'application en ligne avec
`public/data/gtd/` revient à publier les fichiers d'incidents et leurs
résumés : à valider avant tout déploiement public.

## D18. Vue « Carte par pays » : tableau de bord centré sur les pays

**Statut** : adoptée le 2026-10-12 ; remplace la première version (choroplèthe
et top 10 seuls).

**Décision** : une seule vue, où tout porte sur les pays et où tout est lié.

- **Une ligne de filtres** au-dessus de tout : période (avec lecture animée),
  métrique, période de comparaison, type d'attaque, cible, arme, organisation
  (liste avec recherche), attentats-suicides. Chaque filtre est dans
  `state.filters` et dans l'URL, et s'applique à tous les panneaux via le cube
  (D14).
- **Sélection de 6 pays au plus** dans `state.pinned`, partagée avec le
  leaderboard. Chaque pays garde sa couleur (palette Okabe–Ito du projet) tant
  qu'il est sélectionné, même si on en retire un autre. La couleur est toujours
  accompagnée du nom : pastilles, étiquettes sur la carte, légendes.
- **Carte** : choroplèthe en échelle logarithmique de la métrique filtrée ; les
  pays sélectionnés sont cernés de leur couleur et nommés. Elle a deux couches :
  - les **incidents exacts** des pays sélectionnés (canvas, taille = morts) ;
  - les **liens** : un arc relie un pays sélectionné à chaque pays où ses
    organisations agissent aussi. L'épaisseur donne le nombre d'incidents de ces
    organisations dans le pays d'arrivée ; les 10 plus forts par pays sont gardés.
- **Panneaux liés** :
  - les chiffres clés (évolution par rapport à la comparaison) ;
  - le tableau comparatif, qui sert aussi de vue accessible ;
  - les courbes annuelles ;
  - les profils d'attaque, de cible et d'arme, en part du total de chaque pays ;
  - le flux attaque → cible → arme ;
  - le classement dynamique, en cumulé ou en annuel ;
  - les organisations et leurs pays d'action ;
  - les incidents les plus meurtriers, avec leur fiche et leur résumé.

  Cliquer une catégorie, un nœud du flux ou une organisation l'ajoute aux
  filtres ; cliquer un pays, une barre du classement, un lien ou une pastille de
  pays l'ajoute à la comparaison.

**Choix de lecture** :

- *Étiquettes génériques exclues des liens.* La GTD nomme parfois un type
  d'acteur plutôt qu'une organisation (« Gunmen » dans 50 pays, « Muslim
  extremists » dans 51). Les relier inventerait une connexion. Règle
  (`isNamedGroup`) : pas d'acronyme entre parenthèses et un dernier mot parmi
  une liste de descripteurs. Ces étiquettes restent visibles et filtrables, et
  sont marquées « étiquette générique ».
- *Profils en parts*, pour comparer des pays de tailles très différentes. Les
  valeurs absolues sont dans les infobulles.
- *Moyennes classées à partir de 10 incidents* (D16).
- *Gris pour les pays non sélectionnés* dans le classement : les pays comparés
  ressortent sans couleur de plus.
- *Palette vérifiée* avec le validateur de la skill dataviz :
  - toutes paires confondues, l'écart rose ↔ vert sous deutéranopie n'est que
    de 7,6, dans la bande 6–8 qui exige un encodage secondaire : c'est le cas
    (noms partout) ;
  - l'orange et le bleu ciel ont un contraste inférieur à 3:1, compensé par
    les étiquettes et le tableau.

**Tâches** : la matrice de l'équipe donne T1, T3, T4, T9 et T12 à la carte. La
vue couvre aussi, pour les pays, T2 (lecture animée, courbes), T5 (points), T6
(profils, flux), T7 (organisations), T8 (filtres croisés), T10 (fiche) et T11
(classement dynamique). C'est à l'équipe de décider s'il faut étendre la ligne
`map` de `src/core/tasks.ts` ; le module ne déclare que les tâches de la matrice.

**Vérification** : `npm test` (`src/modules/map/model.test.ts` : filtres,
« inconnu » ≠ 0, moyenne sur valeurs connues, répartitions, liens, couleurs
stables) et contrôle dans le navigateur. Exemples de résultats :
- Irak + Syrie + Nigeria sur 2013–2017 : 81 538 morts ;
- liens Irak → Turquie et Irak → Syrie par l'État islamique ;
- l'incident le plus meurtrier de la sélection est Tikrit (12 juin 2014,
  1 570 morts).

## D19. Vue « Carte par pays » : globe et zoom sémantique

**Statut** : adoptée le 2026-10-28 avec Alban, à implémenter sur `feat/Alban_pays` ;
remplacera D18. Principes de design dans `docs/PRODUCT.md`.

**Décision** : la vue devient un globe plein écran (projection orthographique)
dont la représentation change avec le niveau de zoom, pas seulement l'échelle.

- **Mise en page** : le globe prend environ 70 % de la largeur et toute la
  hauteur ; un panneau latéral fixe (environ 360 px) change de contenu selon le
  niveau ; une barre basse porte la lecture, la période, la métrique, la période
  de comparaison et la légende. Un fil d'Ariane (« Monde › Irak › 15 juin 2014 »)
  permet de remonter. Tout tient sans défilement.
- **Niveau monde** : choroplèthe de la métrique (échelle log) ; lecture animée
  1970 → 2017 ; au survol d'un pays, infobulle (valeur, rang, variation de rang)
  et arcs vers les pays où ses organisations nommées agissent aussi. Rotation lente
  au repos, arrêtée dès la première interaction. Panneau : chiffres du monde avec
  leur évolution, pays survolé.
- **Niveau pays** (clic) : le globe pivote et plonge sur le pays (environ 1 s,
  interpolation géodésique de la rotation et zoom ajusté à ses frontières), les
  voisins s'estompent, les incidents apparaissent en hexagones de densité puis en
  points (taille = morts) en zoomant davantage. Panneau : chiffres clés avec
  ↑↓ par rapport à la période de comparaison (par défaut la période précédente de
  même durée), organisations actives avec leur frise d'activité, 5 incidents les
  plus meurtriers. Le pays exploré est écrit dans `state.focus`, que l'atlas lit
  aussi.
- **Comparaison de 2 pays** : Maj+clic ajoute un second pays ; le panneau passe
  en deux colonnes. Les deux pays sont dans `state.pinned` (2 au plus, au lieu de
  6). Si les deux ne tiennent pas dans un même hémisphère, le globe reste sur le
  premier et le panneau compare quand même.
- **Niveau incident** : clic sur un point, fiche avec le résumé GTD (chargé au clic).
- **Clavier** : flèches pour tourner, +/− pour zoomer, Échap pour remonter.
  `prefers-reduced-motion` : pas de rotation automatique, coupes à la place des
  déplacements.

**Arguments** :

- La version D18 alignait 10 panneaux de même poids sur environ 2 600 px de
  défilement ; la carte n'occupait qu'un tiers de l'écran. Rien ne disait où
  regarder.
- Un niveau répond à une question (monde : où et quand ; pays : combien et qui ;
  incident : que s'est-il passé), ce qui rend la prise en main immédiate pour U4
  et U1.
- L'échelle de couleur reste fixée sur 1970–2017 pendant la lecture : sinon une
  même couleur changerait de sens d'une année à l'autre.
- Un globe cache la moitié du monde et déforme ses bords : il sert à s'orienter,
  pas à comparer. Le rang et sa variation restent lisibles dans l'infobulle et le
  panneau (T1, T12).
- Ambiance claire, type infographie de presse : lisible au vidéoprojecteur dans
  une salle éclairée, et sans le cliché « écran de surveillance » rouge sur noir.

**Retiré de la vue** : barre de filtres croisés (type d'attaque, cible, arme,
organisation, suicide), courbes annuelles, profils et Sankey des modes
opératoires, classement dynamique, comparaison de 6 pays. Les modes opératoires
restent à la vue `flow` (T6), le classement au `leaderboard` (T11), les filtres
fins à l'atlas (T8). Les tâches déclarées par le module ne changent pas : T1, T3,
T4, T9, T12.

**Alternatives rejetées** :

- *Récit guidé (scrollytelling)* : fort en soutenance, mais plus long à
  construire et moins libre à explorer.
- *Globe + panneaux allégés en dessous* : garde le défilement et la dispersion de
  l'attention.
- *Ambiance sombre, globe nocturne* : spectaculaire mais attendue pour le sujet,
  et moins lisible projetée.
- *Classement permanent à côté du globe* : écarté par choix de simplicité ; le
  rang reste dans l'infobulle.

**Points techniques à mesurer** : rendu en canvas (faire tourner les 235 formes
du 50m en SVG à 60 images/s ne tiendra pas), avec une géométrie simplifiée pendant
le mouvement si la cadence baisse ; hexagones calculés dans le module
(`d3-hexbin` n'est pas installé) ; boucle d'animation coupée dans `destroy()`.

**Vérification** : `npm run typecheck`, `npm test` (montage et démontage du
module sans fuite d'abonnement ni de minuterie), `npm run coverage:tasks`, et
contrôle dans le navigateur : monde, pays, deux pays éloignés, 1993, métrique
« morts par incident », réduction des animations.

## D20. Attentats visibles partout, sélection de 4 pays, période et organisation

**Statut** : adoptée et implémentée le 2026-10-28 sur `feat/Alban_pays`, à la
demande d'Alban ; complète D19. Justifications détaillées et sources dans
`docs/etat-de-l-art.md`.

**Décision** :

- **Calque « Attentats » par défaut** : les incidents de tous les pays, à leur
  position, en hexagones de densité de taille constante à l'écran (environ
  30 km au niveau pays, 430 km au niveau monde), puis en points (taille =
  morts) sous 1 500 incidents visibles ou sous 5 km par hexagone. Le calque
  « Pays » (choroplèthe, D19) reste au choix (`x.map.layer=countries`).
- **Sélection de 1 à 4 pays** dans `state.pinned`, `state.focus` = le dernier
  ajouté. Clic : ajouter ou retirer ; double-clic : zoomer sur le pays ; clic
  sur un hexagone : sélectionner le pays sous le curseur. La caméra ne bouge
  que si le pays ajouté est hors de vue. « Tout désélectionner » et Échap
  vident la sélection.
- **Couleurs d'identité** : vert bleuté, vermillon, pourpre, orange de la
  palette du projet (le bleu reste à la grandeur).
- **Période** : glisser sur l'histogramme pour la choisir, glisser la période
  pour la déplacer, clic pour une année, boutons par décennie.
- **Organisation** : filtre avec recherche (3 500 organisations, les plus
  actives d'abord) dans `state.filters.group` ; organisations du panneau
  cliquables.
- **Comparaison** : tableau à une colonne par pays, petits multiples annuels
  sur le même axe du temps (une échelle par pays, maximum écrit).
- **Qualité** : traits pointillés aux ruptures de collecte (1998, 2012), 1993
  hachurée, mention « données 1970–2017 ».

**Arguments** :

- La concentration du terrorisme est infranationale (LaFree et coll. 2006 ;
  Python et coll. 2019) : une carte par pays la cache.
- Les hexagones règlent la superposition des incidents placés au centre des
  villes (Carr et coll. 1987).
- Une choroplèthe de comptages favorise les grands pays ; sans population dans
  la GTD, elle ne peut pas être un taux, donc elle n'est plus le calque par défaut.
- L'animation est la moins efficace pour l'analyse (Robertson et coll. 2008) :
  la frise et les petits multiples restent toujours visibles.
- Comparer = juxtaposer et encoder la différence (Gleicher et coll. 2011).
- 4 pays : 4 colonnes tiennent dans le panneau, et c'est le nombre de couleurs
  non bleues de la palette.

**Palette vérifiée** (`validate_palette.js`, thème clair) : séparation sous
daltonisme des paires adjacentes ≥ 11 ; toutes paires confondues, pourpre ↔
vert à 7,6 sous deutéranopie (bande 6–8 : encodage secondaire requis, le nom est
toujours affiché) ; pourpre et orange sous 3:1 de contraste, d'où les étiquettes
et le tableau.

**Performance** : les incidents sont regroupés par position (cellules de
0,02°) avant la projection ; le fond du globe est gardé dans un canvas hors
écran, et les frontières sont découpées par ligne pour n'en projeter que celles
qui sont en vue. Les 235 fichiers d'incidents (2,5 Mo gzip) se chargent en
arrière-plan, avec leur progression affichée.

**Alternatives rejetées** : imposer la sélection d'un pays pour voir ses
incidents (D19, ce que la demande corrige) ; Maj+clic pour comparer (geste
caché) ; 6 pays (couleurs bleues confondues avec la rampe de grandeur).

**Vérification** : `npm test` (149 tests, dont `camera.test.ts`,
`selection.test.ts`, `windowMax` dans `model.test.ts`), `npm run typecheck`,
`npm run coverage:tasks` (0 bloquant), et contrôle dans le navigateur : calque
Attentats au niveau monde, sélection de deux pays puis désélection, filtre Boko
Haram (2 418 incidents, 20 328 morts), période 1980–1989 choisie en glissant.

## D21. Taux par million d'habitants, indice base 100, suicide, type d'attaque, coordonnées

**Statut** : adoptée et implémentée le 2026-10-28 sur `feat/Alban_pays` ; suite
de `docs/etat-de-l-art.md` (§3, §5, §8).

**Décision** :

- **Population** : Banque mondiale, SP.POP.TOTL (CC BY 4.0), 1970–2017,
  téléchargée dans `data/raw/population/` puis réduite par
  `preprocess/population.py` à `src/modules/map/population.json` (pays
  dessinables + `WLD`, 84 Ko, 41 Ko gzip, commité). 213 pays sur 235 ont une
  population ; les 22 autres ont 0 ou 1 incident, sauf Taïwan (50) et le Sahara
  occidental (5), absents des données de la Banque mondiale.
- **Taux** (`x.map.per=capita`) : valeur de la période ÷ population moyenne
  des années connues × 10⁶. Sans objet pour « morts par incident ». Classement
  réservé aux pays d'au moins un million d'habitants. Échelle de couleur :
  quatre décennies de log10 sous le maximum (les taux sont souvent < 1), fixe
  pendant la lecture comme D19.
- **Indice base 100** (`x.map.index=1`) : 100 = moyenne annuelle de chaque pays
  sur la période ; courbes superposées sur une seule échelle.
- **Attentats-suicides** : filtre Tous / Suicide / Hors suicide
  (`q.suicide`), appliqué partout comme l'organisation.
- **Type d'attaque** (`x.map.color=attack`) : couleur des points, au choix dans
  la légende ; 5 types (explosif, attaque armée, assassinat, enlèvement,
  attaque d'installation, 95 % des incidents) + gris.
- **Incidents sans coordonnées** : nombre de la période dans la légende et sous
  le tableau des chiffres (compté sans les filtres, que
  `agg/country_year.json` ne porte pas).

**Pourquoi dans le module et pas dans `core/`** : le contrat de données est
gelé et sa modification demande une revue à deux. La population est une donnée
de référence, comme le fond de carte, pas une donnée de la GTD : elle vit dans
le dossier de la vue. Si d'autres vues en ont besoin, elle pourra rejoindre
`contracts.ts` et `DataApi` après revue.

**Palette des types d'attaque** (`validate_palette.js`, clair) : ordre bleu,
orange, vert bleuté, vermillon, pourpre ; paires adjacentes ≥ 11 sous
daltonisme ; toutes paires, vert ↔ pourpre à 7,6 (bande 6–8 : le type est écrit
dans la légende et l'infobulle) ; orange et pourpre sous 3:1, d'où la légende.

**Alternatives rejetées** : population ajoutée à `agg/country_year.json`
(modification du noyau sans revue) ; indice sur une année de base (souvent 0
pour les petits pays) ; couleur par type d'attaque des hexagones (un hexagone
mélange les types et perdrait la densité).

**Vérification** : `npm test` (155 tests, dont `population.test.ts` : moyenne
avec années manquantes, taux, seuil d'un million, rampe de couleur), et contrôle
dans le navigateur : morts par million 2013–2017 (Irak 1 297, Afghanistan 818,
Syrie 683, monde 22) ; indice base 100 Irak, France, Nigeria 2010–2017 ;
attentats-suicides Irak 1 874, Nigeria 389, France 6 ; points de l'Irak colorés
par type d'attaque.

## D22. Palette commune, boutons, animations et interactions

**Statut** : adoptée et implémentée le 2026-10-28 sur `feat/Alban_pays` (choix
d'Alban parmi les options proposées). La modification de `src/core/palette.ts`
est **à faire relire par l'équipe** (noyau gelé). Méthode générale :
`docs/methode-ui.md`.

**Décision** :

- **Palette commune** : `src/core/palette.ts` expose `identity` (4 couleurs
  Okabe–Ito non bleues, ordre fixe), `attackTypes` (5 types, ordre validé) et
  `other` (gris), pour que l'atlas, le leaderboard et le flux reprennent les
  mêmes couleurs que la carte. Un test vérifie qu'aucune couleur d'identité
  n'est bleue. Le shell (`src/shell/style.css`) reprend les neutres et l'accent
  de la vue : fond de page presque neutre, onglet actif souligné de l'accent,
  focus visible, bandeau d'avertissement à bordure complète.
- **Boutons icône + texte** : « Lire » / « Pause », « Monde », « Filtres » avec
  le nombre de filtres actifs, « Partager » ; + et − en icônes seules (gestes
  universels) avec un libellé pour les lecteurs d'écran. Icônes maison sur une
  grille de 24 (`src/modules/map/icons.ts`).
- **Filtres repliés** (loi de Hick) : la barre garde lecture, période et
  mesure ; organisation, attentats-suicides, « par million d'habitants » et
  comparaison passent dans un panneau « Filtres et options » (Échap le ferme
  sans vider la sélection, un clic à côté aussi).
- **Animations** : fondu enchaîné de 200 ms des incidents quand la période ou
  un filtre change (annulé si la caméra bouge), glissement de 200 ms du
  contenu du panneau à chaque changement de niveau, fenêtre de la frise qui
  avance en 300 ms pendant la lecture. Tout est coupé par
  `prefers-reduced-motion`.
- **Interactions** : survoler un pays, une organisation ou un incident dans le
  panneau l'allume sur le globe (pays cerné, pays d'action d'une organisation
  grisés, incident entouré) ; « Partager » copie le lien de l'état exact ;
  Espace lance ou arrête la lecture, ? affiche les raccourcis ; un clic sur une
  courbe de pays garde cette année.

**Arguments** : reconnaissance plus rapide des actions fréquentes avec une
icône et un mot ; moins de réglages visibles, décision plus rapide ;
animations qui montrent un changement (et jamais de décor) ; liaison des vues
(*brushing and linking*) ; état partageable pour les journalistes (U1) et la
soutenance.

**Vérification** : `npm test` (156 tests, dont la palette), navigateur :
compteur « Filtres 1 » avec Boko Haram, panneau de filtres et Échap, aide
clavier et Espace, talibans survolés → Afghanistan et Pakistan cernés, clic sur
2014 dans la courbe de l'Irak → période 2014.

## D23. Le site en atlas thématique : page de garde et planches

**Statut** : adoptée et implémentée le 2026-10-29 sur `feat/Alban_pays` (choix
d'Alban, direction « Atlas thématique »). Touche le shell, partagé par
l'équipe : à présenter aux auteurs des trois autres vues.

**Contexte** : le shell était un en-tête à onglets (« Carte par pays »,
« Atlas », « Leaderboard », « Diagramme de flux ») posé sur un fond gris, avec
le nom de la base pour titre. Il ne disait ni le sujet ni ce que chaque vue
permet de comprendre. Demande : un design sobre, fond blanc, qui met en avant
la visualisation et la transmission d'information, ni « site vitrine » ni
« tableau de bord ». Direction choisie : « Atlas thématique »
(`.impeccable/surfaces/src-shell-main-ts.md`).

**Décision** :

- **Une planche par vue, nommée par sa question** (`src/shell/planches.ts`) :
  1 Où ? (carte par pays), 2 Qui ? (leaderboard), 3 Comment ? (diagramme de
  flux), 4 Quoi ? (atlas). L'en-tête porte le titre de l'atlas et les quatre
  folios ; la planche courante est soulignée d'un filet épais, les planches
  encore en squelette d'un pointillé. Les questions des planches 2 à 4 sont à
  confirmer avec leurs auteurs.
- **Page de garde courte** (`src/shell/cover.ts`) : « 181 691 attentats en
  48 ans », une seule phrase avec les chiffres (morts connus, pays touchés) et
  l'année 1993 qui manque, le
  bouton « Ouvrir la planche 1 », la planche 1 en choroplèthe statique
  (incidents par pays sur toute la base, échelle logarithmique, cartouche de
  légende, sept pays les plus touchés étiquetés sans chevauchement), la table
  des planches et la mise en garde sur les changements de méthode de 1998 et
  2012. Le tout tient sur un écran de 1440 × 900. Elle lit les mêmes fichiers
  que les vues.
- **Cadre de planche** : un filet d'encre entoure chaque vue avec son titre
  (numéro et question), le nom de la vue et sa ligne de source ; la citation
  complète et la licence restent en pied de page (D17). Une planche en
  squelette affiche les tâches qu'elle promet (`VIEW_TASKS`) ; l'état brut de
  l'application est replié sous « État partagé (aide au développement) ».
- **Typographie française** (`fr()` dans `src/shell/planches.ts`) : apostrophe
  courbe, espace fine insécable avant ? ! ; et insécable avant :, pour tous les
  textes posés par le shell (pas la citation anglaise de la GTD).
- **Navigation** : la page de garde n'est pas une vue (les `VIEW_IDS` sont
  fixés dans core et le hash vide désigne déjà la carte) ; la page de chaque
  entrée d'historique est gardée dans `history.state`. Changer de planche crée
  une entrée : Retour revient à la planche précédente, puis à la page de
  garde ; un rechargement reste où il était ; un lien partagé ouvre
  directement sa planche. Le focus passe au titre de la nouvelle page.
- **Monde graphique** : papier blanc, encre `#1d1d1b`, filets d'un pixel,
  coins de 2 px au plus, aucune ombre ; une seule famille, Libre Franklin
  (OFL, `@fontsource-variable/libre-franklin`), y compris sur le canevas du
  globe ; gros folios en graisse légère contre des questions en gras. La
  couleur reste aux données (D19 à D22) : les états actifs sont à l'encre, les
  barres de la frise gardent le bleu des données. Un seul mouvement : la
  page tourne (fondu de 200 ms), coupé par `prefers-reduced-motion`.
- **Vue carte** (`map.css`, `globe.ts`, `panel.ts`) : à l'intérieur du cadre,
  le panneau et la frise sont séparés par des filets fins, la légende est un
  cartouche d'encre, les contrôles segmentés sont à l'encre ; le globe a une
  mer plate et un bord d'encre (plus d'éclairage ni d'ombre) ; ses étiquettes
  sont redessinées une fois la police chargée ; le pays survolé s'affiche en
  tête du panneau, dont le bas s'estompe quand il défile ; le fil d'Ariane est
  masqué au niveau monde. Sur téléphone, le globe laisse une bande à ses
  calques au lieu d'être couvert par la légende.

**Arguments** : une question par planche oriente le lecteur vers une tâche
(Munzner, *what–why–how*) avant toute technique ; la page de garde montre
d'emblée une carte qui dit quelque chose, avec sa légende et sa source, comme
une planche d'atlas imprimé ; réserver la couleur aux données garde le seul
signal fort à l'écran pour l'information ; l'historique respecte le geste
Retour du navigateur.

**Vérification** : `npm test` (156 tests), `npm run build` ; navigateur à
1440 × 900 et 390 × 844 : page de garde, planche 1, planche 2 en préparation,
Retour planche 2 → planche 1 → page de garde, pas de défilement horizontal.
Captures dans `.impeccable/review/`.

## D24. Carte de chaleur, zoom sémantique sur la sélection, carte pleine largeur

**Statut** : adoptée et implémentée le 2026-11-02 sur `feat/Alban_pays`, à la
demande d'Alban ; remplace les hexagones de D20 et le calque « Pays » de D19.

**Décision** :

- **Carte de chaleur** (`heat.ts`) à la place des hexagones, à la manière de
  Snap Map : le poids de la mesure (incidents, morts ou blessés) est sommé sur
  une grille d'écran de 3 px, flouté par une gaussienne (trois flous en boîte,
  rayon de 15 px à l'écran), puis coloré du bleu au rouge, l'opacité montant
  avec la densité. Les densités sous 1,5 incident isolé restent transparentes.
  Échelle logarithmique, relative à la vue. En zoomant, les points (un par
  incident) prennent le relais comme avant. L'infobulle somme les incidents
  dans le rayon du flou.
- **Un seul calque** : le sélecteur « Attentats / Pays » est retiré ; la
  sélection des pays se fait sur la carte des attentats elle-même (clic).
- **Zoom sémantique sur la sélection** (`cards.ts`, remplacé par D25) : chaque changement de la
  sélection cadre les pays choisis dans les 58 % gauches de la vue ; chaque pays
  porte une fiche reliée par un filet, rangée en colonne à droite de la
  sélection. Le contenu suit la taille du pays à l'écran : nom, incidents et
  morts (niveau 1) ; blessés, attentats-suicides et part des morts qu'ils
  causent, trois premières organisations (niveau 2, dès 90 px) ; types
  d'attaque, armes et cibles en barres (niveau 3, dès 230 px). Une fiche qui ne
  trouve pas de place descend d'un niveau. `Breakdown` porte désormais les
  totaux des attentats-suicides.
- **Carte pleine largeur** : le panneau latéral est replié par défaut
  (`x.map.panel=open` pour l'ouvrir) et s'ouvre seul pour la fiche d'un
  incident ; au niveau monde, le globe remplit la largeur (pôles coupés) ; les
  contrôles tiennent sur une ligne en haut à droite, avec « Tout
  désélectionner » dès qu'un pays est choisi.

**Points ouverts** : la rampe de chaleur, multicolore et rouge au sommet,
s'écarte de la rampe à une teinte du projet et de l'anti-référence « rouge
sang » de `docs/PRODUCT.md` ; elle a été choisie pour sa lecture immédiate. La
tâche T5 de `src/core/tasks.ts` cite encore « hexbins » (core est figé).

**Vérification** : `npm run typecheck`, `npm test` ; navigateur à 1440 × 900 :
monde, Irak + Syrie, Nigeria zoomé, « Tout désélectionner », panneau replié et
ouvert, fiche d'incident.

## D25. Zoom sémantique : la représentation change sur les pays eux-mêmes

**Statut** : adoptée et implémentée le 2026-11-02 sur `feat/Alban_pays`, à la
demande d'Alban ; remplace les fiches texte de D24 (`cards.ts` supprimé).

**Demande** : en zoomant sur un pays ou en le sélectionnant, la vue doit
changer de mode de représentation, en continuité avec la précédente, et faire
apparaître de nouvelles informations sur les pays, pas sous forme de texte ou
de tableau. La carte doit occuper au moins la moitié de la hauteur de l'écran.

**Décision** : trois lectures le long du zoom (`globe.ts`, `organizations.ts`,
`heat.ts`), chacune répondant à une question, avec les mêmes couleurs d'un
palier à l'autre :

1. **Monde, « où ? »** : la carte de chaleur de D24.
2. **Région ou pays, « qui ? »** (moins de 7 km par pixel, ou 12 km par pixel
   avec une sélection, ce qui est atteint dès qu'on sélectionne un pays) : la
   chaleur se colore par **organisation dominante** (`ClassField` : une densité
   floutée par organisation, chaque pixel prend la couleur de celle qui domine,
   l'opacité suit la densité). Les six organisations les plus actives des pays
   sélectionnés (ou des pays en vue) prennent les couleurs Okabe–Ito ; les
   autres sont en gris, les auteurs inconnus en gris clair. Avec une sélection,
   seuls les pays sélectionnés portent des territoires. Sur chaque pays, des
   **bulles** placées au centre des incidents de chaque organisation : aire =
   incidents en vue, arc noir = part d'attentats-suicides. Survol : incidents,
   morts, suicides, armes ; clic : filtre sur l'organisation.
3. **Attentat, « comment ? »** (moins de 1 500 incidents en vue) : un symbole
   par attentat, de la couleur de son organisation (ou de son type d'attaque),
   de la **forme de son arme** (rond : armes à feu, triangle : explosifs,
   losange : incendiaire, carré : arme blanche, croix : autre), de la taille de
   ses morts, cerclé de noir pour un attentat-suicide. Les territoires restent
   en fond, atténués.

Les pays sélectionnés sont cernés à l'encre et nommés sur la carte (la couleur
d'identité reste dans le panneau). La légende garde les clés et replie leur
mode de lecture sous « Comment lire ».

**Taille** : la scène fait `max(560px, 72vh)` de haut ; la frise suit en
dessous (la page défile un peu). Sélection cadrée au centre, à 80 % de la vue.

**Vérification** : `npm run typecheck`, `npm test` (157), `npm run build` ;
navigateur : Nigeria sélectionné (Boko Haram au nord-est, extrémistes peuls
au centre, MEND dans le delta), zoom jusqu'aux symboles, infobulle d'une bulle.


## D26. Navigation clavier d'un attentat à l'autre, piles d'attentats, marque de sélection

**Statut** : adoptée et implémentée le 2026-11-02 sur `feat/Alban_pays`, à la
demande d'Alban.

**Demande** : plusieurs attentats ont les mêmes coordonnées (7 520 au centre de
Bagdad) ; même au zoom maximum, ils sont superposés et le pointeur ne peut pas
choisir. Les flèches doivent passer d'un attentat à l'autre.

**Décision** (`neighbour.ts`, `globe.ts`) :

- **Les flèches ne tournent plus le globe** (le glisser reste) : elles ouvrent
  l'attentat voisin. Sans attentat ouvert, la première flèche ouvre celui qui
  est le plus proche du centre de la vue. Hors du zoom des attentats, un
  message l'indique.
- **Voisin** : parmi les attentats **dans la vue** (le placement garde une marge
  de 24 px, écartée ici), le plus proche dans le quart de vue (cône de 90°) que
  désigne la flèche ; rien dans le cône : la sélection ne bouge pas.
- **Piles** : des attentats à moins de 2 px (`PILE_PX`) ne se distinguent pas
  par direction. Ils sont parcourus par ordre chronologique (l'identifiant GTD
  commence par la date), droite et bas vers le plus récent, gauche et haut vers
  le plus ancien ; on quitte la pile une fois son bout atteint, et en entrant
  dans une pile on tombe sur le bout d'où l'on vient. **Maj + flèche** sort de la
  pile tout de suite. Un message dit « n sur N au même endroit ».
- **Caméra** : elle ne bouge que si l'attentat arrive à moins de 18 % du bord
  (140 × 90 px au plus), et seulement de la distance qui le ramène. `targetKey`
  est posé avant la sélection pour que `syncCamera` ne vole pas jusqu'à
  l'attentat en zoom profond, comme pour un clic.
- **Marque de sélection** : l'anneau est remplacé par quatre coins de viseur.
  L'anneau noir signifie déjà « attentat-suicide » (et l'anneau de survol du
  panneau garde sa forme) ; les coins ne servent à rien d'autre et ne
  portent pas de couleur, qui est celle de l'organisation. Sur une pile rang et
  taille (« 2/9 ») sont écrits au-dessus.

**Points ouverts** : une pile de plusieurs milliers (Bagdad, toute la période)
se parcourt une touche à la fois ; la frise réduit la période. La touche doit
avoir le focus : la carte l'a après un clic dessus, pas après un lien profond.

**Vérification** : `npm run typecheck`, `npm test` (168, dont 11 pour
`neighbour.ts`) ; navigateur : Irak, pile de 9 attentats à Bagdad parcourue de
1/9 à 9/9 puis quittée, flèches vers un attentat isolé, recentrage au bord.
