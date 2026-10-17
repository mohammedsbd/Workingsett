/** A small seeded random generator (mulberry32), so the worlds are deterministic. */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** A number in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A whole number in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error('pick from an empty list');
    return item;
  }

  /** `count` different items, in random order. */
  sample<T>(items: readonly T[], count: number): T[] {
    const pool = [...items];
    const out: T[] = [];
    while (out.length < count && pool.length) {
      const [item] = pool.splice(Math.floor(this.next() * pool.length), 1);
      out.push(item as T);
    }
    return out;
  }
}

/** Filler prose: realistic bulk that carries no facts, so pages cost tokens. */
export function fillerParagraphs(
  random: Random,
  sentences: readonly string[],
  paragraphs: number,
  perParagraph: number,
): string {
  const out: string[] = [];
  for (let p = 0; p < paragraphs; p++) {
    out.push(random.sample(sentences, perParagraph).join(' '));
  }
  return out.join('\n\n');
}
