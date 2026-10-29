import { createServer } from 'vite';
import { checkCoverage, type CoverageIssue } from '../src/core/coverage';
import { TASKS, USERS, USER_IDS, VIEW_IDS, USER_TASKS, VIEW_TASKS, type ViewId } from '../src/core/tasks';

// The modules import what only Vite resolves (CSS, `?url` assets): load the registry through Vite's
// SSR loader instead of a plain Node import.
const server = await createServer({ configFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false, ws: false } });
const { MODULES } = (await server.ssrLoadModule('/src/modules/index.ts')) as typeof import('../src/modules');
await server.close();

/**
 * Prints the two matrices of the team spreadsheet as they are encoded in code, plus the implementation
 * status declared by each module, then the consistency issues.
 *   npm run coverage:tasks          exit 1 on errors
 *   npm run coverage:tasks:strict   exit 1 on errors and warnings (use it from the feature freeze on)
 */
const strict = process.argv.includes('--strict');

const mark = (on: boolean): string => (on ? 'x' : '.');
const pad = (s: string, n: number): string => s.padEnd(n);

console.log('\nUtilisateurs × tâches');
console.log(pad('', 42) + TASKS.map((t) => pad(t.id, 4)).join(''));
for (const u of USERS) {
  console.log(pad(`${u.id} ${u.label}`, 42) + TASKS.map((t) => pad(mark(USER_TASKS[u.id].includes(t.id)), 4)).join(''));
}

console.log('\nVues × tâches (promis / implémenté : x = promis seulement, X = promis et implémenté, ! = implémenté hors matrice)');
console.log(pad('', 42) + TASKS.map((t) => pad(t.id, 4)).join(''));
const implemented = Object.fromEntries(VIEW_IDS.map((v) => [v, MODULES[v].tasks])) as Record<ViewId, readonly (typeof TASKS)[number]['id'][]>;
for (const v of VIEW_IDS) {
  const cells = TASKS.map((t) => {
    const promised = VIEW_TASKS[v].includes(t.id);
    const done = implemented[v].includes(t.id);
    return pad(promised ? (done ? 'X' : 'x') : done ? '!' : '.', 4);
  });
  console.log(pad(v, 42) + cells.join(''));
}

const issues = checkCoverage({ userTasks: USER_TASKS, viewTasks: VIEW_TASKS, implemented });
const order: Record<CoverageIssue['level'], number> = { error: 0, warning: 1, info: 2 };
console.log('\nContrôles');
for (const issue of [...issues].sort((a, b) => order[a.level] - order[b.level])) {
  console.log(`  [${issue.level}] ${issue.code} — ${issue.message}`);
}

const failing = issues.filter((i) => i.level === 'error' || (strict && i.level === 'warning'));
console.log(`\n${USER_IDS.length} utilisateurs, ${TASKS.length} tâches, ${VIEW_IDS.length} vues — ${failing.length} bloquant(s)${strict ? ' (mode strict)' : ''}.`);
process.exit(failing.length > 0 ? 1 : 0);
