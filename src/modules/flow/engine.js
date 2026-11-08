/* Pure data engine. One row = one observed combination, with additive measures.
   Indices: year, region, country, attack, weapon, target, group, suicide,
   incidents, known deaths sum, known deaths count, known injuries sum, known injuries count. */


  const dimensions = {
    region: {index: 1, title: 'Région', field: 'region_txt'},
    country: {index: 2, title: 'Pays', field: 'country_txt'},
    attack: {index: 3, title: 'Type d’attaque', field: 'attacktype1_txt'},
    weapon: {index: 4, title: 'Arme', field: 'weaptype1_txt'},
    target: {index: 5, title: 'Cible', field: 'targtype1_txt'},
    group: {index: 6, title: 'Groupe attribué', field: 'gname'},
    suicide: {index: 7, title: 'Attentat suicide', field: 'suicide'}
  };
  const metrics = {
    count: {index: 8, title: 'Incidents', singular: 'incident'},
    killed: {index: 9, title: 'Morts enregistrés', singular: 'mort enregistré'},
    wounded: {index: 11, title: 'Blessés enregistrés', singular: 'blessé enregistré'}
  };
  const translations = {
    'Unknown': 'Inconnu', 'Other': 'Autre', 'Bombing/Explosion': 'Explosion / attentat à la bombe',
    'Armed Assault': 'Assaut armé', 'Assassination': 'Assassinat', 'Facility/Infrastructure Attack': 'Attaque d’infrastructure',
    'Hostage Taking (Kidnapping)': 'Enlèvement', 'Hostage Taking (Barricade Incident)': 'Prise d’otages',
    'Unarmed Assault': 'Assaut non armé', 'Hijacking': 'Détournement', 'Explosives': 'Explosifs',
    'Firearms': 'Armes à feu', 'Incendiary': 'Incendiaire', 'Melee': 'Arme de contact',
    'Chemical': 'Chimique', 'Biological': 'Biologique', 'Radiological': 'Radiologique',
    'Vehicle (not to include vehicle-borne explosives, i.e., car or truck bombs)': 'Véhicule',
    'Sabotage Equipment': 'Équipement de sabotage', 'Fake Weapons': 'Fausses armes',
    'Private Citizens & Property': 'Civils et biens privés', 'Military': 'Militaires', 'Police': 'Police',
    'Government (General)': 'Gouvernement', 'Government (Diplomatic)': 'Diplomatie', 'Business': 'Entreprises',
    'Transportation': 'Transports', 'Religious Figures/Institutions': 'Religieux et institutions',
    'Educational Institution': 'Établissements scolaires', 'Journalists & Media': 'Journalistes et médias',
    'Utilities': 'Services publics', 'Terrorists/Non-State Militia': 'Milices / acteurs non étatiques',
    'Violent Political Party': 'Partis politiques violents', 'Airports & Aircraft': 'Aéroports et avions',
    'Maritime': 'Maritime', 'Food or Water Supply': 'Alimentation et eau', 'Telecommunication': 'Télécommunications',
    'Tourists': 'Touristes', 'NGO': 'ONG', 'Abortion Related': 'Lié à l’avortement',
    'Middle East & North Africa': 'Moyen-Orient et Afrique du Nord', 'South Asia': 'Asie du Sud',
    'Southeast Asia': 'Asie du Sud-Est', 'Sub-Saharan Africa': 'Afrique subsaharienne',
    'Western Europe': 'Europe de l’Ouest', 'Eastern Europe': 'Europe de l’Est', 'Central Asia': 'Asie centrale',
    'East Asia': 'Asie de l’Est', 'North America': 'Amérique du Nord', 'South America': 'Amérique du Sud',
    'Central America & Caribbean': 'Amérique centrale et Caraïbes', 'Australasia & Oceania': 'Océanie'
  };
  const translate = s => translations[s] || s;
  const stats = () => ({count: 0, killed: 0, knownKilled: 0, wounded: 0, knownWounded: 0});
  function add(s, r) {s.count += r[8]; s.killed += r[9]; s.knownKilled += r[10]; s.wounded += r[11]; s.knownWounded += r[12];}
  function merge(a, b) {for (const key in a) a[key] += b[key]; return a;}
  function decodeNumber(v) {if (v == null || String(v).trim() === '') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null;}
  function parseCSV(text, d3, filename = 'Import GTD') {
    text = text.replace(/^\uFEFF/, '');
    let columns, indices, isCube, seen = new Map(), duplicate = 0, dicts = {}, lookups = {}, cube = new Map(), years = new Set();
    for (const dim in dimensions) {dicts[dim] = []; lookups[dim] = new Map();}
    const code = (dim, label) => {if (!lookups[dim].has(label)) {lookups[dim].set(label, dicts[dim].length); dicts[dim].push(label);} return lookups[dim].get(label);};
    d3.csvParseRows(text, (r, i) => {
      if (!i) {
        columns = r.map(s => s.trim()); indices = Object.fromEntries(columns.map((c, j) => [c, j]));
        isCube = 'nb_attaques' in indices && !('eventid' in indices);
        const required = ['iyear', 'country_txt', 'region_txt', 'attacktype1_txt', 'weaptype1_txt', 'targtype1_txt', 'gname'];
        if (!isCube) required.push('eventid');
        const missing = required.filter(f => !(f in indices));
        if (missing.length) throw new Error('Colonnes absentes : ' + missing.join(', ') + '. Importez le CSV GTD, incidents_nettoyes.csv ou modes_operatoires.csv.');
        if (!('suicide' in indices) && !('suicide_libelle' in indices)) throw new Error('Colonne suicide ou suicide_libelle absente.');
        return null;
      }
      const get = f => (r[indices[f]] ?? '').trim();
      const year = Number(get('iyear')); if (!Number.isInteger(year) || year < 1 || year > 9999) throw new Error('Année invalide à la ligne ' + (i + 1));
      if (!isCube) {
        const id = get('eventid'); if (!id) throw new Error('eventid absent à la ligne ' + (i + 1));
        const signature = JSON.stringify(r);
        if (seen.has(id)) {if (seen.get(id) !== signature) throw new Error('Lignes contradictoires pour eventid ' + id); duplicate++; return null;}
        seen.set(id, signature);
      }
      const values = [year];
      for (const dim in dimensions) {
        let label = get(dimensions[dim].field) || 'Unknown';
        if (dim === 'suicide') label = 'suicide' in indices ? ({'0': 'Non', '1': 'Oui'}[get('suicide')] || 'Inconnu') : (get('suicide_libelle') || 'Inconnu');
        values.push(code(dim, label));
      }
      const n = isCube ? decodeNumber(get('nb_attaques')) : 1;
      if (!n || !Number.isInteger(n)) throw new Error('Nombre d’incidents invalide à la ligne ' + (i + 1));
      const killed = decodeNumber(get(isCube ? 'morts_enregistres' : 'nkill'));
      const wounded = decodeNumber(get(isCube ? 'blesses_enregistres' : 'nwound'));
      let knownK = isCube ? decodeNumber(get('nb_bilans_morts_connus')) : Number(killed !== null);
      let knownW = isCube ? decodeNumber(get('nb_bilans_blesses_connus')) : Number(wounded !== null);
      if (isCube && (knownK === null || knownW === null)) throw new Error('Les bilans agrégés doivent inclure les nombres de bilans connus.');
      if (knownK > n || knownW > n || !Number.isInteger(knownK) || !Number.isInteger(knownW)) throw new Error('Nombre de bilans connus incohérent.');
      if ((knownK > 0 && killed === null) || (knownW > 0 && wounded === null)) throw new Error('Somme absente pour un bilan déclaré connu.');
      if ((knownK === 0 && killed > 0) || (knownW === 0 && wounded > 0)) throw new Error('Somme positive sans aucun bilan connu.');
      const key = JSON.stringify(values); let record = cube.get(key);
      if (!record) {record = values.concat([0, 0, 0, 0, 0]); cube.set(key, record);}
      record[8] += n; record[9] += killed ?? 0; record[10] += knownK; record[11] += wounded ?? 0; record[12] += knownW;
      years.add(year); return null;
    });
    if (!cube.size) throw new Error('Le fichier ne contient aucun incident utilisable.');
    const rows = [...cube.values()]; const total = stats(); rows.forEach(r => add(total, r));
    return {schema: 'gtd-flow-cube-v1', dicts, rows, meta: {...total, incidents: total.count, name: filename, file: filename, years: [...years].sort((a,b)=>a-b), duplicateRowsRemoved: duplicate, primaryCategories: true, imported: true}};
  }
  function aggregate(data, settings) {
    const metric = metrics[settings.metric] || metrics.count, dims = settings.dims;
    const encodedFilters = Object.entries(settings.filters || {}).filter(([d, labels]) => dimensions[d] && labels.length).map(([dim, labels]) => [dimensions[dim].index, new Set(labels.map(s => data.dicts[dim].indexOf(s)))]);
    const filtered = [], A = stats(), B = stats(), ranking = dims.map(() => new Map()), timeline = new Map();
    for (const r of data.rows) {
      if (encodedFilters.some(([i, set]) => !set.has(r[i]))) continue;
      timeline.set(r[0], (timeline.get(r[0]) || 0) + r[metric.index]);
      const inA = r[0] >= settings.period[0] && r[0] <= settings.period[1];
      const inB = settings.compare && r[0] >= settings.periodB[0] && r[0] <= settings.periodB[1];
      if (!inA && !inB) continue;
      if (inA) add(A, r); if (inB) add(B, r);
      const weight = r[metric.index] * (Number(inA) + Number(inB));
      filtered.push({r, inA, inB});
      if (!(weight > 0)) continue;
      dims.forEach((dim, j) => {const cat = r[dimensions[dim].index]; ranking[j].set(cat, (ranking[j].get(cat) || 0) + weight);});
    }
    const top = Math.max(3, Math.min(12, Number(settings.top) || 7));
    const kept = ranking.map(m => {const entries = [...m].sort((a,b) => b[1]-a[1] || a[0]-b[0]); return new Set(entries.slice(0, entries.length > top ? top - 1 : top).map(d => d[0]));});
    const nodes = new Map(), links = new Map();
    for (const {r, inA, inB} of filtered) {
      const ids = dims.map((dim, stage) => {
        const original = r[dimensions[dim].index], cat = kept[stage].has(original) ? original : -1;
        const id = JSON.stringify([dim, cat]);
        let node = nodes.get(id);
        if (!node) {node = {id, dim, stage, cat, label: cat === -1 ? 'Autres' : data.dicts[dim][cat], members: new Set(), a: stats(), b: stats()}; nodes.set(id, node);}
        node.members.add(data.dicts[dim][original]); if (inA) add(node.a, r); if (inB) add(node.b, r); return id;
      });
      for (let j = 0; j < ids.length - 1; j++) {
        const id = JSON.stringify([ids[j], ids[j+1]]); let link = links.get(id);
        if (!link) {link = {id, source: ids[j], target: ids[j+1], stage: j, a: stats(), b: stats()}; links.set(id, link);}
        if (inA) add(link.a, r); if (inB) add(link.b, r);
      }
    }
    const ns = [...nodes.values()].map(n => ({...n, members: [...n.members], value: n.a[settings.metric] + n.b[settings.metric]})).filter(n=>n.value>0);
    const ls = [...links.values()].map(l => ({...l, value: l.a[settings.metric] + l.b[settings.metric]})).filter(l=>l.value>0);
    const availableCountries = new Set();
    const regions = new Set((settings.filters?.region || []).map(l => data.dicts.region.indexOf(l)));
    for (const r of data.rows) if (!regions.size || regions.has(r[1])) availableCountries.add(data.dicts.country[r[2]]);
    return {nodes: ns, links: ls, totals: {a:A, b:B}, total: A[settings.metric]+B[settings.metric], timeline: data.meta.years.map(year=>({year, value:timeline.get(year)||0})),
      availableCountries: [...availableCountries].sort(), missingYears: Array.from({length: settings.period[1]-settings.period[0]+1}, (_,i)=>i+settings.period[0]).filter(y=>!data.meta.years.includes(y)),
      zeroWeightIncidents: (settings.metric === 'killed' ? A.count-A.knownKilled : settings.metric === 'wounded' ? A.count-A.knownWounded : 0)};
  }
export default {dimensions, metrics, translations, translate, parseCSV, aggregate};

