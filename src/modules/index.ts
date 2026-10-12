import type { VizModule } from '../core/module';
import type { ViewId } from '../core/tasks';
import atlas from './atlas';
import flow from './flow';
import leaderboard from './leaderboard';
import map from './map';

/** The only file allowed to import module folders. The shell and the coverage script read this registry. */
export const MODULES: Readonly<Record<ViewId, VizModule>> = { map, atlas, leaderboard, flow };
