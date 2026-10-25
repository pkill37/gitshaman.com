import { findSymbolsInFile } from './cross-reference';

export function findPedagogicalLandingLine(filePath: string, content: string): number | undefined {
  const lines = content.split('\n');

  if (/\.(md|rst|txt)$/i.test(filePath)) {
    for (let i = 0; i < lines.length; i++) {
      const markdownHeading = lines[i].match(/^#{1,6}\s+\S/);
      if (markdownHeading) {
        return i + 1;
      }

      const currentLine = lines[i].trim();
      const nextLine = lines[i + 1]?.trim() || '';
      if (currentLine && /^([=\-~^"'`:+*#<>_])\1+$/.test(nextLine)) {
        return i + 1;
      }
    }
    return 1;
  }

  const symbols = findSymbolsInFile(content, filePath);
  const preferredDefinition =
    symbols.find(
      (symbol) =>
        symbol.isDefinition &&
        symbol.line > 0 &&
        (symbol.type === 'function' || symbol.type === 'class' || symbol.type === 'struct')
    ) ??
    symbols.find(
      (symbol) =>
        symbol.isDefinition &&
        symbol.line > 0 &&
        (symbol.type === 'typedef' || symbol.type === 'macro')
    );

  if (preferredDefinition) {
    return preferredDefinition.line;
  }

  const firstCodeLine = lines.findIndex((line) => {
    const trimmed = line.trim();
    return (
      trimmed &&
      !trimmed.startsWith('//') &&
      !trimmed.startsWith('/*') &&
      !trimmed.startsWith('*') &&
      !trimmed.startsWith('#')
    );
  });

  return firstCodeLine >= 0 ? firstCodeLine + 1 : undefined;
}
