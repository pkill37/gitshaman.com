import type { languages } from 'monaco-editor';

export function isMakefilePath(path: string): boolean {
  const basename = path.split(/[\\/]/).pop() ?? '';
  return /^(?:makefile|makefil0|gnumakefile)(?:\..+)?$/i.test(basename) || /\.mk$/i.test(basename);
}

const makefileLanguage: languages.IMonarchLanguage = {
  tokenPostfix: '.makefile',
  defaultToken: '',
  ignoreCase: true,
  tokenizer: {
    root: [
      [/^\t/, { token: 'white', next: '@recipe' }],
      [
        /^[ \t]*![ \t]*(?:if|ifdef|ifndef|elseif|else|endif|include|error|message|undef|cmdswitches)\b/,
        'keyword',
      ],
      [
        /^\s*(?:-?include|sinclude|ifeq|ifneq|ifdef|ifndef|else|endif|define|endef|export|unexport|override|private|vpath|undefine)\b/,
        'keyword',
      ],
      [/^[ \t]*[\w.-]+(?=[ \t]*(?:::?=|[+?!:]?=))/, 'variable'],
      [/^(?=[^\t#:=\s][^#:=]*:(?!=))/, { token: '', next: '@target' }],
      { include: '@common' },
      [/:::=|::=|:=|\?=|\+=|!=|=|:|\|/, 'operator'],
    ],
    target: [
      [/::?/, { token: 'delimiter', next: '@pop' }],
      { include: '@common' },
      [/[^\s:$#]+/, 'function'],
    ],
    recipe: [
      [/^(?!\t)/, { token: '@rematch', next: '@pop' }],
      { include: '@common' },
      [/\b(?:if|then|else|elif|fi|for|in|do|done|while|case|esac)\b/, 'keyword'],
      [/[;|&<>]+/, 'operator'],
      [/\\$/, 'string.escape'],
      [/$/, { token: '', next: '@pop' }],
    ],
    common: [
      [/\\#/, 'string.escape'],
      [/#.*$/, 'comment'],
      [/\$\$/, 'string.escape'],
      [/\$[({]/, { token: 'type', next: '@variable' }],
      [/\$[\w@%<?^+*|!\-]/, 'type'],
      [/"/, { token: 'string', next: '@doubleQuoted' }],
      [/'[^']*'/, 'string'],
      [/\b\d+\b/, 'number'],
    ],
    variable: [
      [/\$[({]/, { token: 'type', next: '@push' }],
      [/[)}]/, { token: 'type', next: '@pop' }],
      [
        /\b(?:subst|patsubst|strip|findstring|filter|filter-out|sort|word|wordlist|words|firstword|lastword|dir|notdir|suffix|basename|addsuffix|addprefix|join|wildcard|realpath|abspath|if|or|and|foreach|file|call|value|eval|origin|flavor|shell|error|warning|info)\b/,
        'keyword',
      ],
      [/[^$(){}\s,]+/, 'type'],
      [/\s+|,/, 'delimiter'],
    ],
    doubleQuoted: [
      [/\\./, 'string.escape'],
      [/\$[({]/, { token: 'type', next: '@variable' }],
      [/\$[\w@%<?^+*|!\-]/, 'type'],
      [/"/, { token: 'string', next: '@pop' }],
      [/[^"\\$]+/, 'string'],
    ],
  },
};

export function registerMakefileLanguage(monaco: { languages: typeof languages }): void {
  if (monaco.languages.getLanguages().some(({ id }) => id === 'makefile')) return;

  monaco.languages.register({
    id: 'makefile',
    aliases: ['Makefile', 'make'],
    filenames: ['Makefile', 'makefile', 'GNUmakefile', 'makefil0'],
    extensions: ['.mk'],
  });
  monaco.languages.setMonarchTokensProvider('makefile', makefileLanguage);
  monaco.languages.setLanguageConfiguration('makefile', {
    comments: { lineComment: '#' },
    brackets: [
      ['(', ')'],
      ['{', '}'],
    ],
  });
}
