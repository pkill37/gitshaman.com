import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

test('quiz follows the selected chapter and clears previous answers', async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import Panel from './src/features/repository/components/ChapterQuizPanel';
const chapters = [
  { id: 'first', title: 'Scheduling', questions: [
    { prompt: 'What runs first?', answer: 'The highest priority ready task.' },
    { prompt: 'What advances time?', answer: 'The tick interrupt.' }
  ] },
  { id: 'second', title: 'Timers', questions: [
    { prompt: 'Where do callbacks run?', answer: 'The timer service task.' }
  ] },
  { id: 'empty', title: 'Overview' }
];
function App() {
  const [index, setIndex] = useState(0);
  return <><button onClick={() => setIndex(0)}>Scheduling</button>
    <button onClick={() => setIndex(1)}>Timers</button>
    <button onClick={() => setIndex(2)}>Overview</button>
    <button onClick={() => setIndex(3)}>Deselect</button>
    <Panel chapter={chapters[index] ?? null} /></>;
}
createRoot(document.getElementById('root')).render(<App />);`,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    outfile: '/tmp/gitshaman-chapter-quiz.js',
    jsx: 'automatic',
    platform: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  await page.route('https://chapter.example/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' })
  );
  await page.goto('https://chapter.example');
  await page.addScriptTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text,
  });
  const panel = page.getByRole('region', { name: 'Chapter quiz' });
  await expect(panel).toContainText('What runs first?');
  await panel.getByLabel('Your reasoning').fill('My first answer');
  await panel.getByRole('button', { name: 'Show explanation' }).click();
  await expect(panel).toContainText('The highest priority ready task.');
  await panel.getByRole('button', { name: 'Next question' }).click();
  await expect(panel).toContainText('What advances time?');
  await page.getByRole('button', { name: 'Timers', exact: true }).click();
  await expect(panel).toContainText('Question 1 of 1');
  await expect(panel).toContainText('Where do callbacks run?');
  await expect(panel.getByLabel('Your reasoning')).toHaveValue('');
  await expect(panel).not.toContainText('The timer service task.');
  await panel.getByRole('button', { name: 'Show explanation' }).click();
  await expect(panel).toContainText('The timer service task.');
  const downloadEvent = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download for Anki' }).click();
  const download = await downloadEvent;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const exported = Buffer.concat(chunks).toString();
  expect(exported).toContain('Where do callbacks run?');
  expect(exported).not.toContain('What runs first?');
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(panel).toContainText('This chapter has no quiz questions yet.');
  await page.getByRole('button', { name: 'Deselect' }).click();
  await expect(panel).toContainText('Select a chapter');
});
