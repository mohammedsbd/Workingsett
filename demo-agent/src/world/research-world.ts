import { fillerParagraphs, Random } from './random.js';

/**
 * The research agent's synthetic web: fictional energy-storage sites, each
 * with a site page (capacity, efficiency, commissioning year) and a news
 * page (operator, cell supplier, region), plus one overview page per
 * technology. Everything is invented, so a model cannot answer from what
 * it already knows, and generated from a fixed seed, so it never changes.
 *
 * Some site pages are revised partway through a run: re-fetching them
 * later gives the new capacity, so only the agent's memory (or Parsim's
 * recall of the archived original) has the figure it first read.
 */

export const RESEARCH_SEED = 1609;
export const SUBJECT_COUNT = 24;
/** Subjects 1 to REVISED_SUBJECTS get a revised site page... */
export const REVISED_SUBJECTS = 8;
/** ...from this question on (1-based, the first late-recall question). */
export const REVISION_FROM_QUESTION = 17;

const PREFIXES = [
  'Halvorsen',
  'Kestrel',
  'Varde',
  'Orlin',
  'Tamsk',
  'Brevik',
  'Calder',
  'Myrhaug',
  'Solvane',
  'Ravna',
  'Dunmore',
  'Elstad',
  'Fjellmark',
  'Grimsel',
  'Hesketh',
  'Ilvary',
  'Jorund',
  'Kallan',
  'Lysholt',
  'Norrow',
  'Ostrava',
  'Pellam',
  'Quenby',
  'Rindal',
] as const;
const SUFFIXES = [
  'Ridge',
  'Basin',
  'Point',
  'Hollow',
  'Works',
  'Array',
  'Terrace',
  'Flats',
] as const;
export const TECHNOLOGIES = [
  'sodium-ion',
  'iron-air',
  'vanadium flow',
  'compressed air',
  'gravity storage',
  'molten salt',
  'zinc-bromine',
  'lithium iron phosphate',
] as const;
const REGIONS = [
  'Northmark',
  'Easthollow',
  'the Veldt Coast',
  'Ironfjord',
  'Saltmere',
  'Greywater',
  'Ambervale',
] as const;
const OPERATOR_WORDS = [
  'Aurel',
  'Brightline',
  'Cobalt Vale',
  'Driftwood',
  'Emberly',
  'Fairhaven',
  'Granite Bay',
  'Harrow',
  'Ivory Coastline',
  'Juniper',
  'Kingsmere',
  'Lowtide',
] as const;
const SUPPLIER_WORDS = [
  'Arcwell',
  'Boreal',
  'Cindral',
  'Delvon',
  'Eskar',
  'Ferrovia',
  'Galen',
  'Halcyon',
  'Isotta',
  'Jarrow',
] as const;

const FILLER = [
  'Grid operators value storage that can shift energy from midday surpluses to the evening peak.',
  'Engineers stress that results depend on temperature, cycle count and the test protocol used.',
  'Figures from different laboratories are not directly comparable, because each lab defines a cycle differently.',
  'Permitting took longer than the construction itself, a pattern seen at several sites in the region.',
  'The control system dispatches the plant in five-minute intervals against the wholesale price.',
  'Local councils asked for noise studies before approving the auxiliary cooling equipment.',
  'Maintenance crews inspect the containment and the power electronics on a quarterly schedule.',
  'Analysts expect the levelized cost of storage to keep falling as supply chains mature.',
  'The site was chosen for its existing substation and a transmission line with spare capacity.',
  'A community fund receives a small share of the revenue from frequency regulation services.',
  'Commissioning tests ran for several weeks before the plant joined the balancing market.',
  'Insurance terms were negotiated after a review of fire suppression and thermal monitoring.',
  'Weather data from a nearby station is used to forecast charging opportunities a day ahead.',
  'The developers published a lessons-learned report covering procurement and grid connection.',
  'Round-trip efficiency is measured at the point of interconnection, after auxiliary loads.',
  'Degradation is tracked with a monthly capacity test at a fixed state of charge.',
  'Researchers caution against reading too much into a single season of operating data.',
  'Several neighbouring utilities have signed agreements to buy capacity during winter peaks.',
  'The battery hall is divided into fire compartments, each with its own ventilation path.',
  'Operators report that availability improved after a firmware update to the inverters.',
  'A training programme with the regional college supplies technicians for the night shift.',
  'Spare parts are held on site to keep repair times short during the winter months.',
  'The plant can black-start a nearby gas turbine, which the grid operator tests twice a year.',
  'Noise from the cooling fans stays below the limits agreed with the neighbouring village.',
  'Earlier feasibility studies considered pumped hydro, which the terrain made too expensive.',
  'The connection agreement limits export during summer evenings when the line is congested.',
  'Data from the site feeds a public dashboard that shows charging and discharging in real time.',
  'Recycling partners have agreed to take back modules at the end of their service life.',
  'A second phase is under discussion, depending on the outcome of the next capacity auction.',
  'The site uses rainwater collection to supply its cooling loop during dry periods.',
] as const;

export type ResearchSubject = {
  /** 1-based; question i of the run researches subject i. */
  index: number;
  slug: string;
  name: string;
  technology: (typeof TECHNOLOGIES)[number];
  region: (typeof REGIONS)[number];
  operator: string;
  supplier: string;
  /** Capacity (MWh) on the original site page. */
  capacityMwh: number;
  /** Capacity after the revision (only for revised subjects). */
  revisedCapacityMwh: number | null;
  efficiencyPercent: number;
  commissionedYear: number;
};

export type SearchResult = { title: string; url: string; snippet: string };

export const SITE_HOST = 'https://atlas.example';
export const NEWS_HOST = 'https://wire.example';

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function buildSubjects(seed = RESEARCH_SEED): ResearchSubject[] {
  const random = new Random(seed);
  return PREFIXES.slice(0, SUBJECT_COUNT).map((prefix, i) => {
    const name = `${prefix} ${random.pick(SUFFIXES)}`;
    const capacityMwh = random.int(120, 980);
    const revised = i + 1 <= REVISED_SUBJECTS;
    return {
      index: i + 1,
      slug: slugify(name),
      name,
      technology: TECHNOLOGIES[i % TECHNOLOGIES.length] ?? 'sodium-ion',
      region: random.pick(REGIONS),
      operator: `${random.pick(OPERATOR_WORDS)} Energy`,
      supplier: `${random.pick(SUPPLIER_WORDS)} Cells`,
      capacityMwh,
      revisedCapacityMwh: revised
        ? capacityMwh + random.pick([-1, 1]) * random.int(40, 110)
        : null,
      efficiencyPercent: random.int(61, 92),
      commissionedYear: random.int(2027, 2034),
    };
  });
}

export class ResearchWorld {
  readonly subjects: ResearchSubject[];

  constructor(seed = RESEARCH_SEED) {
    this.subjects = buildSubjects(seed);
  }

  subject(index: number): ResearchSubject {
    const subject = this.subjects[index - 1];
    if (!subject) throw new Error(`No research subject ${index}`);
    return subject;
  }

  siteUrl(subject: ResearchSubject): string {
    return `${SITE_HOST}/sites/${subject.slug}`;
  }

  newsUrl(subject: ResearchSubject): string {
    return `${NEWS_HOST}/news/${subject.slug}`;
  }

  techUrl(technology: string): string {
    return `${SITE_HOST}/technology/${slugify(technology)}`;
  }

  /**
   * The subject a query is about: the first subject whose name prefix is
   * in the query, else the first subject of a technology named in it.
   * This is also the canonical form of a search for recordings, so any
   * wording of a query about the same site replays the same results.
   */
  matchSubject(query: string): ResearchSubject | null {
    const text = query.toLowerCase();
    let best: { subject: ResearchSubject; at: number } | null = null;
    for (const subject of this.subjects) {
      const at = text.indexOf(subject.name.split(' ')[0]!.toLowerCase());
      if (at >= 0 && (!best || at < best.at)) best = { subject, at };
    }
    if (best) return best.subject;
    for (const technology of TECHNOLOGIES) {
      if (text.includes(technology)) {
        return this.subjects.find((s) => s.technology === technology) ?? null;
      }
    }
    return null;
  }

  search(subjectSlug: string | null): SearchResult[] {
    const subject = this.subjects.find((s) => s.slug === subjectSlug);
    if (!subject) return [];
    return [
      {
        title: `${subject.name}: site profile`,
        url: this.siteUrl(subject),
        snippet: `Profile of the ${subject.technology} storage site ${subject.name}: capacity, efficiency and commissioning.`,
      },
      {
        title: `${subject.name} in the news`,
        url: this.newsUrl(subject),
        snippet: `Who operates ${subject.name}, who supplies its cells, and where it is.`,
      },
      {
        title: `Overview: ${subject.technology} storage`,
        url: this.techUrl(subject.technology),
        snippet: `A general introduction to ${subject.technology} storage.`,
      },
    ];
  }

  /** The site page revision a fetch sees during a question (1-based). */
  revisionAt(url: string, questionIndex: number): number {
    const subject = this.subjects.find((s) => this.siteUrl(s) === url);
    return subject?.revisedCapacityMwh !== null &&
      subject !== undefined &&
      questionIndex >= REVISION_FROM_QUESTION
      ? 2
      : 1;
  }

  /** The page at `url` in `revision`, or null if there is none. */
  page(url: string, revision: number): string | null {
    for (const subject of this.subjects) {
      if (url === this.siteUrl(subject))
        return this.sitePage(subject, revision);
      if (url === this.newsUrl(subject)) return this.newsPage(subject);
    }
    const technology = TECHNOLOGIES.find((t) => url === this.techUrl(t));
    return technology ? this.techPage(technology) : null;
  }

  /** Every URL the world serves, for recording. */
  urls(): string[] {
    return [
      ...this.subjects.flatMap((s) => [this.siteUrl(s), this.newsUrl(s)]),
      ...TECHNOLOGIES.map((t) => this.techUrl(t)),
    ];
  }

  private sitePage(subject: ResearchSubject, revision: number): string {
    const random = new Random(RESEARCH_SEED * 31 + subject.index);
    const capacity =
      revision === 2 && subject.revisedCapacityMwh !== null
        ? subject.revisedCapacityMwh
        : subject.capacityMwh;
    return [
      `# ${subject.name}`,
      `Site profile, revision ${revision}.`,
      fillerParagraphs(random, FILLER, 3, 5),
      `## Key figures`,
      `- Technology: ${subject.technology}`,
      `- Storage capacity: ${capacity} MWh`,
      `- Round-trip efficiency: ${subject.efficiencyPercent}%`,
      `- Commissioned: ${subject.commissionedYear}`,
      fillerParagraphs(random, FILLER, 5, 5),
    ].join('\n\n');
  }

  private newsPage(subject: ResearchSubject): string {
    const random = new Random(RESEARCH_SEED * 37 + subject.index);
    return [
      `# ${subject.name} in the news`,
      fillerParagraphs(random, FILLER, 2, 5),
      `${subject.name} is operated by ${subject.operator}. Its cells are supplied by ${subject.supplier}. The site is in ${subject.region}.`,
      fillerParagraphs(random, FILLER, 4, 5),
    ].join('\n\n');
  }

  private techPage(technology: string): string {
    const random = new Random(RESEARCH_SEED * 41 + technology.length);
    return [
      `# ${technology} storage`,
      fillerParagraphs(random, FILLER, 3, 4),
    ].join('\n\n');
  }
}
