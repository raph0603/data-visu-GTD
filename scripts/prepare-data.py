import argparse
import csv
import hashlib
import json
import math
import tempfile
from collections import defaultdict
from pathlib import Path


COLUMNS = (
    "eventid",
    "iyear",
    "country_txt",
    "region_txt",
    "gname",
    "attacktype1_txt",
    "weaptype1_txt",
    "targtype1_txt",
    "nkill",
    "provstate",
    "city",
    "weapsubtype1_txt",
    "targsubtype1_txt",
    "nwound",
    "suicide",
    "success",
    "doubtterr",
)

DIMENSIONS = {
    "country": "country_txt",
    "region": "region_txt",
    "group": "gname",
    "attackType": "attacktype1_txt",
    "weapon": "weaptype1_txt",
    "target": "targtype1_txt",
    "province": "provstate",
    "city": "city",
    "weaponSubtype": "weapsubtype1_txt",
    "targetSubtype": "targsubtype1_txt",
}

PROJECT_DIRECTORY = Path(__file__).resolve().parent.parent


def detect_encoding(source):
    try:
        with source.open(encoding="utf-8-sig") as stream:
            while stream.read(1024 * 1024):
                pass
        return "utf-8-sig"
    except UnicodeDecodeError:
        return "cp1252"


def parse_count(value):
    if not value.strip():
        return None, False
    try:
        number = float(value)
    except ValueError:
        return None, True
    if not math.isfinite(number) or number < 0:
        return None, True
    return int(number) if number.is_integer() else number, False


def parse_flag(value):
    value = value.strip()
    if not value or value == "-9":
        return None, False
    if value in ("0", "1"):
        return int(value), False
    return None, True


def empty_totals():
    return dict.fromkeys(("attacks", "deaths", "knownDeathIncidents", "injuries",
        "knownInjuryIncidents", "casualties", "knownCasualtyIncidents",
        "suicideAttacks", "knownSuicideIncidents", "successfulAttacks",
        "knownSuccessIncidents"), 0)


def add_incident(totals, record):
    totals["attacks"] += 1
    for column, metric, known in (("nkill", "deaths", "knownDeathIncidents"),
        ("nwound", "injuries", "knownInjuryIncidents")):
        if record[column] is not None:
            totals[metric] += record[column]
            totals[known] += 1
    if record["nkill"] is not None and record["nwound"] is not None:
        totals["casualties"] += record["nkill"] + record["nwound"]
        totals["knownCasualtyIncidents"] += 1
    for column, metric, known in (("suicide", "suicideAttacks", "knownSuicideIncidents"),
        ("success", "successfulAttacks", "knownSuccessIncidents")):
        if record[column] is not None:
            totals[metric] += record[column]
            totals[known] += 1


def finalize_totals(totals):
    result = dict(totals)
    for metric, known, average, unknown in (
        ("deaths", "knownDeathIncidents", "averageDeaths", "unknownDeathIncidents"),
        ("injuries", "knownInjuryIncidents", "averageInjuries", "unknownInjuryIncidents"),
        ("casualties", "knownCasualtyIncidents", "averageCasualties", "unknownCasualtyIncidents"),
    ):
        result[metric] = totals[metric] if totals[known] else None
        result[average] = totals[metric] / totals[known] if totals[known] else None
        result[unknown] = totals["attacks"] - totals[known]
    result["successRate"] = (
        100 * totals["successfulAttacks"] / totals["knownSuccessIncidents"]
        if totals["knownSuccessIncidents"] else None
    )
    result["suicideAttacks"] = totals["suicideAttacks"] if totals["knownSuicideIncidents"] else None
    return result


def prepare_data(source, output_directory, encoding=None):
    source = Path(source).resolve()
    output_directory = Path(output_directory).resolve()
    outputs = [output_directory / "gtd-clean.csv", output_directory / "gtd-annual.json",
        output_directory / "gtd-metadata.json"]
    if source in outputs:
        raise ValueError("Le fichier source ne peut pas être un fichier de sortie.")
    encoding = encoding or detect_encoding(source)
    output_directory.mkdir(parents=True, exist_ok=True)
    aggregates = {dimension: defaultdict(empty_totals) for dimension in DIMENSIONS}
    seen = {}
    years = set()
    source_rows = 0
    duplicate_rows = 0
    unknown_deaths = 0
    invalid_deaths = 0
    unknown_injuries = 0
    invalid_injuries = 0
    unknown_flags = dict.fromkeys(("suicide", "success", "doubtterr"), 0)
    invalid_flags = dict.fromkeys(unknown_flags, 0)

    with tempfile.TemporaryDirectory(dir=output_directory) as temporary_directory:
        temporary_directory = Path(temporary_directory)
        clean_path = temporary_directory / outputs[0].name
        with source.open(encoding=encoding, newline="") as stream, clean_path.open(
            "w", encoding="utf-8", newline=""
        ) as cleaned:
            reader = csv.DictReader(stream)
            source_columns = reader.fieldnames or []
            missing_columns = set(COLUMNS) - set(source_columns)
            if missing_columns:
                raise ValueError(f"Colonnes absentes : {', '.join(sorted(missing_columns))}")
            writer = csv.DictWriter(cleaned, fieldnames=COLUMNS)
            writer.writeheader()

            for row in reader:
                source_rows += 1
                if None in row or any(value is None for value in row.values()):
                    raise ValueError(f"Structure CSV invalide à la ligne {reader.line_num}.")
                event_id = row["eventid"].strip()
                if not event_id:
                    raise ValueError(f"Identifiant absent à la ligne {reader.line_num}.")
                fingerprint = hashlib.sha256(
                    json.dumps(row, ensure_ascii=False).encode("utf-8")
                ).digest()
                if event_id in seen:
                    if seen[event_id] != fingerprint:
                        raise ValueError(f"Lignes contradictoires pour l'incident {event_id}.")
                    duplicate_rows += 1
                    continue
                seen[event_id] = fingerprint

                try:
                    year = int(row["iyear"])
                except ValueError as error:
                    raise ValueError(f"Année invalide pour l'incident {event_id}.") from error
                if not 1 <= year <= 9999:
                    raise ValueError(f"Année invalide pour l'incident {event_id}.")
                years.add(year)
                deaths, invalid = parse_count(row["nkill"])
                unknown_deaths += deaths is None
                invalid_deaths += invalid
                injuries, invalid = parse_count(row["nwound"])
                unknown_injuries += injuries is None
                invalid_injuries += invalid
                record = {"eventid": event_id, "iyear": year, "nkill": deaths, "nwound": injuries}
                for column in unknown_flags:
                    flag, invalid = parse_flag(row[column])
                    record[column] = flag
                    unknown_flags[column] += flag is None
                    invalid_flags[column] += invalid

                for column in DIMENSIONS.values():
                    record[column] = " ".join(row[column].split()) or "Unknown"

                for dimension, column in DIMENSIONS.items():
                    category = record[column]
                    if dimension == "city":
                        category = f"{category} ({record['provstate']}, {record['country_txt']})"
                    elif dimension == "province":
                        category = f"{category} ({record['country_txt']})"
                    add_incident(aggregates[dimension][year, category], record)
                writer.writerow(record)

        if not years:
            raise ValueError("Le fichier ne contient aucun incident.")
        ordered_years = sorted(years)
        missing_years = sorted(set(range(ordered_years[0], ordered_years[-1] + 1)) - years)
        annual = {}
        for dimension, values in aggregates.items():
            annual[dimension] = [
                {
                    "year": year,
                    "category": category,
                    **finalize_totals(totals),
                }
                for (year, category), totals in sorted(values.items())
            ]
        metadata = {
            "source": source.name,
            "sourceEncoding": encoding,
            "sourceColumnCount": len(source_columns),
            "retainedColumns": list(COLUMNS),
            "sourceRows": source_rows,
            "retainedRows": source_rows - duplicate_rows,
            "removedDuplicates": duplicate_rows,
            "unknownDeathIncidents": unknown_deaths,
            "invalidDeathValues": invalid_deaths,
            "unknownInjuryIncidents": unknown_injuries,
            "invalidInjuryValues": invalid_injuries,
            "unknownFlagIncidents": unknown_flags,
            "invalidFlagValues": invalid_flags,
            "years": ordered_years,
            "missingYears": missing_years,
            "dimensions": DIMENSIONS,
            "deathDefinition": "Somme des nkill connus.",
            "averageDeathDefinition": "Somme des nkill connus / nombre d'incidents avec nkill connu.",
            "injuryDefinition": "Somme des nwound connus.",
            "casualtyDefinition": "Somme de nkill + nwound pour les incidents où les deux valeurs sont connues.",
            "successRateDefinition": "100 * incidents avec success=1 / incidents avec success connu.",
            "flagDefinition": "0 ou 1 ; les valeurs absentes, -9 ou invalides restent inconnues.",
            "categoryDefinition": "Groupe, type d'attaque, arme et cible principaux uniquement.",
        }
        annual_path = temporary_directory / outputs[1].name
        with annual_path.open("w", encoding="utf-8") as stream:
            json.dump({"metadata": metadata, "data": annual}, stream, ensure_ascii=False, allow_nan=False)
            stream.write("\n")
        metadata_path = temporary_directory / outputs[2].name
        with metadata_path.open("w", encoding="utf-8") as stream:
            json.dump(metadata, stream, ensure_ascii=False, allow_nan=False)
            stream.write("\n")
        clean_path.replace(outputs[0])
        annual_path.replace(outputs[1])
        metadata_path.replace(outputs[2])
    return metadata


def main():
    parser = argparse.ArgumentParser(description="Préparer les données GTD pour un classement annuel.")
    parser.add_argument(
        "source", nargs="?", type=Path,
        default=PROJECT_DIRECTORY / "public/data/globalterrorismdb_0718dist.csv",
    )
    parser.add_argument("--output-dir", type=Path, default=PROJECT_DIRECTORY / "public/data")
    parser.add_argument("--encoding")
    arguments = parser.parse_args()
    try:
        metadata = prepare_data(arguments.source, arguments.output_dir, arguments.encoding)
    except (OSError, ValueError, csv.Error, LookupError) as error:
        parser.exit(1, f"Erreur de préparation : {error}\n")
    print(f"{metadata['retainedRows']} incidents conservés, {len(COLUMNS)} colonnes.")
    print(f"{metadata['unknownDeathIncidents']} incidents avec un nombre de morts inconnu.")
    print(f"{metadata['unknownInjuryIncidents']} incidents avec un nombre de blessés inconnu.")
    print(f"Années absentes : {', '.join(map(str, metadata['missingYears'])) or 'aucune'}.")
    print(f"Fichiers créés dans {arguments.output_dir} : gtd-clean.csv, gtd-annual.json, gtd-metadata.json")


if __name__ == "__main__":
    main()
