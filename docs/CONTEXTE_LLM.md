# Contexte complet du projet « GTD — visualisation interactive »

> **Mode d'emploi** : copier tout ce fichier dans la conversation d'un assistant (LLM) qui ne connaît pas le
> projet, puis poser la question ou la tâche à la suite. Les chiffres et l'état décrits sont ceux du
> 12 octobre 2026 (branche `feat/Alban_pays`) : en cas de doute, le code et `docs/map-decisions.md` font foi.

---

## 0. Ton rôle

Tu es un développeur expérimenté en visualisation de données (D3, TypeScript, Python/pandas) qui rejoint
un projet d'équipe universitaire déjà structuré. Ton travail est de produire du code et des analyses
**justes, cohérents avec l'architecture existante et vérifiés par les tests**.

Règles de conduite :

1. **Lis avant d'écrire.** Avant de modifier un fichier, lis-le, ainsi que le contrat qu'il utilise
   (`src/core/contracts.ts`, `src/core/module.ts`, `src/core/state.ts`). Imite le style du fichier
   (guillemets, nommage, densité de commentaires).
2. **N'invente aucune donnée.** Les chiffres viennent du CSV via le prétraitement. Une valeur inconnue
   n'est jamais 0 (voir §6.4).
3. **Respecte les frontières** (§7). Un test les vérifie : si tu les franchis, `npm test` échoue.
4. **Vérifie.** Après chaque changement : `npm run typecheck`, `npm test`, et `python -m pytest preprocess`
   si tu touches au prétraitement. Pour une vue, ouvre `npm run dev` et regarde le résultat.
5. **Documente les décisions** dans `docs/map-decisions.md` (format en §11) quand tu changes un format de
   données, une règle de lecture ou un choix visuel non évident.
6. **Réponds en français** à l'équipe ; le code et les commentaires sont en anglais, l'interface en français.

---

## 1. Le projet en bref

- **Cours** : Visualisation de données, semestre 9 (S9).
- **Équipe** : plusieurs étudiants ; dépôt GitHub `raph0603/data-visu-GTD`. Alban Maveyraud porte la vue
  « Carte par pays » (branche `feat/Alban_pays`) ; Raphaël Laborie a créé la structure initiale.
  **Une vue par étudiant** : chacun doit pouvoir présenter sa vue seule (une technique de visualisation
  par personne), et les quatre vues doivent se fusionner dans une seule application **sans réécriture**.
- **Sujet** : la Global Terrorism Database (GTD), 181 691 attentats de 1970 à 2017.
- **Livrable** : une application web **statique** (aucun serveur), interactive, construite avec Vite +
  TypeScript + D3 v7, qui lit des fichiers JSON pré-agrégés.
- **Dates** : le noyau `src/core/` est **gelé depuis le 7 octobre** (toute modification passe par une
  revue à deux personnes) ; à partir du **25 octobre** (gel des fonctionnalités), le contrôle de
  couverture des tâches tourne en mode strict (`npm run coverage:tasks:strict`).

---

## 2. Le jeu de données

### 2.1 Source

- Kaggle `START-UMD/gtd`, fichier `globalterrorismdb_0718dist.csv` (163 Mo, 181 691 lignes, 135 colonnes).
- **Encodage Windows-1252 (cp1252)**, pas latin-1 : le fichier contient des guillemets typographiques dans
  la plage 0x80–0x9F (décision D7).
- **Couverture** : 1970–2017, **sauf 1993** (données perdues par la source). 1993 n'est jamais « 0 ».
- Le CSV n'est **jamais commité** : chacun le télécharge dans `data/raw/` (ignoré par git).

### 2.2 Colonnes utilisées (17 sur 135)

Elles ne sont nommées **que** dans `preprocess/gtd_source.py` (table `COLUMNS`, nom neutre → colonne GTD) :

| Nom neutre | Colonne GTD | Remarque |
|---|---|---|
| `event_id` | `eventid` | identifiant (12 chiffres) |
| `year`, `month`, `day` | `iyear`, `imonth`, `iday` | 0 = inconnu pour mois et jour |
| `country`, `region` | `country_txt`, `region_txt` | 205 noms de pays, 12 régions |
| `city`, `latitude`, `longitude` | `city`, `latitude`, `longitude` | coordonnées hors bornes = absentes |
| `killed`, `wounded` | `nkill`, `nwound` | vide = inconnu ; blessés parfois décimaux (8,5) |
| `group` | `gname` | 3 537 valeurs ; « Unknown » = auteur inconnu (45,6 %) |
| `attack_type`, `target_type`, `weapon_type` | `attacktype1_txt`, `targtype1_txt`, `weaptype1_txt` | 9, 22 et 12 catégories |
| `suicide` | `suicide` | 0/1, jamais manquant (6 633 attentats-suicides) |
| `summary` | `summary` | résumé en anglais, absent dans 36 % des cas |

### 2.3 Qualité (calculée et écrite dans `meta.json`)

- Morts connus pour 94,3 % des incidents, blessés pour 91,0 %.
- Groupe inconnu : 45,6 %.
- 4 558 incidents sans coordonnées valides (2,5 %) : exclus des points, comptés partout ailleurs.
- 499 incidents sans pays représentable sur la carte (voir §2.4) : comptés dans le monde et les régions.
- 29 001 incidents marqués « doute sur le caractère terroriste » : **aucun filtre**, tous comptés (D10).

### 2.4 Pays → codes ISO (décision D6, `preprocess/mapping_pays.csv`)

Les 205 noms GTD sont rattachés aux 235 formes dessinables du fond de carte world-atlas 50m (codes ISO
3166-1 alpha-3) :

- `direct` (186) : France → FRA ;
- `successor` (10) : Allemagne de l'Ouest et de l'Est → DEU, Zaïre → COD, Rhodésie → ZWE, Yémen du Nord et du Sud → YEM… ;
- `part_of` (3) : Guadeloupe, Martinique, Guyane → FRA (pas de forme propre dans le 50m) ;
- `not_representable` (6) : URSS, Yougoslavie, Tchécoslovaquie, Serbie-Monténégro, Kosovo, « International ».

Décision ouverte (D11.3) : Porto Rico et les îles Vierges américaines sont étiquetés « United States »
par la GTD et s'affichent à 0 alors que leurs incidents comptent pour les États-Unis.

### 2.5 Licence et citation (D17)

- Licence : EULA de l'Université du Maryland (START), usage **non commercial** de recherche et d'analyse.
- **Citation obligatoire** partout où les données sont montrées (affichée en pied de page par le shell) :
  « National Consortium for the Study of Terrorism and Responses to Terrorism (START), University of
  Maryland. (2018). The Global Terrorism Database (GTD) [Data file]. Retrieved from https://www.start.umd.edu/gtd ».
- **Attention** : publier une visualisation est permis, publier les données elles-mêmes ne l'est pas sans
  accord écrit. Mettre l'application en ligne avec `public/data/gtd/` (incidents et résumés) est à
  valider avant tout déploiement public.

---

## 3. Utilisateurs et tâches (source : `src/core/tasks.ts`, recopié du tableur d'équipe)

### 3.1 Utilisateurs

| Id | Qui | Contexte | Besoin | Niveau |
|---|---|---|---|---|
| U1 | Journalistes de données | Article sur l'évolution du terrorisme dans une région | Tendances et chiffres clés rapides, incidents emblématiques, visuels partageables | À l'aise avec les données, peu de temps |
| U2 | Étudiants et chercheurs | Étudient un conflit, un groupe ou une période | Exploration approfondie, comparaison de périodes et de modes opératoires, filtres fins | Experts, usage long et exploratoire |
| U3 | Analystes d'ONG et d'institutions | Évaluent une zone d'intervention | Zones et cibles les plus touchées, évolution récente, synthèse | Connaissance du terrain |
| U4 | Public curieux | Découverte, contexte éducatif | Vue d'ensemble compréhensible sans formation | Novice |

### 3.2 Tâches

| Id | Tâche | Exemple | Interaction prévue |
|---|---|---|---|
| T1 | Identifier les pays les plus touchés | Quels pays ont eu le plus de morts entre 2013 et 2017 ? | Choroplèthe, tooltip avec rang |
| T2 | Observer une tendance temporelle | Comment la carte évolue-t-elle après 2001 ? | Curseur, Play |
| T3 | Comparer des régions ou des périodes | L'Europe de l'Ouest dans les années 70 vs aujourd'hui ? | Curseur, fenêtre réglable |
| T4 | Changer de point de vue sur l'impact | Beaucoup d'attaques mais peu de morts ? | Sélecteur de métrique |
| T5 | Localiser les zones sensibles d'un pays | Où se concentrent les attaques au Nigeria ? | Zoom, points ou hexbins |
| T6 | Caractériser le mode opératoire | Quelles armes et cibles dominent ? | Bar charts, couleur des points |
| T7 | Identifier les acteurs et leur période d'activité | Quand un groupe est-il devenu dominant ? | Filtre groupe, mini-frise, classement des groupes |
| T8 | Filtrer et corréler | Les attentats-suicides sont-ils plus meurtriers ? | Filtres croisés |
| T9 | Comparer deux périodes d'un pays | Situation plus grave qu'il y a 5 ans ? | Indicateurs avec flèches ↑↓ |
| T10 | Obtenir le détail d'un incident | Que s'est-il passé à cet endroit ? | Fiche au clic |
| T11 | Suivre l'évolution d'un classement | Quels pays étaient en tête dans les années 80 ? | Animation, curseur |
| T12 | Repérer une émergence ou un déclin | À partir de quand un pays entre-t-il dans le top 10 ? | Variation de rang, entité épinglée |

### 3.3 Matrices

**Utilisateurs × tâches** :

| | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | T10 | T11 | T12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| U1 | x | x | | x | | x | | | x | x | x | x |
| U2 | | x | x | | x | x | x | x | | x | | x |
| U3 | x | x | x | x | x | x | x | x | x | | x | x |
| U4 | x | x | | | x | | | | x | x | x | |

**Vues × tâches promises** (`VIEW_TASKS`) :

| Vue | Tâches |
|---|---|
| `map` (Carte par pays) | T1, T3, T4, T9, T12 |
| `atlas` | T2, T5, T7, T8, T10, T12 |
| `leaderboard` | T1, T2, T4, T7, T11, T12 |
| `flow` (Diagramme de flux) | T6, T12 |

Contrôles (`src/core/coverage.ts`, `npm run coverage:tasks`) :

- **erreur** si une vue déclare une tâche hors de sa ligne (`IMPLEMENTED_NOT_PROMISED`) ;
- avertissement si une tâche promise n'est pas livrée ou si une vue a moins de 3 tâches (`flow` n'en a que 2) ;
- information si une tâche n'est couverte que par une vue (T3, T5, T6, T8, T9, T10, T11).

---

## 4. Les quatre vues

Chaque vue est un module dans `src/modules/<vue>/index.ts` qui exporte un `VizModule` (§6.2). Le shell
monte une vue à la fois (onglets), toutes partagent le même état.

### 4.1 `map` — Carte par pays (Alban) : **livrée** (décision D18)

Tableau de bord centré sur les pays, où tout est lié :

- **Barre de filtres** (une ligne au-dessus de tout, collante) : période à deux curseurs avec lecture
  animée, métrique, période de comparaison, type d'attaque, cible, arme, organisation (liste avec
  recherche), attentats-suicides (Tous / Suicide / Hors suicide), réinitialisation, pastilles des filtres
  actifs. Chaque filtre s'applique à **tous** les panneaux.
- **Chiffres clés** : incidents, morts, blessés, morts par incident, organisations nommées actives, avec
  l'évolution par rapport à la comparaison. Une tuile sert aussi de bouton pour changer de métrique.
- **Carte** : choroplèthe en échelle logarithmique ; sélection de **6 pays au plus**, cernés et nommés dans
  leur couleur. Deux couches activables :
  - **incidents exacts** des pays sélectionnés (canvas, taille = morts, infobulle, clic = fiche) ;
  - **liens** : arcs vers les pays où les organisations du pays sélectionné agissent aussi (organisations
    nommées seulement, les étiquettes génériques comme « Gunmen » sont exclues).
- **Pays comparés** : pastilles-légende, recherche pour ajouter un pays, tableau comparatif (valeurs,
  rang, évolution), qui sert aussi de vue accessible.
- **Évolution** : courbes annuelles, une par pays (le monde sans sélection), bande de la période, bande
  de comparaison, 1993 hachurée, réticule avec toutes les valeurs.
- **Modes opératoires** : part de chaque type d'attaque, de cible ou d'arme dans le total de chaque pays.
- **Flux** : diagramme de Sankey attaque → cible → arme (6 catégories par colonne + « Autres »).
- **Classement dynamique** : course de barres année par année, cumulé ou annuel, pays sélectionnés en
  couleur, autres en gris.
- **Organisations** : classement, années d'activité, pays d'action (pastilles cliquables).
- **Incidents** : les 10 plus meurtriers de la sélection avec les filtres ; fiche détaillée avec le
  résumé GTD (chargé au clic) et un bouton « Localiser sur la carte ».

Interactions croisées : cliquer une catégorie (profil, nœud du flux) ou une organisation l'ajoute aux
filtres ; cliquer un pays (carte, classement, lien, pastille) l'ajoute à la comparaison.

Le module ne déclare que T1, T3, T4, T9, T12, mais couvre aussi, pour les pays, T2, T5, T6, T7, T8, T10
et T11. **Décision d'équipe en attente** : étendre la ligne `map` de la matrice, ou laisser ces tâches aux
autres vues. Ne déclare pas une tâche hors matrice : c'est une erreur du contrôle de couverture.

### 4.2 `atlas` : **squelette** (à faire)

Zoom sur l'intérieur d'un pays, incident par incident.
- Tâches promises : T2, T5, T7, T8, T10, T12.
- Données : `incidents/<iso3>.json` (points), `summaries/<iso3>.json` (fiche), `top_events.json`, `cube.json`.
- Pays à afficher : `state.focus` (posé par la carte au clic).
- Idées du tableur : zoom, points ou hexbins (T5), filtre par groupe et mini-frise (T7), filtres croisés,
  dont le suicide (T8), curseur et lecture (T2), fiche au clic (T10).

### 4.3 `leaderboard` : **squelette** (à faire)

Classement animé (bar chart race) de pays, régions ou groupes.
- Tâches promises : T1, T2, T4, T7, T11, T12.
- Données : `agg/country_year.json`, `agg/region_year.json`, `agg/group_year.json` (3 537 groupes,
  « Unknown » compris : à exclure par défaut et à signaler).
- Lit et écrit `state.pinned` (entités épinglées, partagées avec la carte) pour suivre un rang (T12).
- Réglages propres dans `state.ext`, par exemple `ext['leaderboard.top']`.

### 4.4 `flow` — Diagramme de flux : **squelette** (à faire)

Mode opératoire.
- Tâches promises : T6, T12. Il en faut 3 au minimum : T4 (métrique de l'épaisseur) ou T7 (groupes en
  première colonne) seraient naturels.
- Données : `cube.json` (année × pays × attaque × cible × arme × groupe × suicide), qui permet de suivre
  `state.focus` et les filtres.
- Bibliothèque disponible : `d3-sankey`.

---

## 5. Installation et commandes

Prérequis : Node.js (npm), Python 3.11 ou 3.12, un compte Kaggle. Sous Windows, le Python du venv est
`.venv/Scripts/python` (sinon `.venv/bin/python`).

```bash
npm install                                                     # dépendances JS (package-lock.json est commité)
kaggle auth login                                               # une fois (ou token dans ~/.kaggle/)
kaggle datasets download -d START-UMD/gtd -p data/raw --unzip   # → data/raw/globalterrorismdb_0718dist.csv
python -m venv .venv
.venv/Scripts/python -m pip install -r preprocess/requirements.txt
.venv/Scripts/python preprocess/preprocess.py                   # génère public/data/gtd/ (~10 s)
.venv/Scripts/python -m pytest preprocess                       # 30 tests, dont des contrôles sur le vrai CSV
npm test                                                        # vitest : 140 tests (contrats, séries, store, URL, modules, architecture, moteur de la carte…)
npm run typecheck                                               # tsc strict
npm run dev                                                     # http://localhost:5173/#v=map (rechargement à chaud)
npm run build                                                   # → dist/ (statique, base relative)
npm run coverage:tasks                                          # matrices promis / implémenté
```

`public/data/` est **ignoré par git** : après un clone, il faut relancer le prétraitement. Sans fichiers
générés, l'application affiche « Données introuvables » et `contracts.data.test.ts` est sauté.

Défaut connu : `npm run data:download` (`scripts/download-kaggle.mjs`) télécharge dans `public/data/` au
lieu de `data/raw/`. Utiliser la commande `kaggle` ci-dessus.

---

## 6. Architecture

### 6.1 Arborescence

```
data/raw/                         CSV GTD (non commité)
preprocess/                       Python : CSV → JSON
  gtd_source.py                   SEUL endroit où les colonnes GTD sont nommées ; encodage ; citation et licence
  country_mapping.py, mapping_pays.csv   noms GTD → ISO alpha-3 (D6)
  country_geometry.py             formes dessinables du fond de carte
  preprocess.py                   écrit public/data/gtd/ (sortie déterministe)
  size_report.py                  tailles brutes et gzip
  build_iso3166_table.py          génère src/core/iso3166.ts
  test_*.py                       pytest (données synthétiques et vrai CSV)
public/data/gtd/                  fichiers générés (non commités), voir §6.4
src/core/                         NOYAU PARTAGÉ (gelé : revue à deux)
  tasks.ts                        utilisateurs, tâches, matrices
  coverage.ts                     contrôles utilisateurs ↔ tâches ↔ vues ↔ modules
  contracts.ts                    un type + un validateur + une fonction de chargement par fichier JSON
  meta.ts                         DatasetMeta (meta.json + métriques et dimensions affichées), metricValue()
  data.ts                         DataApi : chargement paresseux, validé, mémoïsé
  series.ts                       YearlyIndex : sommes préfixées, fenêtre et moyenne en O(1)
  geo.ts, iso3166.ts              fond de carte world-atlas 50m indexé par ISO alpha-3 ; alpha-3 → alpha-2
  labels.ts                       libellés français des catégories, noms de pays français (Intl.DisplayNames)
  state.ts                        AppState (le seul état partagé), sanitizeState
  store.ts                        store observable (instantanés gelés, partage structurel, anti-cycle)
  hash.ts                         état ↔ #hash de l'URL
  palette.ts                      rampe séquentielle, zéro, hachures « pas de donnée », catégories Okabe–Ito
  module.ts                       contrat VizModule / ModuleContext
  dev/placeholder.ts              module de substitution des vues non écrites
src/modules/<vue>/                un dossier par étudiant : map, atlas, leaderboard, flow
src/modules/index.ts              registre (seul fichier qui importe les modules)
src/shell/                        page hôte : charge le jeu de données, crée le store, onglets, pied de page (citation)
test/                             tests vitest (le noyau a aussi des tests dans src/core/*.test.ts)
scripts/coverage-report.ts        rapport de couverture (charge les modules via le serveur SSR de Vite)
docs/map-decisions.md             journal des décisions D1–D18
```

### 6.2 Flux de données et contrat d'une vue

```
CSV ──preprocess.py──► public/data/gtd/*.json ──contracts.ts (validation)──► DataApi ──► ctx.data
                                         meta.json ──► loadDataset() ──► ctx.dataset (DatasetMeta)
```

Au démarrage, `src/shell/main.ts` charge et valide `meta.json`, crée le store à partir de l'URL, le relie
au hash, puis monte la vue active avec un **contexte** :

```ts
interface ModuleContext {
  store: Store<AppState>;   // état partagé : get / set / subscribe
  dataset: DatasetMeta;     // années, trous (1993), métriques, dimensions, qualité, citation
  data: DataApi;            // countryYear(), regionYear(), groupYear(), topEvents(), cube(), incidents(iso3), summaries(iso3)
  palette: PaletteApi;      // sequential(t), zero, noDataStroke, categorical[6], ensureNoDataPattern(svg)
}
interface VizModule {
  id: 'map' | 'atlas' | 'leaderboard' | 'flow';
  title: string;
  tasks: TaskId[];          // tâches réellement livrées, dans VIEW_TASKS[id]
  mount(host: HTMLElement, ctx: ModuleContext): ModuleHandle | Promise<ModuleHandle>;  // ModuleHandle = { destroy() }
}
```

**Modèle à suivre pour une vue** (c'est ce que vérifie `test/modules.test.ts`, en jsdom et sans données) :

```ts
import type { VizModule } from '../../core/module';

const module: VizModule = {
  id: 'atlas',
  title: 'Atlas',
  tasks: [],                                   // n'y mettre que ce qui est vraiment livré
  mount(host, ctx) {
    const root = host.ownerDocument.createElement('section');
    host.append(root);                         // 1. écrire dans host immédiatement
    let alive = true;
    const render = () => { /* lit ctx.store.get(), dessine dans root */ };
    const offs = [                             // 2. s'abonner tout de suite (subscriberCount > 0 après mount)
      ctx.store.subscribe((s) => s.focus, render),
      ctx.store.subscribe((s) => s.range, render),
    ];
    ctx.data.cube()                            // 3. charger sans bloquer mount ; afficher les erreurs dans root
      .then((cube) => { if (alive) { /* … */ render(); } })
      .catch((e: unknown) => { if (alive) root.textContent = `Données indisponibles : ${String(e)}`; });
    return {
      destroy() {                              // 4. tout retirer : nœuds, abonnements, timers, écouteurs
        alive = false;
        offs.forEach((off) => off());
        root.remove();
      },
    };
  },
};
export default module;
```

Un abonnement par tranche d'état : le store compare par `Object.is`, et une tranche inchangée garde sa
référence. Ne t'abonne pas avec un sélecteur qui crée un nouveau tableau à chaque fois, ou passe
`{ equals: deepEqual }`.

### 6.3 L'état partagé (`AppState`) et l'URL

| Champ | Sens | Paramètre d'URL |
|---|---|---|
| `view` | onglet actif | `v=atlas` |
| `metric` | `incidents`, `killed`, `wounded` ou `lethality` | `m=killed` |
| `range` | période {from, to} inclusive | `t=2013-2017` |
| `compare` | 2e période ou null (T3, T9) | `cmp=2008-2012` |
| `focus` | entité « courante » {dim, id}, ex. {country, NGA} : lue par l'atlas | `f=country:NGA` |
| `pinned` | entités épinglées ; la carte y range ses pays comparés (dim `country`, 6 max) | `p=country:IRQ,country:SYR` |
| `incident` | id de l'incident dont la fiche est ouverte (T10) | `i=201406150063` |
| `filters` | dimension → valeurs (libellés GTD sources, pas les traductions) | `q.attackType=Armed%20Assault&q.suicide=1` |
| `hover` | entité survolée (transitoire, jamais dans l'URL) | — |
| `ext` | réglages propres à une vue, clé `<vue>.<nom>` | `x.map.points=0` |

- Dimensions de filtre reconnues (`DIMENSIONS` dans `meta.ts`) : `country`, `region`, `group`,
  `attackType`, `targetType`, `weaponType`, `suicide` (valeur `"1"` ou `"0"`). Une dimension inconnue
  est retirée par `sanitizeState`.
- Clés `ext` utilisées par la carte : `map.points`, `map.links`, `map.compo`, `map.race`.
- Les instantanés sont gelés : `store.set({ … })`, ou `store.set((s) => ({ … }))` ; jamais de mutation.

### 6.4 Les fichiers de données (`public/data/gtd/`, format dans `contracts.ts`)

Règles communes : chaque fichier porte `schemaVersion: 1` et est **validé au chargement**. Les séries
annuelles sont des tableaux indexés par `année - years.first`, avec **`null` sur les années sans données**
(1993) et une valeur mesurée ailleurs (0 compris). Pour les victimes, on garde `sum` (somme des valeurs
connues) et `known` (nombre d'incidents dont la valeur est connue).

| Fichier | Contenu | Taille gzip | Chargé |
|---|---|---|---|
| `meta.json` | id, titre, citation, licence ; build (empreinte SHA-256 du CSV, encodage) ; années et trous ; lignes (total, sans pays, sans coordonnées) ; qualité | 0,5 Ko | au démarrage |
| `agg/country_year.json` | les 235 pays dessinables (clé ISO alpha-3) : `label`, `region`, `incidents`, `killed {sum, known}`, `wounded {sum, known}`, `withoutCoordinates` ; plus `notRepresentable` | 26 Ko | au démarrage |
| `agg/region_year.json` | même format par région GTD | 4 Ko | au démarrage |
| `agg/group_year.json` | même format par organisation (3 537, clé = nom GTD) | 148 Ko | à la demande |
| `top_events.json` | par pays, les 5 incidents les plus meurtriers de chaque année (le top exact de toute fenêtre s'y trouve) | 262 Ko | à la demande |
| `cube.json` | 60 014 combinaisons année × pays × attaque × cible × arme × organisation × suicide, en colonnes avec dictionnaires ; mesures `incidents`, `killedSum/Known`, `woundedSum/Known` ; pays `""` = non représentable | 290 Ko | à la demande |
| `incidents/<iso3>.json` | incidents géolocalisés d'un pays, en colonnes : `eventId`, `year`, `month`, `day`, `latitude`, `longitude`, `city`, codes vers les dictionnaires `attackType`, `targetType`, `weaponType`, `group`, puis `killed`, `wounded` (null = inconnu) et `suicide` | 2,5 Mo pour les 235 (Irak : 238 Ko) | au zoom sur un pays |
| `summaries/<iso3>.json` | `{eventId: résumé}` pour tous les incidents du pays qui en ont un | 6,4 Mo pour les 235 (Irak : 975 Ko) | au clic sur une fiche |

Chargement initial : 261 Ko gzip, géométrie comprise, soit 12,8 % d'un budget de 2 Mo.

### 6.5 Sémantique des valeurs (à respecter partout)

- **NaN = pas de donnée** : fenêtre composée uniquement d'années sans données, ou incidents dont aucune
  valeur de victimes n'est connue. **0 = zéro mesuré.**
- La vue les encode différemment : `palette.zero` (gris très clair) pour 0, hachures
  (`palette.ensureNoDataPattern`) pour « pas de donnée ».
- `YearlyIndex` (`series.ts`) : `window(clé, métrique, de, à)`, `value`, `mean` (morts ÷ valeurs connues,
  jamais une moyenne de moyennes annuelles), `knownShare`. `metricValue(index, metricDef, …)` dans
  `meta.ts` lit n'importe quelle métrique, y compris `lethality`.
- Métrique « morts par incident » : la carte ne classe que les pays d'au moins 10 incidents sur la
  fenêtre (`MIN_INCIDENTS_FOR_MEAN`) ; elle les colore tous.

### 6.6 Couleurs et accessibilité

- Grandeur : une seule teinte (`palette.sequential(t)`, Blues), de clair à foncé ; échelle log pour les
  comptes très asymétriques.
- Identité : les 6 couleurs Okabe–Ito de `palette.categorical`, **jamais une 7e générée**. La couleur
  suit l'entité, pas son rang. Elles ont été vérifiées avec un validateur de daltonisme :
  - l'écart rose ↔ vert sous deutéranopie tombe dans la bande 6–8, ce qui impose un encodage secondaire
    (le nom affiché à côté) ;
  - l'orange et le bleu ciel ont un contraste inférieur à 3:1, ce qui impose des étiquettes ou un tableau.
- Le texte n'est jamais coloré avec la couleur des séries ; un repère coloré (pastille, trait) l'accompagne.
- Pas de double axe. Les infobulles complètent mais ne remplacent pas : chaque valeur doit aussi être
  lisible ailleurs (tableau, étiquette).

---

## 7. Règles imposées par les tests (`test/architecture.test.ts`, `test/modules.test.ts`, `test/coverage.test.ts`)

1. Un module n'importe que `src/core/` et **son propre dossier** : jamais un autre module, jamais `src/shell/`.
2. **Aucun nom de colonne GTD** (`iyear`, `nkill`, `gname`, `country_txt`…) dans `src/` : ils n'existent
   que dans `preprocess/gtd_source.py`. Seuls `latitude` et `longitude` sont permis, parce que ce sont
   aussi les noms neutres du contrat.
3. Un module n'écrit que dans `host` ; `destroy()` retire nœuds, écouteurs, timers et abonnements
   (`host` vide et `subscriberCount() === 0` après `destroy`).
4. L'état ne se modifie que par `ctx.store` ; les instantanés sont gelés.
5. Un réglage propre à une vue passe par `state.ext["<vue>.<nom>"]` : pas de modification de `state.ts`.
6. Zéro mesuré ≠ pas de donnée (§6.5).
7. `tasks` d'un module ⊂ `VIEW_TASKS[id]` (sinon erreur `IMPLEMENTED_NOT_PROMISED`).
8. `tsconfig` strict : `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`,
   `verbatimModuleSyntax`, `noImplicitOverride`. Un accès `tableau[i]` est de type `T | undefined` :
   utilise `?? valeur`.

---

## 8. Ajouter ou modifier des données (toujours ce chemin en 4 étapes)

1. **Prétraitement** : nommer la colonne dans `gtd_source.COLUMNS`, calculer et écrire le fichier dans
   `preprocess.py`. La sortie doit rester **déterministe** : clés triées, aucun horodatage. Un test relance
   le script dans un autre processus et compare les empreintes.
2. **Contrat** : dans `src/core/contracts.ts`, ajouter le type, le validateur (`parseXxx`, qui échoue avec
   le chemin du champ fautif) et la fonction de chargement (`fetchXxx`).
3. **Tests** : cas synthétiques dans `preprocess/test_preprocess.py` et `src/core/contracts.test.ts` ;
   contrôle sur le vrai CSV (totaux = 181 691 incidents, 411 868 morts connus) ; validation des fichiers
   réels dans `src/core/contracts.data.test.ts`.
4. **Accès** : exposer le fichier dans `DataApi` (`src/core/data.ts`), puis mettre à jour les modules
   factices des tests (`test/modules.test.ts`).

Puis lancer `size_report.py` et documenter la décision. Toute modification de `src/core/` exige une revue
à deux personnes.

---

## 9. Organisation interne de la vue `map` (pour qui y travaille)

`src/modules/map/` (≈ 3 300 lignes) :

| Fichier | Rôle |
|---|---|
| `index.ts` | assemble la vue : chargement (fond de carte, `countryYear`, `cube`), mise en page, abonnements, rendu regroupé (microtâche), `destroy` |
| `model.ts` | **moteur de calcul** sur `cube.json` : filtres → masque, table pays × année, totaux de fenêtre, séries, `scan()` (répartitions, flux, organisation × pays, années d'activité), `metricOf` (même sémantique que `YearlyIndex`), `isNamedGroup` (étiquettes génériques) |
| `frame.ts` | `Env` (constantes après chargement) et `Frame` (tout ce qui découle d'un état : valeurs par pays, classement, couleurs de la sélection, scan, totaux) |
| `selection.ts` | sélection dans `state.pinned` (6 max), `toggleCountry`, `SlotKeeper` (couleur stable) |
| `filterbar.ts` | barre de filtres, curseurs de période, lecture animée |
| `worldmap.ts` | carte : projection Equal Earth, choroplèthe, contours et noms, liens, points en canvas avec quadtree pour le survol, zoom sur la sélection, légende |
| `incidents.ts` | chargement des fichiers d'incidents, projection unique, visibilité filtrée et mise en cache |
| `kpis.ts`, `compare.ts`, `timeseries.ts`, `composition.ts`, `sankey.ts`, `race.ts`, `groups.ts`, `incidentpanel.ts` | les panneaux |
| `ui.ts` | carte de panneau, infobulle unique, liste multi-sélection avec recherche |
| `format.ts` | formats français (nombres, parts, périodes, évolutions) |
| `model.test.ts` | tests du moteur |
| `map.css` | styles (préfixe `cv-`) |

---

## 10. État au 12 octobre 2026 et points ouverts

- **Branche** `feat/Alban_pays` (base `main`) ; derniers commits : fusion de l'architecture, première
  version de la carte. Le tableau de bord de la carte (D18) et le cube (D14) ne sont **pas encore commités**.
- **Fait** : architecture, prétraitement complet (tous les fichiers du §6.4), vue carte. Côté tests :
  140 tests vitest et 30 tests pytest au vert.
- **À faire** : vues `atlas`, `leaderboard`, `flow`.
- **Décisions d'équipe en attente** :
  1. étendre ou non la ligne `map` de la matrice (§4.1) ;
  2. la troisième tâche de `flow` ;
  3. Porto Rico et les îles Vierges (D11.3) ;
  4. la publication en ligne des données au regard de la licence (D17) ;
  5. la revue à deux des changements du noyau (`contracts.ts`, `data.ts`, `meta.ts`, `labels.ts`, `iso3166.ts`).
- **Améliorations possibles** :
  - un bouton « Tableau » sur chaque graphique (vue accessible complète) ;
  - un mode « couleur des points par type d'attaque » sur la carte ;
  - un mode sombre (le shell est clair seulement) ;
  - corriger le dossier de sortie de `scripts/download-kaggle.mjs`.

---

## 11. Conventions

- **Langues** : interface en français ; code, noms et commentaires en anglais ; documentation d'équipe et
  journal des décisions en français.
- **Style** : suivre le fichier modifié (le noyau issu de la phase 1 utilise des guillemets simples, les
  fichiers de contrat et de prétraitement des guillemets doubles). Commentaires rares : ils expliquent le
  pourquoi, pas le quoi.
- **Commits** : style conventionnel, par exemple `feat(map): …`, `fix(preprocess): …`, `test(core): …`,
  `docs: …`. Ne jamais commiter `data/raw/`, `public/data/`, `.venv/` ni `.env`.
- **Journal des décisions** (`docs/map-decisions.md`) : une entrée `## Dn. Titre` avec **Statut** (date),
  **Décision**, **Arguments** chiffrés, **Alternatives rejetées**, **Vérification** (commande ou test).
- **Avant de rendre** : `npm run typecheck`, `npm test`, `npm run coverage:tasks`, et pytest si le
  prétraitement a changé. Pour une vue : la regarder dans le navigateur, avec et sans sélection, avec des
  filtres, sur une année sans données (1993) et avec la métrique « morts par incident ».

---

*Fin du contexte. Pose maintenant ta question ou décris la tâche.*
