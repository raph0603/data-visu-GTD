import { readdirSync, readFileSync } from 'node:fs';
import { posix, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

interface SourceFile {
  readonly path: string; // repo-relative, posix separators
  readonly text: string;
}

/** Source-column names of the GTD. They may only appear in a dataset adapter (src/datasets/), never in core or views. */
const COLUMN_LITERAL =
  /(['"`])(iyear|imonth|iday|nkill|nwound|gname|country_txt|region_txt|eventid|attacktype1(?:_txt)?|targtype1(?:_txt)?|weaptype1(?:_txt)?|latitude|longitude)\1/;

function importsOf(text: string): string[] {
  const out: string[] = [];
  for (const re of [/\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /^\s*import\s+['"]([^'"]+)['"]/gm]) {
    for (const m of text.matchAll(re)) if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

const inside = (target: string, dir: string): boolean => target === dir || target.startsWith(`${dir}/`);

export function findViolations(files: readonly SourceFile[]): string[] {
  const out: string[] = [];
  for (const file of files) {
    const mod = /^src\/modules\/([^/]+)\//.exec(file.path);
    const inCore = file.path.startsWith('src/core/');
    for (const spec of importsOf(file.text)) {
      if (!spec.startsWith('.')) continue; // bare packages are fine
      const target = posix.normalize(posix.join(posix.dirname(file.path), spec));
      if (mod !== null && !(inside(target, 'src/core') || inside(target, `src/modules/${mod[1]}`))) {
        out.push(`${file.path}: un module n'importe que core/ et son propre dossier (importe "${spec}")`);
      }
      if (inCore && (inside(target, 'src/modules') || inside(target, 'src/shell'))) {
        out.push(`${file.path}: core/ ne dépend ni des modules ni du shell (importe "${spec}")`);
      }
    }
    if (!file.path.startsWith('src/datasets/') && COLUMN_LITERAL.test(file.text)) {
      out.push(`${file.path}: nom de colonne source en dur (à confiner dans src/datasets/)`);
    }
  }
  return out;
}

function readTree(root: string): SourceFile[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .map((p) => p.split(sep).join('/'))
    .filter((p) => p.endsWith('.ts'))
    .map((p) => ({ path: `${root}/${p}`, text: readFileSync(`${root}/${p}`, 'utf8') }));
}

describe('architecture rules', () => {
  it('holds on the real source tree', () => {
    const files = readTree('src');
    expect(files.length).toBeGreaterThan(10);
    expect(findViolations(files)).toEqual([]);
  });

  it('rejects a module importing another module', () => {
    expect(findViolations([{ path: 'src/modules/map/index.ts', text: "import atlas from '../atlas';" }])).toHaveLength(1);
  });

  it('rejects a module importing the shell or the registry', () => {
    expect(findViolations([{ path: 'src/modules/flow/view.ts', text: "import { x } from '../../shell/main';" }])).toHaveLength(1);
    expect(findViolations([{ path: 'src/modules/flow/view.ts', text: "import { MODULES } from '..';" }])).toHaveLength(1);
  });

  it('accepts core, own folder and packages, including multi-line and dynamic imports', () => {
    const text = [
      "import { scaleSqrt } from 'd3';",
      "import type { ModuleContext } from '../../core/module';",
      'import {',
      '  a,',
      "} from './local/helper';",
      "const lazy = () => import('./worker');",
    ].join('\n');
    expect(findViolations([{ path: 'src/modules/map/index.ts', text }])).toEqual([]);
  });

  it('rejects core depending on modules or shell', () => {
    expect(findViolations([{ path: 'src/core/x.ts', text: "import m from '../modules';" }])).toHaveLength(1);
    expect(findViolations([{ path: 'src/core/x.ts', text: "import '../shell/main';" }])).toHaveLength(1);
  });

  it('rejects hard-coded source column names outside src/datasets', () => {
    expect(findViolations([{ path: 'src/modules/map/index.ts', text: "const c = d['nkill'];" }])).toHaveLength(1);
    expect(findViolations([{ path: 'src/core/x.ts', text: 'const c = row["gname"];' }])).toHaveLength(1);
    expect(findViolations([{ path: 'src/datasets/gtd.ts', text: "const c = 'nkill';" }])).toEqual([]);
    expect(findViolations([{ path: 'src/modules/map/index.ts', text: "const dim = 'country';" }])).toEqual([]);
  });
});
