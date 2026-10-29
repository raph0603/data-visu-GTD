import { ISO_ALPHA3_TO_ALPHA2 } from './iso3166';

/**
 * French labels of the GTD categories, shared by every view. The data files keep the source labels
 * (they are filter values in the URL); only the display is translated. An unknown label is shown as is.
 */
const CATEGORY_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  attackType: {
    'Bombing/Explosion': 'Attentat à l’explosif',
    'Armed Assault': 'Attaque armée',
    Assassination: 'Assassinat',
    'Hostage Taking (Kidnapping)': 'Enlèvement',
    'Facility/Infrastructure Attack': 'Attaque d’installation',
    'Unarmed Assault': 'Agression sans arme',
    'Hostage Taking (Barricade Incident)': 'Prise d’otages retranchée',
    Hijacking: 'Détournement',
    Unknown: 'Type inconnu',
  },
  targetType: {
    'Private Citizens & Property': 'Civils et biens privés',
    Military: 'Armée',
    Police: 'Police',
    'Government (General)': 'Gouvernement',
    Business: 'Entreprises',
    Transportation: 'Transports',
    Utilities: 'Réseaux (eau, énergie)',
    'Religious Figures/Institutions': 'Religieux et lieux de culte',
    'Educational Institution': 'Enseignement',
    'Government (Diplomatic)': 'Diplomatie',
    'Terrorists/Non-State Militia': 'Groupes armés non étatiques',
    'Journalists & Media': 'Journalistes et médias',
    'Violent Political Party': 'Partis politiques violents',
    'Airports & Aircraft': 'Aéroports et avions',
    Telecommunication: 'Télécommunications',
    NGO: 'ONG',
    Tourists: 'Touristes',
    Maritime: 'Maritime',
    'Food or Water Supply': 'Eau et alimentation',
    'Abortion Related': 'Lié à l’avortement',
    Other: 'Autre cible',
    Unknown: 'Cible inconnue',
  },
  weaponType: {
    Explosives: 'Explosifs',
    Firearms: 'Armes à feu',
    Incendiary: 'Incendiaire',
    Melee: 'Arme blanche',
    Chemical: 'Chimique',
    'Sabotage Equipment': 'Matériel de sabotage',
    'Vehicle (not to include vehicle-borne explosives, i.e., car or truck bombs)': 'Véhicule (hors voiture piégée)',
    Biological: 'Biologique',
    'Fake Weapons': 'Fausse arme',
    Radiological: 'Radiologique',
    Other: 'Autre arme',
    Unknown: 'Arme inconnue',
  },
  region: {
    'Middle East & North Africa': 'Moyen-Orient et Afrique du Nord',
    'South Asia': 'Asie du Sud',
    'South America': 'Amérique du Sud',
    'Sub-Saharan Africa': 'Afrique subsaharienne',
    'Western Europe': 'Europe de l’Ouest',
    'Southeast Asia': 'Asie du Sud-Est',
    'Central America & Caribbean': 'Amérique centrale et Caraïbes',
    'Eastern Europe': 'Europe de l’Est',
    'North America': 'Amérique du Nord',
    'East Asia': 'Asie de l’Est',
    'Central Asia': 'Asie centrale',
    'Australasia & Oceania': 'Australasie et Océanie',
  },
  group: { Unknown: 'Auteur inconnu' },
  suicide: { '1': 'Attentats-suicides', '0': 'Hors attentats-suicides' },
};

/** Display label of a category value of a dimension (attackType, targetType, weaponType, region, group). */
export function categoryLabel(dim: string, value: string): string {
  return CATEGORY_LABELS[dim]?.[value] ?? value;
}

let regionNames: Intl.DisplayNames | null | undefined;

/** French short name of a country ("Irak", "Royaume-Uni"); `fallback` when the runtime has none. */
export function countryName(iso3: string, fallback: string = iso3): string {
  const alpha2 = ISO_ALPHA3_TO_ALPHA2[iso3];
  if (alpha2 === undefined) return fallback;
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['fr'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }
  const name = regionNames?.of(alpha2);
  return name !== undefined && name !== alpha2 ? name : fallback;
}
