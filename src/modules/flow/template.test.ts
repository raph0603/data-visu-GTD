import { describe, expect, it } from 'vitest';
import renderer from './renderer.js?raw';
import template from './template.html?raw';

const idsOf = (html: string) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] as string);

describe('flow template', () => {
  it('has every element the renderer looks up by id, each once', () => {
    const present = idsOf(template);
    const wanted = new Set([...renderer.matchAll(/\$\('([A-Za-z]+)'\)/g)].map((m) => m[1] as string));
    const missing = [...wanted].filter((id) => !present.includes(id));
    expect(missing).toEqual([]);
    expect(present.filter((id, i) => present.indexOf(id) !== i)).toEqual([]);
  });

  it('keeps the controls the module wires itself: the layout toggle, the settings panels and the summary', () => {
    const present = idsOf(template);
    for (const id of ['layoutToggle', 'resumeSlot', 'dimsPop', 'filtersPop', 'legendPop', 'displayPop', 'geometryLabel', 'horizontalButton', 'radialButton']) expect(present).toContain(id);
    // Each panel button points at a panel of the template.
    for (const [, pop] of template.matchAll(/data-pop="([^"]+)"/g)) expect(present).toContain(pop);
  });
});
