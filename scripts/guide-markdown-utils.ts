export interface FencedBlock {
  code: string;
  line: number;
}

export interface SectionFrontmatterBlock {
  frontmatter: string;
  prose: string;
}

export function isFenceMarker(line: string): boolean {
  const t = line.trim();
  return t.startsWith('```') || t.startsWith('~~~');
}

export function extractFencedBlocks(raw: string, language: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  const lines = raw.split('\n');
  const fence = '```' + language;
  let i = 0;

  while (i < lines.length) {
    if (lines[i].trim() === fence) {
      const startLine = i + 1;
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '```') {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ code: codeLines.join('\n'), line: startLine });
    } else {
      i++;
    }
  }

  return blocks;
}

export function extractSectionFrontmatterBlocks(content: string): SectionFrontmatterBlock[] {
  const blocks: SectionFrontmatterBlock[] = [];
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    let inFence = false;
    const sectionStartSearchFrom = i;
    while (i < lines.length) {
      if (isFenceMarker(lines[i])) inFence = !inFence;
      if (!inFence && lines[i].trim() === '---') break;
      i++;
    }
    if (i >= lines.length) break;
    const sectionStart = i;
    i++;
    while (i < lines.length && lines[i].trim() === '') i++;

    const fmLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '---') {
      fmLines.push(lines[i]);
      i++;
    }
    if (i < lines.length) i++;

    const frontmatter = fmLines.join('\n').trim();
    if (!frontmatter) continue;

    const { id, title } = parseFrontmatterTitleFields(frontmatter);
    if (!id && !title) {
      // This delimiter was prose, not section metadata. Resume after the
      // opening marker so the next --- can still become a real section start.
      i = Math.max(sectionStart + 1, sectionStartSearchFrom + 1);
      continue;
    }

    const proseLines: string[] = [];
    inFence = false;
    while (i < lines.length) {
      if (isFenceMarker(lines[i])) inFence = !inFence;
      if (!inFence && lines[i].trim() === '---') break;
      proseLines.push(lines[i]);
      i++;
    }

    blocks.push({ frontmatter, prose: proseLines.join('\n') });
  }

  return blocks;
}

export function parseFrontmatterTitleFields(frontmatter: string): { id?: string; title?: string } {
  const idMatch = frontmatter.match(/^id:\s*(.+)$/m);
  const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);
  return {
    id: idMatch?.[1].trim(),
    title: titleMatch?.[1].trim(),
  };
}
