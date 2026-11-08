"""Prepare a readable, aggregated flow CSV from GTD. No geographic coordinates needed."""
import argparse, collections, csv, hashlib, json, math
from pathlib import Path

FIELDS = ['region_txt', 'country_txt', 'attacktype1_txt', 'weaptype1_txt', 'targtype1_txt', 'gname', 'suicide']
DIMS = ['region', 'country', 'attack', 'weapon', 'target', 'group', 'suicide']

def prepare(source, destination):
    dictionaries = {d: [] for d in DIMS}
    lookup = {d: {} for d in DIMS}
    cube, seen, years = {}, set(), set()
    totals = [0, 0, 0, 0, 0]
    def code(d, label):
        if label not in lookup[d]:
            lookup[d][label] = len(dictionaries[d]); dictionaries[d].append(label)
        return lookup[d][label]
    def number(value):
        try:
            n = float(value)
            return n if math.isfinite(n) and n >= 0 else None
        except (ValueError, TypeError):
            return None
    with source.open(encoding='latin-1', newline='') as stream:
        for r in csv.DictReader(stream):
            event = r['eventid']
            if event in seen:
                raise ValueError(f'Duplicate incident: {event}')
            seen.add(event)
            year = int(r['iyear']); years.add(year)
            labels = [(r.get(f, '').strip() or 'Unknown') for f in FIELDS]
            labels[-1] = {'0': 'Non', '1': 'Oui'}.get(labels[-1], 'Inconnu')
            key = (year, *(code(d, label) for d, label in zip(DIMS, labels)))
            killed, wounded = number(r.get('nkill')), number(r.get('nwound'))
            values = [1, killed or 0, int(killed is not None), wounded or 0, int(wounded is not None)]
            target = cube.setdefault(key, [0, 0, 0, 0, 0])
            for i, value in enumerate(values): target[i] += value; totals[i] += value
    metadata = {'name': 'Global Terrorism Database', 'source': 'https://www.kaggle.com/datasets/START-UMD/gtd',
                'file': source.name, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                'years': sorted(years), 'incidents': totals[0], 'killed': totals[1], 'knownKilled': totals[2],
                'wounded': totals[3], 'knownWounded': totals[4], 'primaryCategories': True}
    rows = [list(k) + [int(v) if v == int(v) else v for v in values] for k, values in sorted(cube.items())]
    destination.mkdir(parents=True, exist_ok=True)
    headers = ['iyear','region_txt','country_txt','attacktype1_txt','weaptype1_txt','targtype1_txt','gname','suicide_libelle','nb_attaques','morts_enregistres','nb_bilans_morts_connus','blesses_enregistres','nb_bilans_blesses_connus']
    with (destination / 'modes_operatoires.csv').open('w', encoding='utf-8', newline='') as stream:
        writer = csv.writer(stream); writer.writerow(headers)
        for row in rows:
            writer.writerow([row[0]] + [dictionaries[d][row[i+1]] for i,d in enumerate(DIMS)] + row[8:])
    (destination / 'metadata.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8')
    import shutil
    shutil.copy2(Path(__file__).with_name('mapping_pays.csv'), destination / 'mapping_pays.csv')

    print(json.dumps({'metadata': metadata, 'cube_rows': len(rows), 'bytes': (destination / 'modes_operatoires.csv').stat().st_size}, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('csv', type=Path); p.add_argument('output', type=Path)
    a = p.parse_args(); prepare(a.csv, a.output)
