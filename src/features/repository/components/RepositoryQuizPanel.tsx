'use client';

import { useEffect, useRef, useState } from 'react';
import { getRepositoryDataSource } from '@/lib/repository-data-source';
import {
  ankiQuizText,
  parseSharedQuiz,
  sharedQuizURL,
  SHARED_QUIZ_LIMIT,
  type QuizRequest,
  type QuizSession,
  type SharedQuiz,
} from '@/lib/quiz';
import './repository-quiz.css';

export default function RepositoryQuizPanel({ owner, repo }: { owner: string; repo: string }) {
  const source = getRepositoryDataSource(owner, repo);
  const [shared] = useState((): { quiz: SharedQuiz | null; error: string } => {
    if (typeof window === 'undefined' || !location.hash.startsWith('#quiz='))
      return { quiz: null, error: '' };
    try {
      if (location.hash.length > SHARED_QUIZ_LIMIT * 4)
        throw new Error('Shared quiz is too large.');
      const quiz = parseSharedQuiz(decodeURIComponent(location.hash.slice(6)));
      if (quiz.repository !== `${owner}/${repo}`)
        throw new Error('This quiz belongs to a different repository. Open its shared link.');
      return { quiz, error: '' };
    } catch (reason) {
      return { quiz: null, error: (reason as Error).message };
    }
  });
  const [session, setSession] = useState<QuizSession | null>(null);
  const [answer, setAnswer] = useState('');
  const [staged, setStaged] = useState(
    () =>
      typeof window !== 'undefined' && new URLSearchParams(location.search).get('staged') === '1'
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(shared.error);
  const [notice, setNotice] = useState('');
  const [practice, setPractice] = useState<SharedQuiz | null>(shared.quiz);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [history, setHistory] = useState<SharedQuiz['questions']>([]);
  const [repository, setRepository] = useState(source?.quizRepository ?? `${owner}/${repo}`);
  const [revision, setRevision] = useState(source?.quizRevision ?? '');
  const controller = useRef<AbortController | null>(null);

  const loadPractice = (quiz: SharedQuiz) => {
    setPractice(quiz);
    setPracticeIndex(0);
    setRevealed(false);
    setAnswer('');
    setError('');
  };
  useEffect(() => () => controller.current?.abort(), []);

  const request = async (input: QuizRequest) => {
    if (!source?.quiz || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    controller.current = new AbortController();
    try {
      const next = await source.quiz(input, controller.current.signal);
      if (session?.question && ['answer', 'explain'].includes(input.action)) {
        const prompt = session.question.prompt;
        setHistory((items) => {
          const previous = items.find((item) => item.prompt === prompt);
          return [
            ...items.filter((item) => item.prompt !== prompt),
            { prompt, explanation: next.feedback || previous?.explanation },
          ];
        });
      }
      setSession(next);
      setAnswer('');
    } catch (reason) {
      if (!controller.current.signal.aborted) setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const exportQuiz = async (format: 'link' | 'json' | 'anki') => {
    setError('');
    try {
      const questions = [...history];
      if (session?.question && !questions.some((item) => item.prompt === session.question?.prompt))
        questions.push({ prompt: session.question.prompt });
      if (format === 'anki') {
        const url = URL.createObjectURL(
          new Blob([ankiQuizText(practice?.questions ?? questions)], {
            type: 'text/plain;charset=utf-8',
          })
        );
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'gitshaman-quiz-anki.txt';
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice(
          'Anki quiz downloaded. In Anki, choose File → Import, select Basic notes and your deck, and map Front and Back.'
        );
        return;
      }
      const quiz =
        practice ??
        parseSharedQuiz(
          JSON.stringify({
            version: 1,
            repository,
            revision,
            questions,
          })
        );
      if (format === 'link') {
        await navigator.clipboard.writeText(sharedQuizURL(quiz));
        setNotice(
          'Practice link copied. It contains questions and explanations, without your answers.'
        );
      } else {
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(quiz, null, 2)], { type: 'application/json' })
        );
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'gitshaman-quiz.json';
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice('Practice quiz downloaded.');
      }
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  const question = practice?.questions[practiceIndex];

  return (
    <section className="repository-quiz" aria-label="Repository quiz" aria-busy={busy}>
      <header>
        <h2>Quiz</h2>
        <p>Understand the change. Keep the code open while you reason.</p>
      </header>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {practice ? (
        <>
          <p>
            Shared practice · {practice.repository} · {practice.revision.slice(0, 7)}
          </p>
          <a
            href={`https://github.com/${practice.repository}/tree/${practice.revision}`}
            target="_blank"
            rel="noreferrer"
          >
            Source at this quiz's commit ↗
          </a>
          <p>
            Question {practiceIndex + 1} of {practice.questions.length}
          </p>
          <h3>{question?.prompt}</h3>
          <label>
            Your reasoning
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              maxLength={16000}
            />
          </label>
          <p>Your practice answer stays in this browser. Practice does not approve a Git push.</p>
          <button onClick={() => setRevealed(true)}>Show explanation</button>
          {revealed && (
            <p className="quiz-feedback">
              {question?.explanation ||
                'No explanation was included. Compare your reasoning with the source.'}
            </p>
          )}
          {revealed && practiceIndex < practice.questions.length - 1 && (
            <button
              onClick={() => {
                setPracticeIndex((i) => i + 1);
                setRevealed(false);
                setAnswer('');
              }}
            >
              Next question
            </button>
          )}
          {revealed && practiceIndex === practice.questions.length - 1 && (
            <p role="status">Practice complete. Share it with someone learning this code.</p>
          )}
          <button onClick={() => setPractice(null)}>Close practice</button>
        </>
      ) : source?.quiz ? (
        <>
          <p>
            Powered by{' '}
            <a href="https://sphinx-six-theta.vercel.app/" target="_blank" rel="noreferrer">
              Sphinx
            </a>
            . Your configured reviewer receives the change and your answers.
          </p>
          {!session && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={staged}
                  onChange={(e) => setStaged(e.target.checked)}
                  disabled={busy}
                />{' '}
                Quiz staged changes
              </label>
              <button disabled={busy} onClick={() => void request({ action: 'start', staged })}>
                Start or resume quiz
              </button>
              <p>
                First time? Install <code>sphinx-understand</code> and run{' '}
                <code>gitshaman quiz install-hooks</code> to choose a reviewer. Use{' '}
                <code>gitshaman quiz init</code> for repository policy.
              </p>
            </>
          )}
          {session?.progress && (
            <p>
              {session.progress.completed} of {session.progress.total} concepts complete
            </p>
          )}
          {session?.feedback && (
            <p className="quiz-feedback" role="status">
              {session.feedback}
            </p>
          )}
          {session?.status === 'passed' && <p role="status">Understanding check passed.</p>}
          {session?.status === 'not-required' && (
            <p role="status">
              No assessment is required for this change under the current Sphinx policy.
            </p>
          )}
          {session?.question && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void request({ action: 'answer', id: session.id, text: answer });
              }}
            >
              <h3>{session.question.prompt}</h3>
              {session.question.choices.map((choice, index) => (
                <button type="button" key={index} disabled={busy} onClick={() => setAnswer(choice)}>
                  {choice}
                </button>
              ))}
              <label>
                Your answer
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  maxLength={16000}
                  disabled={busy}
                  required
                />
              </label>
              <button type="submit" disabled={busy || !answer.trim()}>
                Check answer
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void request({ action: 'explain', id: session.id })}
              >
                Explain and try another scenario
              </button>
            </form>
          )}
          {session?.id && session.status !== 'passed' && (
            <button
              disabled={busy}
              onClick={() => void request({ action: 'resume', id: session.id })}
            >
              Refresh checkpoint
            </button>
          )}
          {busy && (
            <p role="status">Sphinx is reviewing… You can browse the code while it works.</p>
          )}
        </>
      ) : (
        <>
          <h3>Practice and study offline</h3>
          <p>
            Import a practice quiz below or open a shared practice link to study alongside the
            source. Choose Download for Anki to take the full question set with you for offline
            review.
          </p>
          <p>
            Generate questions about your own changes with <code>gitshaman quiz</code>. Local checks
            use{' '}
            <a href="https://sphinx-six-theta.vercel.app/" target="_blank" rel="noreferrer">
              Sphinx
            </a>
            .
          </p>
          <pre>
            gitshaman init{'\n'}gitshaman analyze --no-embed{'\n'}gitshaman quiz
          </pre>
        </>
      )}
      <label className="quiz-import">
        Import practice quiz
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
              if (file.size > SHARED_QUIZ_LIMIT) throw new Error('Shared quiz is too large.');
              const quiz = parseSharedQuiz(await file.text());
              if (!source && quiz.repository !== `${owner}/${repo}`)
                throw new Error('Open this quiz in its matching repository.');
              loadPractice(quiz);
            } catch (reason) {
              setError((reason as Error).message);
            }
            event.target.value = '';
          }}
        />
      </label>
      {(practice || session?.question || history.length > 0) && (
        <div className="quiz-share">
          <h3>Study in Anki</h3>
          <p>
            Export collected questions as card fronts and explanations as backs. Questions without
            explanations include a reminder to review the source. Your answers are excluded.
          </p>
          <button disabled={busy} onClick={() => void exportQuiz('anki')}>
            Download for Anki
          </button>
        </div>
      )}
      {(practice || session?.question || history.length > 0) && (
        <div className="quiz-share">
          <h3>Share the understanding</h3>
          {!practice && (
            <>
              <label>
                Public GitHub repository
                <input
                  value={repository}
                  onChange={(e) => setRepository(e.target.value)}
                  placeholder="owner/repository"
                />
              </label>
              <label>
                Commit containing this change (SHA)
                <input value={revision} onChange={(e) => setRevision(e.target.value)} />
              </label>
              <p>
                For staged or newer changes, commit and publish the change first, then select its
                commit here.
              </p>
            </>
          )}
          <p>
            Shared practice includes questions and explanations. Anyone with the link can read them.
            Your answers and Sphinx credentials are excluded.
          </p>
          <button disabled={busy} onClick={() => void exportQuiz('link')}>
            Copy practice link
          </button>
          <button disabled={busy} onClick={() => void exportQuiz('json')}>
            Download practice quiz
          </button>
        </div>
      )}
    </section>
  );
}
