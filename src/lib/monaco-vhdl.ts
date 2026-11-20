import type { languages } from 'monaco-editor';

const vhdlLanguage: languages.IMonarchLanguage = {
  tokenPostfix: '.vhdl',
  defaultToken: '',
  ignoreCase: true,
  keywords: (
    'abs access after alias all and architecture array assert assume assume_guarantee attribute ' +
    'begin block body buffer bus case component configuration constant context cover default ' +
    'disconnect downto else elsif end entity exit fair file for force function generate generic ' +
    'group guarded if impure in inertial inout is label library linkage literal loop map mod ' +
    'nand new next nor not null of on open or others out package parameter port postponed ' +
    'procedure process property protected pure range record register reject release rem report ' +
    'restrict restrict_guarantee return rol ror select sequence severity shared signal sla sll ' +
    'sra srl strong subtype then to transport type unaffected units until use variable vmode ' +
    'vprop vunit wait when while with xnor xor'
  ).split(' '),
  types: (
    'bit bit_vector boolean character integer natural positive real time delay_length ' +
    'string severity_level std_logic std_logic_vector std_ulogic std_ulogic_vector ' +
    'signed unsigned line text file_open_kind file_open_status'
  ).split(' '),
  constants: 'true false note warning error failure fs ps ns us ms sec min hr'.split(' '),
  tokenizer: {
    root: [
      [/\s+/, 'white'],
      [/--.*$/, 'comment'],
      [/\/\*/, { token: 'comment', next: '@comment' }],
      // Bit strings may include a length and a signed/unsigned base prefix.
      [/(?:\d[\d_]*)?[us]?[boxd]"[\da-f_xzuwlh?\-]*"/, 'number'],
      [/\d[\d_]*#[\da-f_.]+#(?:e[+-]?\d[\d_]*)?/, 'number'],
      [/\d[\d_]*(?:\.\d[\d_]*)?(?:e[+-]?\d[\d_]*)?/, 'number'],
      [/"(?:[^"\r\n]|"")*"/, 'string'],
      [/'[^\r\n]'(?!\w)/, 'string'],
      [/'[a-z][\w]*/, 'type'],
      [/\\[^\\\r\n]+\\/, 'identifier'],
      [
        /[a-z][\w]*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@types': 'type',
            '@constants': 'number',
            '@default': 'identifier',
          },
        },
      ],
      [/[()[\]]/, '@brackets'],
      [/[;,.]/, 'delimiter'],
      [/[<>=:+\-*/&|?!']+/, 'operator'],
    ],
    comment: [
      [/[^*/]+/, 'comment'],
      [/\*\//, { token: 'comment', next: '@pop' }],
      [/[*/]/, 'comment'],
    ],
  },
};

export function registerVhdlLanguage(monaco: { languages: typeof languages }): void {
  if (monaco.languages.getLanguages().some(({ id }) => id === 'vhdl')) return;

  monaco.languages.register({
    id: 'vhdl',
    aliases: ['VHDL', 'vhdl'],
    extensions: ['.vhd', '.vhdl', '.vho'],
  });
  monaco.languages.setMonarchTokensProvider('vhdl', vhdlLanguage);
  monaco.languages.setLanguageConfiguration('vhdl', {
    comments: { lineComment: '--', blockComment: ['/*', '*/'] },
    brackets: [
      ['(', ')'],
      ['[', ']'],
    ],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '"', close: '"', notIn: ['string', 'comment'] },
    ],
  });
}
