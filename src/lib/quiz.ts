export type QuizSession = {
  id?: string;
  status: string;
  target?: string;
  progress?: { completed: number; total: number };
  question?: { id: string; prompt: string; choices: string[] };
  feedback?: string;
};

export type QuizRequest = {
  action: 'start' | 'resume' | 'answer' | 'explain';
  staged?: boolean;
  id?: string;
  text?: string;
};

export type SharedQuiz = {
  version: 1;
  repository: string;
  revision: string;
  questions: Array<{ prompt: string; explanation?: string }>;
};

export const SHARED_QUIZ_LIMIT = 24000;

// Anki text import: two HTML fields per note, with literal code escaped.
export function ankiQuizText(questions: SharedQuiz['questions']): string {
  if (!questions.length) throw new Error('Generate or import a quiz before exporting to Anki.');
  const field = (text: string) =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/^#/g, '&#35;')
      .replace(/\t/g, '&#9;')
      .replace(/\r\n|\r|\n/g, '<br>');
  return [
    '#separator:Tab',
    '#html:true',
    '#columns:Front\tBack',
    ...questions.map(({ prompt, explanation }) =>
      [
        field(prompt),
        field(
          explanation?.trim()
            ? explanation
            : 'No explanation was included. Review the source to check your reasoning.'
        ),
      ].join('\t')
    ),
    '',
  ].join('\n');
}

export function parseSharedQuiz(text: string): SharedQuiz {
  if (text.length > SHARED_QUIZ_LIMIT) throw new Error('Shared quiz is too large.');
  const value = JSON.parse(text) as SharedQuiz;
  if (
    !value ||
    value.version !== 1 ||
    typeof value.repository !== 'string' ||
    !/^[\w.-]+\/[\w.-]+$/.test(value.repository) ||
    value.repository.split('/').some((part) => part === '.' || part === '..') ||
    typeof value.revision !== 'string' ||
    !/^[a-f0-9]{7,64}$/i.test(value.revision) ||
    !Array.isArray(value.questions) ||
    value.questions.length < 1 ||
    value.questions.length > 30 ||
    value.questions.some(
      (q) =>
        !q ||
        typeof q.prompt !== 'string' ||
        !q.prompt.trim() ||
        q.prompt.length > 8000 ||
        (q.explanation !== undefined &&
          (typeof q.explanation !== 'string' || q.explanation.length > 8000))
    )
  )
    throw new Error('Invalid shared quiz. Expected a repository, commit, and practice questions.');
  // Copy only the public fields. Answers, credentials, and local paths are never exported.
  return {
    version: 1,
    repository: value.repository,
    revision: value.revision,
    questions: value.questions.map(({ prompt, explanation }) => ({ prompt, explanation })),
  };
}

export function sharedQuizURL(quiz: SharedQuiz): string {
  const sanitized = parseSharedQuiz(JSON.stringify(quiz));
  return `https://gitshaman.com/${sanitized.repository}?ref=${sanitized.revision}&view=quiz#quiz=${encodeURIComponent(JSON.stringify(sanitized))}`;
}
