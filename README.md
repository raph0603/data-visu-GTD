# GTD — visualisation interactive

Application statique Vite + TypeScript + D3 v7. Quatre vues indépendantes (carte par pays, atlas, leaderboard, diagramme de flux) qui partagent un état, une palette et un contrat de données. Chaque vue doit pouvoir être présentée seule (une technique par étudiant) et fusionnée sans réécriture.

Les données ne sont jamais lues brutes par le navigateur : `preprocess/preprocess.py` lit une fois le CSV de la GTD et écrit des fichiers JSON agrégés dans `public/data/gtd/`, au format de `src/core/contracts.ts`.

## Données : récupérer et générer

Ni le CSV (`data/raw/`) ni les fichiers générés (`public/data/`) ne sont commités : chacun les produit après un clone.

1. **Télécharger le CSV** dans `data/raw/` (compte Kaggle requis ; `kaggle auth login` une fois) :

   ```bash
   kaggle datasets download -d START-UMD/gtd -p data/raw --unzip
   ```

   On doit obtenir `data/raw/globalterrorismdb_0718dist.csv` (163 Mo, 181 691 lignes).

2. **Installer l'environnement Python** (une fois) :

   ```bash
   python -m venv .venv
   .venv/Scripts/python -m pip install -r preprocess/requirements.txt   # Windows ; .venv/bin/python ailleurs
   ```

3. **Générer `public/data/gtd/`** (environ 10 s) puis vérifier :

   ```bash
   .venv/Scripts/python preprocess/preprocess.py
   .venv/Scripts/python -m pytest preprocess
   npm test                  # inclut src/core/contracts.data.test.ts sur les fichiers générés
   ```

Sans fichiers générés, `npm run dev` affiche « Données introuvables » avec la commande à lancer, et `contracts.data.test.ts` est sauté avec son motif.

## Commandes

```bash
npm install
npm run dev               # shell intégré, http://localhost:5173/#v=map
npm test                  # vitest : contrats, séries, géométrie, store, hash, couverture, chargeur, palette, modules, architecture
npm run typecheck         # tsc strict (noUncheckedIndexedAccess, verbatimModuleSyntax)
npm run build             # tsc + vite build → dist/ (statique, base relative)
npm run coverage:tasks    # matrices utilisateurs/vues × tâches, promis vs implémenté
npm run coverage:tasks:strict   # idem, échoue aussi sur les avertissements (à lancer dès le gel du 25 oct.)
```

## Arborescence et propriété

```
src/core/            figé le 7 oct. ; modification par revue à 2 personnes
  tasks.ts           utilisateurs U1–U4, tâches T1–T12, matrices (source de vérité = tableur d'équipe)
  coverage.ts        contrôle de cohérence utilisateurs ↔ tâches ↔ vues ↔ modules
  contracts.ts       un type, un validateur et un chargeur par fichier JSON (meta, agg/country_year,
                     agg/region_year, agg/group_year, top_events, flow, incidents/<iso3>, summaries/<iso3>) ;
                     écrits par preprocess/preprocess.py
  meta.ts            DatasetMeta = meta.json validé + vocabulaire des vues (métriques dont « morts par
                     incident », dimensions) ; metricValue() pour lire n'importe quelle métrique
  data.ts            DataApi : chargement paresseux, validé, mémoïsé (au-dessus des chargeurs de contracts.ts)
  series.ts          YearlyIndex : sommes préfixées, fenêtre et moyenne en O(1), sémantique zéro / pas de donnée
  geo.ts, iso3166.ts fond de carte world-atlas 50m indexé par code ISO alpha-3
  state.ts           AppState (le seul état partagé), valeurs par défaut, sanitizeState
  store.ts           store observable typé (immuable, gelé, partage structurel, anti-cycle)
  hash.ts            codec état ↔ #hash et liaison replaceState/hashchange
  palette.ts         rampe séquentielle, zéro, hachures « pas de donnée », catégories Okabe–Ito
  module.ts          contrat VizModule / ModuleContext
  dev/placeholder.ts module de substitution (à supprimer quand plus utilisé)
src/modules/<vue>/   un dossier par étudiant : map, atlas, leaderboard, flow
src/modules/index.ts registre (seul fichier autorisé à importer les dossiers de modules)
src/shell/           page hôte : charge le dataset, possède le store, monte un module à la fois
preprocess/          Python : lecture du CSV, table des pays (mapping_pays.csv), écriture des JSON, tests pytest
  gtd_source.py      seul endroit où un nom de colonne source de la GTD apparaît
docs/map-decisions.md journal des décisions D1–D11 (fond de carte, codes ISO, encodage, contrat, preprocess, tailles)
public/data/<id>/    fichiers JSON générés (non commités)
test/                tests unitaires et règles d'architecture (les tests de core sont aussi dans src/core/*.test.ts)
```

## Règles (vérifiées par les tests)

1. Un module n'importe que `src/core/` et son propre dossier (jamais un autre module, jamais `shell/`).
2. Aucun nom de colonne source en dur dans `src/` : il n'apparaît que dans `preprocess/gtd_source.py` ; les vues passent par `ctx.dataset` et `ctx.data`.
3. Un module écrit dans `host` uniquement ; `destroy()` retire nœuds, écouteurs, timers et abonnements.
4. L'état partagé se lit et s'écrit par `ctx.store` ; les instantanés sont gelés (muter lève une `TypeError`).
5. Un réglage propre à une vue passe par `state.ext["<vue>.<nom>"]` (sérialisé dans l'URL) : pas de modification de `core`.
6. Zéro mesuré ≠ pas de donnée : les fichiers portent `null` sur les années sans données (1993), `YearlyIndex.window` renvoie `0` ou `NaN`, et la vue encode les deux différemment (`palette.zero` vs hachures).

## Remplacer un squelette par la vraie vue

`src/modules/<vue>/index.ts` exporte aujourd'hui `placeholderModule('<vue>')`. Exporter à la place un `VizModule` :

```ts
import type { VizModule } from '../../core/module';
import { YearlyIndex } from '../../core/series';

const module: VizModule = {
  id: 'map',
  title: 'Carte par pays',
  tasks: ['T1'], // tâches réellement livrées ; doit rester dans VIEW_TASKS.map
  async mount(host, ctx) {
    const index = new YearlyIndex(await ctx.data.countryYear());
    const render = () => {
      const { metric, range } = ctx.store.get();
      // index.window('NGA', metric, range.from, range.to) → nombre, 0 ou NaN
    };
    // Un abonnement par tranche : chacune garde sa référence tant qu'elle ne change pas.
    const offs = [ctx.store.subscribe((s) => s.metric, render), ctx.store.subscribe((s) => s.range, render)];
    render();
    return { destroy: () => { offs.forEach((off) => off()); host.replaceChildren(); } };
  },
};
export default module;
```

## Décisions d'architecture

Les décisions sur les données (fond de carte, correspondance des pays, encodage, format des fichiers, preprocess, tailles mesurées) sont dans [`docs/map-decisions.md`](docs/map-decisions.md).

| Décision | Raison | Alternative écartée |
|---|---|---|
| Un seul paquet, frontières imposées par test | quatre configurations de build en moins ; la règle « un module n'importe que core » se vérifie par un test | npm workspaces : 4 `package.json`/`tsconfig`, hoisting à gérer, aucune garantie de plus |
| Store maison de ~100 lignes | état de 10 clés, pas de dépendance, comportements précis (gel, partage structurel, garde anti-cycle) testés | RxJS (dépendance lourde pour 10 clés), `d3.dispatch` (événements non typés, pas d'instantané), Redux (réducteurs superflus) |
| Notification synchrone et réentrante, plafonnée à 32 cycles | le brushing & linking croisé entre 4 modules peut boucler ; mieux vaut une erreur nette qu'un onglet figé | notification en microtâche : ordre non déterministe, tests plus lourds |
| `ext` pour l'état local de chaque vue | évite que 4 étudiants éditent `state.ts` en même temps | un type d'état par module : fusion de types et conflits garantis |
| Hash d'URL par `replaceState` débouncé (150 ms) | un curseur déclenche des dizaines d'écritures ; les navigateurs limitent l'API historique ; pas d'écho `hashchange` | `location.hash =` (écho et entrées d'historique), `pushState` (bouton retour inutilisable), localStorage (non partageable) |
| Contrat de données validé au chargement (D8) | une erreur du preprocess apparaît avec le fichier et le champ fautif au lieu de produire une carte fausse | faire confiance aux fichiers : erreurs silencieuses |
| Sommes préfixées par entité (`YearlyIndex`, D9) | une fenêtre = 2 lectures par entité ; le rang du tooltip et la variation de rang demandent tous les pays à chaque tick | rebalayer les années à chaque requête |
| `null` = pas de donnée dans les fichiers, `NaN` dans `YearlyIndex`, `0` = zéro mesuré | sans cela 1993 ou « morts inconnus » s'afficheraient comme « aucun mort » | `0` partout : biais silencieux |
| Palette commune : rampe monotone en luminosité, zéro distinct, hachures pour pas de donnée | la valeur (Bertin) est la variable la plus fiable pour une grandeur ordonnée ; motif + couleur résiste au daltonisme | arc-en-ciel (non monotone), couleur seule pour « pas de donnée » |

## État

- **Données** : tous les fichiers des quatre vues sont produits et validés (pytest sur le vrai CSV, `contracts.data.test.ts` sur les fichiers générés) :

  | Fichier | Pour | Chargé |
  |---|---|---|
  | `meta.json`, `agg/country_year.json`, `agg/region_year.json` | toutes les vues | au démarrage |
  | `agg/group_year.json` (D13) | leaderboard, T7 | à la demande |
  | `top_events.json` | atlas, journalistes | à la demande |
  | `flow.json` (D14) | diagramme de flux, T6 | à la demande |
  | `incidents/<iso3>.json` (avec `suicide`, D15) | atlas, T5 T8 | au zoom sur un pays |
  | `summaries/<iso3>.json` (D12) | fiche incident, T10 | au clic |

- **Carte par pays** : livrée pour T1, T3, T4, T9, T12 (choroplèthe en échelle log., tooltip avec rang, fenêtre réglable, période de comparaison, fiche pays avec évolution et courbe annuelle, top 10 avec variations de rang).
- **Atlas, leaderboard, flux** : squelettes.
- **Décisions ouvertes** : Porto Rico et îles Vierges (D11.3) ; publication en ligne des fichiers de données (D17).
