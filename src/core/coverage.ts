import { TASK_IDS, USER_IDS, VIEW_IDS, type TaskId, type UserId, type ViewId } from './tasks';

export type IssueLevel = 'error' | 'warning' | 'info';

export interface CoverageIssue {
  readonly level: IssueLevel;
  readonly code:
    | 'TASK_NO_VIEW'
    | 'TASK_NO_USER'
    | 'VIEW_BELOW_MIN'
    | 'TASK_SINGLE_VIEW'
    | 'IMPLEMENTED_NOT_PROMISED'
    | 'PROMISED_NOT_IMPLEMENTED';
  readonly message: string;
}

export interface CoverageInput {
  /** Who needs which task (spreadsheet, top block). */
  readonly userTasks: Readonly<Record<UserId, readonly TaskId[]>>;
  /** Which view promises which task (spreadsheet, bottom block). */
  readonly viewTasks: Readonly<Record<ViewId, readonly TaskId[]>>;
  /** What each module declares as implemented (VizModule.tasks). */
  readonly implemented: Readonly<Record<ViewId, readonly TaskId[]>>;
  /** A view that promises fewer tasks than this is reported (default 3). */
  readonly minTasksPerView?: number;
}

/**
 * Pure consistency check between the three artefacts the report must keep aligned:
 * users ↔ tasks, tasks ↔ views (promised), views ↔ modules (implemented).
 * - error: a task nobody needs, or no view covers, or a module claims a task its row does not promise.
 * - warning: a view below the minimum, a promised task not yet implemented.
 * - info: a task covered by a single view (single point of failure).
 */
export function checkCoverage(input: CoverageInput): CoverageIssue[] {
  const min = input.minTasksPerView ?? 3;
  const issues: CoverageIssue[] = [];

  for (const task of TASK_IDS) {
    const users = USER_IDS.filter((u) => input.userTasks[u].includes(task));
    const views = VIEW_IDS.filter((v) => input.viewTasks[v].includes(task));
    if (users.length === 0) {
      issues.push({ level: 'error', code: 'TASK_NO_USER', message: `${task}: aucun utilisateur ne la demande, elle n'est pas justifiée.` });
    }
    if (views.length === 0) {
      issues.push({ level: 'error', code: 'TASK_NO_VIEW', message: `${task}: aucune vue ne la couvre.` });
    } else if (views.length === 1) {
      issues.push({ level: 'info', code: 'TASK_SINGLE_VIEW', message: `${task}: couverte par une seule vue (${views[0]}).` });
    }
  }

  for (const view of VIEW_IDS) {
    const promised = input.viewTasks[view];
    const done = input.implemented[view];
    if (promised.length < min) {
      issues.push({ level: 'warning', code: 'VIEW_BELOW_MIN', message: `${view}: ${promised.length} tâche(s) promise(s) (${promised.join(', ')}), minimum ${min}.` });
    }
    const extra = done.filter((t) => !promised.includes(t));
    if (extra.length > 0) {
      issues.push({ level: 'error', code: 'IMPLEMENTED_NOT_PROMISED', message: `${view}: implémente ${extra.join(', ')} sans que la matrice le prévoie.` });
    }
    const missing = promised.filter((t) => !done.includes(t));
    if (missing.length > 0) {
      issues.push({ level: 'warning', code: 'PROMISED_NOT_IMPLEMENTED', message: `${view}: reste à implémenter ${missing.join(', ')}.` });
    }
  }
  return issues;
}
