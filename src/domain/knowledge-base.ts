import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface KbSection {
  source: string;
  heading: string;
  text: string;
}

const WORD = /[a-z0-9]+/g;
const STOPWORDS = new Set(
  'a an and are as at be by can do does for from has have how i if in is it its my of on or our so that the their there this to was we what when where which who will with you your'.split(' '),
);

function terms(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? []).filter((t) => !STOPWORDS.has(t));
}

/**
 * Keyword search over markdown sections. Deliberately simple: retrieval quality is what the
 * rag-aws demo is about; this demo is about the agent and its guardrails.
 */
export class KnowledgeBase {
  constructor(private readonly sections: KbSection[]) {}

  static fromDir(dir = join(__dirname, '..', '..', 'data', 'kb')): KnowledgeBase {
    const sections: KbSection[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
      const body = readFileSync(join(dir, file), 'utf8');
      for (const part of body.split(/^## /m).slice(1)) {
        const [heading, ...rest] = part.split('\n');
        sections.push({ source: file, heading: heading.trim(), text: rest.join(' ').replace(/\s+/g, ' ').trim() });
      }
    }
    return new KnowledgeBase(sections);
  }

  search(query: string, k = 3): KbSection[] {
    const q = new Set(terms(query));
    if (q.size === 0) return [];
    return this.sections
      .map((s) => ({ s, score: terms(`${s.heading} ${s.text}`).filter((t) => q.has(t)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((x) => x.s);
  }
}
