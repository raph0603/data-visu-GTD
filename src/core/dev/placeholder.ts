import type { ModuleContext, ModuleHandle, VizModule } from '../module';
import { VIEW_LABELS, VIEW_TASKS, type ViewId } from '../tasks';

/**
 * Stand-in module used until a view is written: it honours the whole contract (mount, store
 * subscription, destroy) and shows the live shared state, which is enough to exercise the shell, the
 * URL binding and the integration tests. Replace the module's index.ts by the real view; delete this
 * file when no module uses it any more.
 */
export function placeholderModule(id: ViewId): VizModule {
  return {
    id,
    title: VIEW_LABELS[id],
    tasks: [],
    mount(host: HTMLElement, ctx: ModuleContext): ModuleHandle {
      const root = host.ownerDocument.createElement('section');
      root.className = 'placeholder';
      const title = host.ownerDocument.createElement('h2');
      title.textContent = `${VIEW_LABELS[id]} — squelette`;
      const promised = host.ownerDocument.createElement('p');
      promised.textContent = `Tâches promises par la matrice : ${VIEW_TASKS[id].join(', ')}`;
      const out = host.ownerDocument.createElement('pre');
      out.setAttribute('aria-live', 'polite');
      root.append(title, promised, out);
      host.append(root);

      const unsubscribe = ctx.store.subscribe(
        (s) => s,
        (s) => {
          out.textContent = JSON.stringify(s, null, 2);
        },
        { fireImmediately: true },
      );

      return {
        destroy() {
          unsubscribe();
          root.remove();
        },
      };
    },
  };
}
