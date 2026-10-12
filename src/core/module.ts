import type { DatasetMeta } from './meta';
import type { DataApi } from './data';
import type { PaletteApi } from './palette';
import type { AppState } from './state';
import type { Store } from './store';
import type { TaskId, ViewId } from './tasks';

/**
 * Integration contract between the shell and the four views.
 *
 * Rules a module must respect (checked by test/architecture.test.ts and test/modules.test.ts):
 *  1. Import only from `core/` and from its own folder: never from another module or from `shell/`.
 *  2. No source-column name in the code: everything comes from `ctx.dataset` and `ctx.data`.
 *  3. Render into `host` only; `destroy()` removes every node, listener, timer and store subscription.
 *  4. Read and write shared state only through `ctx.store`. Never mutate what you read (snapshots are frozen).
 *  5. Use `ctx.palette` for magnitude, zero, no-data and category colours.
 *  6. Loading errors are displayed inside `host`, never thrown out of `mount`.
 */
export interface ModuleContext {
  readonly store: Store<AppState>;
  readonly dataset: DatasetMeta;
  readonly data: DataApi;
  readonly palette: PaletteApi;
}

export interface ModuleHandle {
  destroy(): void;
}

export interface VizModule {
  readonly id: ViewId;
  readonly title: string;
  /**
   * Tasks this module actually implements today. Must stay inside VIEW_TASKS[id];
   * `npm run coverage:tasks` compares it with the promised row of the matrix.
   */
  readonly tasks: readonly TaskId[];
  mount(host: HTMLElement, ctx: ModuleContext): ModuleHandle | Promise<ModuleHandle>;
}
