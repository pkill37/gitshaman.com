'use client';

import { useState } from 'react';
import type { GuideSection } from '@/lib/project-guides';
import { ankiQuizText } from '@/lib/quiz';
import './repository-quiz.css';

export default function ChapterQuizPanel({ chapter }: { chapter: GuideSection | null }) {
  return <ChapterQuiz key={chapter?.id ?? 'no-chapter'} chapter={chapter} />;
}

function ChapterQuiz({ chapter }: { chapter: GuideSection | null }) {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const questions = chapter?.questions ?? [];
  const question = questions[index];

  const resetAnswer = () => {
    setAnswer('');
    setRevealed(false);
  };

  const downloadAnki = () => {
    const url = URL.createObjectURL(
      new Blob(
        [ankiQuizText(questions.map(({ prompt, answer }) => ({ prompt, explanation: answer })))],
        { type: 'text/plain;charset=utf-8' }
      )
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'gitshaman-quiz-anki.txt';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="repository-quiz" aria-label="Chapter quiz">
      <header>
        <h2>Quiz</h2>
        {chapter && <p>{chapter.title}</p>}
      </header>
      {!chapter ? (
        <p>Select a chapter in the guide to practice its questions.</p>
      ) : !question ? (
        <p>This chapter has no quiz questions yet.</p>
      ) : (
        <>
          <p>
            Question {index + 1} of {questions.length}
          </p>
          <h3>{question.prompt}</h3>
          <label>
            Your reasoning
            <textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              maxLength={16000}
            />
          </label>
          <button onClick={() => setRevealed(true)}>Show explanation</button>
          {revealed && <p className="quiz-feedback">{question.answer}</p>}
          {revealed &&
            (index < questions.length - 1 ? (
              <button
                onClick={() => {
                  setIndex(index + 1);
                  resetAnswer();
                }}
              >
                Next question
              </button>
            ) : (
              <>
                <p role="status">Chapter practice complete.</p>
                <button
                  onClick={() => {
                    setIndex(0);
                    resetAnswer();
                  }}
                >
                  Practice again
                </button>
              </>
            ))}
          <div className="quiz-share">
            <button onClick={downloadAnki}>Download for Anki</button>
          </div>
        </>
      )}
    </section>
  );
}
