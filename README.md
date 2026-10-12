# GTD — visualisation interactive (Phase 1 : architecture)

Application statique Vite + TypeScript + D3 v7. Quatre vues indépendantes (carte par pays, atlas, leaderboard, diagramme de flux) qui partagent un état, une palette et un contrat de données. Chaque vue doit pouvoir être présentée seule (une technique par étudiant) et fusionnée sans réécriture.

## Commandes

```bash
npm install
npm run dev               # shell intégré, http://localhost:5173/#v=map
npm test                  # vitest : store, hash, séries, couverture, chargeur, palette, modules, architecture
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
  contracts.ts       un type par fichier JSON (meta, agg/<dim>_year, top_events, incidents/<id>, flow)
  meta.ts            validation runtime de meta.json (erreurs avec chemin du champ fautif)
  state.ts           AppState (le seul état partagé), valeurs par défaut, sanitizeState
  store.ts           store observable typé (immuable, gelé, partage structurel, anti-cycle)
  hash.ts            codec état ↔ #hash et liaison replaceState/hashchange
  data.ts            DataApi : chargement paresseux, typé, mémoïsé
  series.ts          YearlyIndex : sommes préfixées, sémantique zéro / pas de donnée
  palette.ts         rampe séquentielle, zéro, hachures « pas de donnée », catégories Okabe–Ito
  module.ts          contrat VizModule / ModuleContext
  dev/placeholder.ts module de substitution (à supprimer quand plus utilisé)
src/modules/<vue>/   un dossier par étudiant : map, atlas, leaderboard, flow
src/modules/index.ts registre (seul fichier autorisé à importer les dossiers de modules)
src/shell/           page hôte : charge le dataset, possède le store, monte un module à la fois
src/datasets/        (Phase 2) adaptateur de colonnes par dataset : seul endroit où un nom de colonne source peut apparaître
public/data/<id>/    fichiers JSON générés (Phase 2) ; meta.json fourni ici en version « dev-stub »
test/                tests unitaires et règles d'architecture
```

## Règles (vérifiées par les tests)

1. Un module n'importe que `src/core/` et son propre dossier (jamais un autre module, jamais `shell/`).
2. Aucun nom de colonne source en dur hors de `src/datasets/` : tout passe par `ctx.dataset` et `ctx.data`.
3. Un module écrit dans `host` uniquement ; `destroy()` retire nœuds, écouteurs, timers et abonnements.
4. L'état partagé se lit et s'écrit par `ctx.store` ; les instantanés sont gelés (muter lève une `TypeError`).
5. Un réglage propre à une vue passe par `state.ext["<vue>.<nom>"]` (sérialisé dans l'URL) : pas de modification de `core`.
6. Zéro mesuré ≠ pas de donnée : `YearlyIndex.value` renvoie `0` ou `NaN`, la vue encode les deux différemment (`palette.zero` vs hachures).

## Remplacer un squelette par la vraie vue

`src/modules/<vue>/index.ts` exporte aujourd'hui `placeholderModule('<vue>')`. Exporter à la place un `VizModule` :

```ts
import type { VizModule } from '../../core/module';

const module: VizModule = {
  id: 'map',
  title: 'Carte par pays',
  tasks: ['T1'], // tâches réellement livrées ; doit rester dans VIEW_TASKS.map
  mount(host, ctx) {
    const off = ctx.store.subscribe((s) => s.range, () => render());
    render();
    return { destroy: () => { off(); host.replaceChildren(); } };
  },
};
export default module;
```

## Décisions d'architecture (Phase 1)

| Décision | Raison | Alternative écartée |
|---|---|---|
| Un seul paquet, frontières imposées par test | quatre configurations de build en moins ; la règle « un module n'importe que core » se vérifie par un test | npm workspaces : 4 `package.json`/`tsconfig`, hoisting à gérer, aucune garantie de plus |
| Store maison de ~100 lignes | état de 10 clés, pas de dépendance, comportements précis (gel, partage structurel, garde anti-cycle) testés | RxJS (dépendance lourde pour 10 clés), `d3.dispatch` (événements non typés, pas d'instantané), Redux (réducteurs superflus) |
| Notification synchrone et réentrante, plafonnée à 32 cycles | le brushing & linking croisé entre 4 modules peut boucler ; mieux vaut une erreur nette qu'un onglet figé | notification en microtâche : ordre non déterministe, tests plus lourds |
| `ext` pour l'état local de chaque vue | évite que 4 étudiants éditent `state.ts` en même temps | un type d'état par module : fusion de types et conflits garantis |
| Hash d'URL par `replaceState` débouncé (150 ms) | un curseur déclenche des dizaines d'écritures ; les navigateurs limitent l'API historique ; pas d'écho `hashchange` | `location.hash =` (écho et entrées d'historique), `pushState` (bouton retour inutilisable), localStorage (non partageable) |
| Contrats JSON versionnés, colonnaires pour les incidents | tableaux alignés et codes de dictionnaire : pas de clés répétées à chaque ligne, chargement par pays (gain à mesurer en Phase 2 sur les vrais volumes) | JSON d'objets par ligne : trop lourd pour l'Irak ou le Pakistan |
| Sommes préfixées par entité (`YearlyIndex`) | une fenêtre = 2 lectures par entité ; une métrique de moyenne = rapport de deux sommes de fenêtre | rebalayer 181 700 lignes par tick de curseur ; moyenne des moyennes annuelles (fausse) |
| `NaN` = pas de donnée, `0` = zéro mesuré | sans cela 1993 ou « morts inconnus » s'afficheraient comme « aucun mort » | `0` partout : biais silencieux |
| Palette commune : rampe monotone en luminosité, zéro distinct, hachures pour pas de donnée | la valeur (Bertin) est la variable la plus fiable pour une grandeur ordonnée ; motif + couleur résiste au daltonisme | arc-en-ciel (non monotone), couleur seule pour « pas de donnée » |

## État de la Phase 1

Le shell tourne avec quatre squelettes qui affichent l'état partagé. `public/data/gtd/meta.json` est un descripteur de développement (`build.kind = "dev-stub"`, `citation` et `license` à null jusqu'à vérification sur la page Kaggle, pas de rapport de qualité). Les fichiers agrégés sont produits en Phase 2.
