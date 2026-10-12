import { describe, expect, it } from 'vitest';
import { checkCoverage, type CoverageInput } from '../src/core/coverage';
import { MODULES } from '../src/modules';
import { TASKS, TASK_IDS, USERS, USER_IDS, USER_TASKS, VIEW_IDS, VIEW_TASKS, type TaskId, type ViewId } from '../src/core/tasks';

const none: Record<ViewId, readonly TaskId[]> = { map: [], atlas: [], leaderboard: [], flow: [] };

function input(over: Partial<CoverageInput> = {}): CoverageInput {
  return { userTasks: USER_TASKS, viewTasks: VIEW_TASKS, implemented: none, ...over };
}

const codes = (i: CoverageInput) => checkCoverage(i).map((x) => `${x.level}:${x.code}`);

describe('task registry', () => {
  it('has unique ids in declaration order', () => {
    expect(TASKS.map((t) => t.id)).toEqual([...TASK_IDS]);
    expect(USERS.map((u) => u.id)).toEqual([...USER_IDS]);
  });

  it('keeps both matrices inside the declared ids', () => {
    for (const u of USER_IDS) for (const t of USER_TASKS[u]) expect(TASK_IDS).toContain(t);
    for (const v of VIEW_IDS) for (const t of VIEW_TASKS[v]) expect(TASK_IDS).toContain(t);
  });

  it('covers every task by at least one user and one view (hard invariant of the report)', () => {
    expect(checkCoverage(input()).filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('module registry', () => {
  it('registers each module under its own id', () => {
    for (const id of VIEW_IDS) expect(MODULES[id].id).toBe(id);
  });

  it('never claims a task its matrix row does not promise', () => {
    for (const id of VIEW_IDS) {
      for (const t of MODULES[id].tasks) expect(VIEW_TASKS[id]).toContain(t);
    }
  });
});

describe('checkCoverage', () => {
  it('flags a task that no view covers', () => {
    const viewTasks = { ...VIEW_TASKS, atlas: VIEW_TASKS.atlas.filter((t) => t !== 'T5') };
    expect(codes(input({ viewTasks }))).toContain('error:TASK_NO_VIEW');
  });

  it('flags a task that no user needs', () => {
    const drop = (u: keyof typeof USER_TASKS) => USER_TASKS[u].filter((t) => t !== 'T3');
    const userTasks: CoverageInput['userTasks'] = { U1: drop('U1'), U2: drop('U2'), U3: drop('U3'), U4: drop('U4') };
    expect(codes(input({ userTasks }))).toContain('error:TASK_NO_USER');
  });

  it('flags a view below the minimum number of tasks', () => {
    const found = checkCoverage(input()).find((i) => i.code === 'VIEW_BELOW_MIN');
    expect(found?.message).toContain('flow');
    expect(codes(input({ minTasksPerView: 2 }))).not.toContain('warning:VIEW_BELOW_MIN');
  });

  it('flags an implementation outside the promised row and an unimplemented promise', () => {
    expect(codes(input({ implemented: { ...none, flow: ['T1'] } }))).toContain('error:IMPLEMENTED_NOT_PROMISED');
    expect(codes(input())).toContain('warning:PROMISED_NOT_IMPLEMENTED');
    const done = input({ implemented: VIEW_TASKS });
    expect(codes(done)).not.toContain('warning:PROMISED_NOT_IMPLEMENTED');
  });

  it('reports single points of failure as information only', () => {
    const single = checkCoverage(input()).filter((i) => i.code === 'TASK_SINGLE_VIEW');
    expect(single.length).toBeGreaterThan(0);
    expect(single.every((i) => i.level === 'info')).toBe(true);
  });
});
