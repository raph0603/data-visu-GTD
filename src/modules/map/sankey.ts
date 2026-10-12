import { sankey, sankeyLinkHorizontal, type SankeyLink, type SankeyNode } from 'd3-sankey';
import { categoryLabel } from '../../core/labels';
import { formatCount, formatShare } from './format';
import { weightOf, weightUnit, type Env, type Frame } from './frame';
import type { CategoryDim, Totals } from './model';
import type { Card } from './ui';

const W = 560;
const H = 300;
const TOP_PER_COLUMN = 6;
const COLUMNS: readonly CategoryDim[] = ['attackType', 'targetType', 'weaponType'];
const COLUMN_TITLES = ['Type d’attaque', 'Cible', 'Arme'];

interface NodeDatum {
  readonly id: string;
  readonly dim: CategoryDim;
  /** Source label, or null for the "Autres" node of the column. */
  readonly category: string | null;
  readonly label: string;
}
interface LinkDatum {
  readonly source: string;
  readonly target: string;
  readonly value: number;
}
type Node = SankeyNode<NodeDatum, LinkDatum>;
type Link = SankeyLink<NodeDatum, LinkDatum>;

export interface Flow {
  update(frame: Frame): void;
}

/**
 * How attacks are carried out (T6): attack type → target → weapon for the selection (or the world),
 * weighted by the metric. The 6 largest categories of each column are kept, the rest is "Autres".
 * Clicking a node filters every panel on that category.
 */
export function createFlow(env: Env, card: Card): Flow {
  const { store, model, tooltip } = env;
  const svg = card.body.append('svg').attr('class', 'cv-chart cv-sankey').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img');

  return {
    update(frame) {
      const unit = weightUnit(frame.metric);
      const scope = frame.selected.length === 0 ? 'monde entier' : frame.selected.map((iso3) => env.name(iso3)).join(', ');
      card.caption.text(`Épaisseur : ${unit} · ${scope} · cliquez sur une catégorie pour filtrer`);
      const color = frame.selected.length === 1 ? (frame.colors.get(frame.selected[0] ?? '') ?? '#6f7f96') : '#6f7f96';

      // Keep the heaviest categories of each column; the others fold into "Autres".
      const kept = COLUMNS.map((dim) => {
        const weights = frame.scan.combined[dim].map((t, i) => ({ i, w: weightOf(t, frame.metric) }));
        return new Set(weights.filter((c) => c.w > 0).sort((a, b) => b.w - a.w).slice(0, TOP_PER_COLUMN).map((c) => c.i));
      });
      const nodeId = (column: number, i: number) => (kept[column]?.has(i) ? `${column}:${i}` : `${column}:other`);
      const links = new Map<string, number>();
      const addFlows = (flows: ReadonlyMap<string, Totals>, column: number) => {
        for (const [key, totals] of flows) {
          const [a, b] = key.split('|').map(Number);
          const w = weightOf(totals, frame.metric);
          if (!(w > 0)) continue;
          const id = `${nodeId(column, a ?? 0)}>${nodeId(column + 1, b ?? 0)}`;
          links.set(id, (links.get(id) ?? 0) + w);
        }
      };
      addFlows(frame.scan.attackTarget, 0);
      addFlows(frame.scan.targetWeapon, 1);

      const used = new Set<string>();
      for (const id of links.keys()) for (const end of id.split('>')) used.add(end);
      const nodes: NodeDatum[] = [...used].map((id) => {
        const [column, rest] = id.split(':');
        const dim = COLUMNS[Number(column)] ?? 'attackType';
        const category = rest === 'other' ? null : (model.dict[dim][Number(rest)] ?? '');
        return { id, dim, category, label: category === null ? 'Autres' : categoryLabel(dim, category) };
      });

      svg.selectAll('*').remove();
      svg.attr('aria-label', `Flux type d’attaque, cible, arme (${unit})`);
      if (links.size === 0) {
        svg.append('text').attr('class', 'cv-empty-svg').attr('x', W / 2).attr('y', H / 2).attr('text-anchor', 'middle').text('Aucun incident avec ces filtres.');
        return;
      }
      const layout = sankey<NodeDatum, LinkDatum>()
        .nodeId((d) => d.id)
        .nodeWidth(10)
        .nodePadding(9)
        .nodeSort((a, b) => (a.category === null ? 1 : b.category === null ? -1 : (b.value ?? 0) - (a.value ?? 0)))
        .extent([
          [4, 22],
          [W - 4, H - 4],
        ]);
      const graph = layout({
        nodes: nodes.map((d) => ({ ...d })),
        links: [...links].map(([id, value]) => {
          const [source, target] = id.split('>');
          return { source: source ?? '', target: target ?? '', value };
        }),
      });
      const total = graph.links.filter((l) => (l.source as Node).depth === 0).reduce((sum, l) => sum + (l.value ?? 0), 0);

      svg
        .append('g')
        .selectAll('text')
        .data(COLUMN_TITLES)
        .join('text')
        .attr('class', 'cv-column-title')
        .attr('x', (_t, i) => (i === 0 ? 4 : i === 1 ? W / 2 : W - 4))
        .attr('y', 12)
        .attr('text-anchor', (_t, i) => (i === 0 ? 'start' : i === 1 ? 'middle' : 'end'))
        .text((t) => t);

      const linkPaths = svg
        .append('g')
        .attr('fill', 'none')
        .selectAll<SVGPathElement, Link>('path')
        .data(graph.links)
        .join('path')
        .attr('class', 'cv-flow-link')
        .attr('d', sankeyLinkHorizontal())
        .attr('stroke', color)
        .attr('stroke-width', (l) => Math.max(1, l.width ?? 1))
        .on('pointermove', (event: PointerEvent, l) => {
          linkPaths.classed('is-dim', (other) => other !== l);
          const s = l.source as Node;
          const t = l.target as Node;
          tooltip.show(event, `${s.label} → ${t.label}`, [
            { text: `${formatCount(l.value ?? 0)} ${unit}`, strong: true, key: color },
            { text: `${formatShare(total > 0 ? (l.value ?? 0) / total : 0)} du total` },
          ]);
        })
        .on('pointerleave', () => {
          linkPaths.classed('is-dim', false);
          tooltip.hide();
        });

      const node = svg
        .append('g')
        .selectAll<SVGGElement, Node>('g')
        .data(graph.nodes)
        .join('g')
        .attr('class', (d) => `cv-flow-node${d.category === null ? '' : ' is-clickable'}`);
      node
        .append('rect')
        .attr('x', (d) => d.x0 ?? 0)
        .attr('y', (d) => d.y0 ?? 0)
        .attr('width', (d) => (d.x1 ?? 0) - (d.x0 ?? 0))
        .attr('height', (d) => Math.max(1, (d.y1 ?? 0) - (d.y0 ?? 0)))
        .attr('rx', 2);
      node
        .append('text')
        .attr('x', (d) => ((d.depth ?? 0) === 2 ? (d.x0 ?? 0) - 6 : (d.x1 ?? 0) + 6))
        .attr('y', (d) => ((d.y0 ?? 0) + (d.y1 ?? 0)) / 2)
        .attr('dominant-baseline', 'middle')
        .attr('text-anchor', (d) => ((d.depth ?? 0) === 2 ? 'end' : 'start'))
        .text((d) => ((d.y1 ?? 0) - (d.y0 ?? 0) >= 9 ? d.label : ''));
      node
        .on('pointermove', (event: PointerEvent, d) => {
          linkPaths.classed('is-dim', (l) => l.source !== d && l.target !== d);
          tooltip.show(event, d.label, [
            { text: `${formatCount(d.value ?? 0)} ${unit} · ${formatShare(total > 0 ? (d.value ?? 0) / total : 0)}`, strong: true, key: color },
            { text: d.category === null ? 'Catégories plus rares, regroupées' : 'Cliquer pour filtrer sur cette catégorie' },
          ]);
        })
        .on('pointerleave', () => {
          linkPaths.classed('is-dim', false);
          tooltip.hide();
        })
        .on('click', (_event: MouseEvent, d) => {
          const value = d.category;
          if (value === null) return;
          store.set((s) => {
            const current = s.filters[d.dim] ?? [];
            return { filters: { ...s.filters, [d.dim]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] } };
          });
        });
    },
  };
}
