import { escapeHtml } from './markdown-navigation';

const KEYWORDS_BY_LANGUAGE: Record<string, string[]> = {
  c: [
    'auto',
    'break',
    'case',
    'const',
    'continue',
    'default',
    'do',
    'else',
    'enum',
    'extern',
    'for',
    'goto',
    'if',
    'inline',
    'register',
    'restrict',
    'return',
    'sizeof',
    'static',
    'struct',
    'switch',
    'typedef',
    'union',
    'volatile',
    'while',
  ],
  cpp: [
    'alignas',
    'alignof',
    'auto',
    'bool',
    'break',
    'case',
    'class',
    'const',
    'constexpr',
    'continue',
    'decltype',
    'default',
    'delete',
    'do',
    'else',
    'enum',
    'explicit',
    'extern',
    'for',
    'friend',
    'if',
    'inline',
    'namespace',
    'new',
    'noexcept',
    'operator',
    'private',
    'protected',
    'public',
    'return',
    'sizeof',
    'static',
    'struct',
    'switch',
    'template',
    'typename',
    'using',
    'virtual',
    'while',
  ],
  js: [
    'async',
    'await',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'default',
    'else',
    'export',
    'extends',
    'finally',
    'for',
    'from',
    'function',
    'if',
    'import',
    'let',
    'new',
    'return',
    'switch',
    'throw',
    'try',
    'typeof',
    'var',
    'while',
  ],
  python: [
    'and',
    'as',
    'assert',
    'async',
    'await',
    'break',
    'class',
    'continue',
    'def',
    'elif',
    'else',
    'except',
    'finally',
    'for',
    'from',
    'if',
    'import',
    'in',
    'is',
    'lambda',
    'not',
    'or',
    'pass',
    'raise',
    'return',
    'try',
    'while',
    'with',
    'yield',
  ],
};

const LANGUAGE_ALIASES: Record<string, string> = {
  asm: 'asm',
  assembly: 'asm',
  c: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  h: 'c',
  hpp: 'cpp',
  javascript: 'js',
  js: 'js',
  jsx: 'js',
  mjs: 'js',
  py: 'python',
  python: 'python',
  sh: 'shell',
  bash: 'shell',
  shell: 'shell',
  ts: 'js',
  tsx: 'js',
  typescript: 'js',
};

function normalizeLanguage(language: string | undefined): string | undefined {
  const normalized = language?.match(/^\S+/)?.[0].toLowerCase();
  if (!normalized) return undefined;
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

function highlightLine(line: string, language: string | undefined): string {
  let html = escapeHtml(line);

  html = html.replace(
    /(&quot;(?:\\.|[^&])*?&quot;|'(?:\\.|[^'])*?')/g,
    '<span class="code-token-string">$1</span>'
  );
  html = html.replace(
    /\b(0x[\da-fA-F]+|\d+(?:\.\d+)?)\b/g,
    '<span class="code-token-number">$1</span>'
  );

  const keywords = KEYWORDS_BY_LANGUAGE[language ?? ''] ?? [];
  if (keywords.length > 0) {
    const keywordPattern = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g');
    html = html.replace(keywordPattern, '<span class="code-token-keyword">$1</span>');
  }

  return html;
}

function highlightComment(line: string, language: string | undefined): string {
  const commentStart =
    language === 'python' || language === 'shell'
      ? line.indexOf('#')
      : language === 'asm'
        ? line.indexOf(';')
        : line.indexOf('//');

  if (commentStart < 0) {
    return highlightLine(line, language);
  }

  return `${highlightLine(line.slice(0, commentStart), language)}<span class="code-token-comment">${escapeHtml(
    line.slice(commentStart)
  )}</span>`;
}

export function renderHighlightedCodeBlock(code: string, languageInput?: string): string {
  const language = normalizeLanguage(languageInput);
  const classAttr = language ? ` class="language-${escapeHtml(language)}"` : '';
  const highlighted = code
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => highlightComment(line, language))
    .join('\n');

  return `<pre class="code-block-highlighted"><code${classAttr}>${highlighted}\n</code></pre>`;
}
