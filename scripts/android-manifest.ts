import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { safeAndroidPath, type AndroidProject } from '../src/lib/android/workspace';

type Element = { tag: string; attrs: Record<string, string>; children: Element[] };
function elements(nodes: Record<string, unknown>[]): Element[] {
  return nodes.flatMap((node) => {
    const tag = Object.keys(node).find(
      (key) => key !== ':@' && !key.startsWith('#') && !key.startsWith('?')
    );
    if (!tag) return [];
    return [
      {
        tag,
        attrs: (node[':@'] ?? {}) as Record<string, string>,
        children: elements(node[tag] as Record<string, unknown>[]),
      },
    ];
  });
}
export async function resolveAndroidManifest(
  read: (file: string) => Promise<string>,
  manifestUrl: string,
  entry = 'default.xml'
): Promise<AndroidProject[]> {
  const remotes = new Map<string, Record<string, string>>();
  let defaults: Record<string, string> = {};
  const operations: Element[] = [];
  const visit = async (file: string, ancestors: string[]) => {
    safeAndroidPath(file);
    if (ancestors.includes(file) || ancestors.length > 32)
      throw new Error(`Android manifest include cycle: ${file}`);
    const xml = await read(file);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Manifest entities are not supported');
    if (XMLValidator.validate(xml) !== true) throw new Error(`Invalid manifest XML: ${file}`);
    const root = elements(
      new XMLParser({
        preserveOrder: true,
        ignoreAttributes: false,
        attributeNamePrefix: '',
        parseAttributeValue: false,
      }).parse(xml)
    );
    if (root.length !== 1 || root[0].tag !== 'manifest')
      throw new Error(`Missing manifest root: ${file}`);
    for (const node of root[0].children) {
      if (node.tag === 'include') await visit(node.attrs.name, [...ancestors, file]);
      else if (node.tag === 'remote') {
        if (remotes.has(node.attrs.name)) throw new Error(`Duplicate remote: ${node.attrs.name}`);
        remotes.set(node.attrs.name, node.attrs);
      } else if (node.tag === 'default') defaults = { ...defaults, ...node.attrs };
      else if (['project', 'extend-project', 'remove-project'].includes(node.tag))
        operations.push(node);
    }
  };
  await visit(entry, []);
  const projects = new Map<string, Element>();
  for (const node of operations) {
    const attrs = node.attrs;
    if (node.tag === 'project') {
      const path = safeAndroidPath(attrs.path || attrs.name);
      if (projects.has(path)) throw new Error(`Duplicate project path: ${path}`);
      projects.set(path, { ...node, attrs: { ...attrs, path } });
    } else {
      const matches = [...projects].filter(
        ([path, project]) =>
          project.attrs.name === attrs.name && (!attrs.path || path === attrs.path)
      );
      if (!matches.length && attrs.optional !== 'true')
        throw new Error(`Unknown manifest project: ${attrs.name}`);
      for (const [path, project] of matches) {
        if (node.tag === 'remove-project') projects.delete(path);
        else {
          projects.delete(path);
          const destination = safeAndroidPath(attrs['dest-path'] || path);
          if (projects.has(destination)) throw new Error(`Duplicate project path: ${destination}`);
          projects.set(destination, {
            ...project,
            attrs: { ...project.attrs, ...attrs, path: destination },
          });
        }
      }
    }
  }
  return [...projects.values()].map(({ attrs, children }) => {
    const remote = remotes.get(attrs.remote || defaults.remote);
    if (!remote?.fetch) throw new Error(`Unknown remote for ${attrs.name}`);
    const revision = attrs.revision || remote.revision || defaults.revision;
    if (!revision) throw new Error(`Missing revision: ${attrs.name}`);
    safeAndroidPath(attrs.name);
    const base = new URL(remote.fetch, manifestUrl.replace(/\.git$/, ''));
    if (!['https:', 'ssh:'].includes(base.protocol))
      throw new Error(`Unsupported manifest remote: ${base}`);
    const url = new URL(attrs.name, `${base.href.replace(/\/$/, '')}/`).href;
    return {
      path: attrs.path,
      name: attrs.name,
      url,
      revision,
      mappings: children
        .filter((node) => ['copyfile', 'linkfile'].includes(node.tag))
        .map((node) => ({
          kind: node.tag as 'copyfile' | 'linkfile',
          src: safeAndroidPath(node.attrs.src),
          dest: safeAndroidPath(node.attrs.dest),
        })),
    };
  });
}
