import { VIEW_IDS, type ViewId } from './tasks';
import type { AppState, EntityRef, YearRange } from './state';
import type { Store, Unsubscribe } from './store';

/**
 * URL-hash codec for AppState.
 *
 *   #v=leaderboard&m=killed&t=2013-2017&cmp=1998-2002&f=country:NGA&p=country:NGA,country:IRQ
 *    &i=201401010012&q.group=Boko%20Haram,ISIL&x.leaderboard.top=20
 *
 * - Keys equal to the default state are omitted, so the default state encodes to "".
 * - `hover` is never encoded (transient).
 * - Every user string goes through encodeURIComponent; lists are joined with a raw ',' which
 *   encodeURIComponent never emits, so splitting is unambiguous. Same for ':' in entity refs.
 * - Decoding never throws: unknown or malformed pairs are ignored and the default applies.
 */
export interface HashCodec {
  encode(state: AppState): string;
  /** Full state: keys absent from the hash take their default value. Always sanitized by the store, not here. */
  decode(hash: string): AppState;
}

const RANGE = /^(\d{1,4})-(\d{1,4})$/;

function encRange(r: YearRange): string {
  return `${r.from}-${r.to}`;
}

function decRange(raw: string): YearRange | null {
  const m = RANGE.exec(raw);
  if (m === null) return null;
  return { from: Number(m[1]), to: Number(m[2]) };
}

function encRef(r: EntityRef): string {
  return `${encodeURIComponent(r.dim)}:${encodeURIComponent(r.id)}`;
}

function safeDecode(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function decRef(raw: string): EntityRef | null {
  const at = raw.indexOf(':');
  if (at <= 0) return null;
  const dim = safeDecode(raw.slice(0, at));
  const id = safeDecode(raw.slice(at + 1));
  return dim === null || id === null || dim.length === 0 || id.length === 0 ? null : { dim, id };
}

function decList(raw: string): string[] | null {
  const out: string[] = [];
  for (const part of raw.split(',')) {
    if (part.length === 0) continue;
    const v = safeDecode(part);
    if (v === null) return null;
    out.push(v);
  }
  return out;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createHashCodec(defaults: AppState): HashCodec {
  return {
    encode(state) {
      const parts: string[] = [];
      if (state.view !== defaults.view) parts.push(`v=${state.view}`);
      if (state.metric !== defaults.metric) parts.push(`m=${encodeURIComponent(state.metric)}`);
      if (!sameJson(state.range, defaults.range)) parts.push(`t=${encRange(state.range)}`);
      if (state.compare !== null) parts.push(`cmp=${encRange(state.compare)}`);
      if (state.focus !== null) parts.push(`f=${encRef(state.focus)}`);
      if (state.pinned.length > 0) parts.push(`p=${state.pinned.map(encRef).join(',')}`);
      if (state.incident !== null) parts.push(`i=${encodeURIComponent(state.incident)}`);
      for (const dim of Object.keys(state.filters).sort()) {
        const values = state.filters[dim] ?? [];
        if (values.length > 0) parts.push(`q.${encodeURIComponent(dim)}=${values.map(encodeURIComponent).join(',')}`);
      }
      for (const key of Object.keys(state.ext).sort()) {
        parts.push(`x.${encodeURIComponent(key)}=${encodeURIComponent(state.ext[key] ?? '')}`);
      }
      return parts.join('&');
    },

    decode(hash) {
      const body = hash.startsWith('#') ? hash.slice(1) : hash;
      let { view, metric, range, compare, focus, pinned, incident } = defaults;
      const filters: Record<string, readonly string[]> = {};
      const ext: Record<string, string> = {};

      for (const pair of body.split('&')) {
        const eq = pair.indexOf('=');
        if (eq <= 0) continue;
        const rawKey = pair.slice(0, eq);
        const raw = pair.slice(eq + 1);

        if (rawKey === 'v') {
          if ((VIEW_IDS as readonly string[]).includes(raw)) view = raw as ViewId;
        } else if (rawKey === 'm') {
          const v = safeDecode(raw);
          if (v !== null && v.length > 0) metric = v;
        } else if (rawKey === 't') {
          range = decRange(raw) ?? range;
        } else if (rawKey === 'cmp') {
          compare = decRange(raw) ?? compare;
        } else if (rawKey === 'f') {
          focus = decRef(raw) ?? focus;
        } else if (rawKey === 'p') {
          const refs = raw.split(',').map(decRef);
          if (refs.every((r): r is EntityRef => r !== null)) pinned = refs;
        } else if (rawKey === 'i') {
          const v = safeDecode(raw);
          if (v !== null && v.length > 0) incident = v;
        } else if (rawKey.startsWith('q.')) {
          const dim = safeDecode(rawKey.slice(2));
          const values = decList(raw);
          if (dim !== null && dim.length > 0 && values !== null && values.length > 0) filters[dim] = values;
        } else if (rawKey.startsWith('x.')) {
          const key = safeDecode(rawKey.slice(2));
          const value = safeDecode(raw);
          if (key !== null && value !== null) ext[key] = value;
        }
      }

      return { view, metric, range, compare, focus, pinned, incident, filters, hover: null, ext };
    },
  };
}

/* ---------------------------------------------------------------- binding */

export interface HashEnv {
  /** Current location.hash (with or without '#'). */
  read(): string;
  /** Replace the current history entry's hash without firing hashchange. */
  write(hash: string): void;
  /** Subscribe to external hash changes (manual edit, pasted link). */
  onExternalChange(callback: () => void): Unsubscribe;
  schedule(callback: () => void, delayMs: number): () => void;
}

export function browserHashEnv(win: Window = window): HashEnv {
  return {
    read: () => win.location.hash,
    write(hash) {
      const url = win.location.pathname + win.location.search + (hash.length > 0 ? `#${hash}` : '');
      win.history.replaceState(null, '', url);
    },
    onExternalChange(callback) {
      win.addEventListener('hashchange', callback);
      return () => win.removeEventListener('hashchange', callback);
    },
    schedule(callback, delayMs) {
      const handle = win.setTimeout(callback, delayMs);
      return () => win.clearTimeout(handle);
    },
  };
}

/**
 * Keeps the store and the URL hash in sync.
 * store → URL: debounced replaceState (browsers rate-limit history calls; a slider drag would trip it),
 *              and replaceState does not fire hashchange, so there is no echo.
 * URL → store: on hashchange, unless the hash is exactly what we wrote.
 * `hover` changes never reach the URL because the subscription watches the encoded string.
 */
export function bindHash(store: Store<AppState>, codec: HashCodec, env: HashEnv, debounceMs = 150): Unsubscribe {
  let lastWritten = codec.encode(store.get());
  let cancel: (() => void) | null = null;

  const offStore = store.subscribe(
    (s) => codec.encode(s),
    (encoded) => {
      cancel?.();
      cancel = env.schedule(() => {
        cancel = null;
        lastWritten = encoded;
        env.write(encoded);
      }, debounceMs);
    },
  );

  const offUrl = env.onExternalChange(() => {
    const raw = env.read();
    const body = raw.startsWith('#') ? raw.slice(1) : raw;
    if (body === lastWritten) return;
    store.set(codec.decode(body));
  });

  return () => {
    cancel?.();
    offStore();
    offUrl();
  };
}
