/**
 * Source of truth for users, tasks and the task × view / task × user coverage matrices.
 * Transcribed from the team spreadsheet (2026-10-05). When the spreadsheet changes, change it here:
 * `npm run coverage:tasks` and test/coverage.test.ts check this file against the modules.
 */

export const VIEW_IDS = ['map', 'atlas', 'leaderboard', 'flow'] as const;
export type ViewId = (typeof VIEW_IDS)[number];

export const VIEW_LABELS: Readonly<Record<ViewId, string>> = {
  map: 'Carte par pays',
  atlas: 'Atlas',
  leaderboard: 'Leaderboard',
  flow: 'Diagramme de flux',
};

export const USER_IDS = ['U1', 'U2', 'U3', 'U4'] as const;
export type UserId = (typeof USER_IDS)[number];

export const TASK_IDS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'] as const;
export type TaskId = (typeof TASK_IDS)[number];

export interface UserProfile {
  readonly id: UserId;
  readonly label: string;
  readonly context: string;
  readonly need: string;
  readonly level: string;
}

export const USERS: readonly UserProfile[] = [
  {
    id: 'U1',
    label: 'Journalistes de données',
    context: "Préparent un article sur l'évolution du terrorisme dans une région",
    need: 'Tendances et chiffres clés rapides, incidents emblématiques à citer, visuels partageables',
    level: 'À l’aise avec les données, peu de temps',
  },
  {
    id: 'U2',
    label: 'Étudiants et chercheurs',
    context: 'Étudient un conflit, un groupe ou une période',
    need: 'Exploration approfondie, comparaison de périodes et de modes opératoires, filtres fins',
    level: 'Experts du domaine, usage long et exploratoire',
  },
  {
    id: 'U3',
    label: "Analystes d'ONG et d'institutions",
    context: "Évaluent la situation d'une zone d'intervention",
    need: 'Zones et cibles les plus touchées, évolution récente, synthèse',
    level: 'Connaissance du terrain, besoin de synthèse',
  },
  {
    id: 'U4',
    label: 'Public curieux',
    context: 'Découverte, contexte éducatif',
    need: "Vue d'ensemble compréhensible sans formation",
    level: 'Novice',
  },
];

export interface TaskDef {
  readonly id: TaskId;
  readonly label: string;
  readonly example: string;
  /** Interaction named in the team table; the Playwright tests and the demo script reuse the task id. */
  readonly interaction: string;
  /** "Vue" column of the first task table (V1 = map family, V2 = ranking family). Legacy, kept for traceability. */
  readonly origin: string;
}

export const TASKS: readonly TaskDef[] = [
  { id: 'T1', label: 'Identifier les pays les plus touchés', example: 'Quels pays ont eu le plus de morts entre 2013 et 2017 ?', interaction: 'Choroplèthe, tooltip avec rang', origin: 'V1 monde' },
  { id: 'T2', label: 'Observer une tendance temporelle', example: 'Comment la carte évolue-t-elle après 2001 ?', interaction: 'Curseur, Play', origin: 'V1 monde' },
  { id: 'T3', label: 'Comparer des régions ou des périodes', example: "L'Europe de l'Ouest dans les années 70 vs aujourd'hui ?", interaction: 'Curseur, fenêtre réglable', origin: 'V1 monde' },
  { id: 'T4', label: "Changer de point de vue sur l'impact", example: 'Beaucoup d’attaques mais peu de morts ?', interaction: 'Sélecteur de métrique', origin: 'V1, V2' },
  { id: 'T5', label: "Localiser les zones sensibles d'un pays", example: 'Où se concentrent les attaques au Nigeria ?', interaction: 'Zoom, points ou hexbins', origin: 'V1 pays' },
  { id: 'T6', label: 'Caractériser le mode opératoire', example: 'Quelles armes et cibles dominent ?', interaction: 'Bar charts, couleur des points', origin: 'V1 pays' },
  { id: 'T7', label: 'Identifier les acteurs et leur période d’activité', example: 'Quand un groupe est-il devenu dominant ?', interaction: 'Filtre groupe, mini-frise, classement des groupes', origin: 'V1 pays, V2' },
  { id: 'T8', label: 'Filtrer et corréler', example: 'Les attentats-suicides sont-ils plus meurtriers ?', interaction: 'Filtres croisés', origin: 'V1 pays' },
  { id: 'T9', label: "Comparer deux périodes d'un pays", example: "Situation plus grave qu'il y a 5 ans ?", interaction: 'Indicateurs avec flèches ↑↓', origin: 'V1 pays' },
  { id: 'T10', label: "Obtenir le détail d'un incident", example: "Que s'est-il passé à cet endroit ?", interaction: 'Fiche au clic', origin: 'V1 incident' },
  { id: 'T11', label: "Suivre l'évolution d'un classement", example: 'Quels pays étaient en tête dans les années 80 ?', interaction: 'Animation, curseur', origin: 'V2' },
  { id: 'T12', label: 'Repérer une émergence ou un déclin', example: 'À partir de quand un pays entre-t-il dans le top 10 ?', interaction: 'Indicateur de variation de rang, entité épinglée', origin: 'V2' },
];

/** Matrice utilisateurs × tâches (tableur, bloc du haut). */
export const USER_TASKS: Readonly<Record<UserId, readonly TaskId[]>> = {
  U1: ['T1', 'T2', 'T4', 'T6', 'T9', 'T10', 'T11', 'T12'],
  U2: ['T2', 'T3', 'T5', 'T6', 'T7', 'T8', 'T10', 'T12'],
  U3: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T11', 'T12'],
  U4: ['T1', 'T2', 'T5', 'T9', 'T10', 'T11'],
};

/** Matrice vues × tâches (tableur, bloc du bas). */
export const VIEW_TASKS: Readonly<Record<ViewId, readonly TaskId[]>> = {
  map: ['T1', 'T3', 'T4', 'T9', 'T12'],
  atlas: ['T2', 'T5', 'T7', 'T8', 'T10', 'T12'],
  leaderboard: ['T1', 'T2', 'T4', 'T7', 'T11', 'T12'],
  flow: ['T6', 'T12'],
};
