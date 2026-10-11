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
