// Pure model of the Diagnose answer: paragraphs, inline code and fenced blocks, never HTML.
const assert = require('assert');
const { parse, inlineRuns } = require('../src/core/answerBlocks');

let n = 0;
const t = (name, fn) => { fn(); n += 1; };

t('plain text is one paragraph', () =>
  assert.deepStrictEqual(parse('Cause: a missing file.'), [{ type: 'p', runs: [{ code: false, text: 'Cause: a missing file.' }] }]));

t('blank lines split paragraphs', () =>
  assert.strictEqual(parse('one\n\ntwo').length, 2));

t('inline code becomes a code run between text runs', () =>
  assert.deepStrictEqual(inlineRuns('`a.json` is missing'), [{ code: true, text: 'a.json' }, { code: false, text: ' is missing' }]));

t('an unpaired backtick stays literal', () =>
  assert.deepStrictEqual(inlineRuns('it`s fine'), [{ code: false, text: 'it`s fine' }]));

t('a fenced block keeps its lines and drops the fences', () => {
  const b = parse('Fix:\n```\ncd app\nnode server.js\n```\nDone.');
  assert.deepStrictEqual(b.map((x) => x.type), ['p', 'code', 'p']);
  assert.strictEqual(b[1].text, 'cd app\nnode server.js');
});

t('a fence with a language tag still opens and closes', () =>
  assert.strictEqual(parse('```powershell\nGet-Item x\n```')[0].text, 'Get-Item x'));

t('an unclosed fence (answer still streaming) is code to the end', () =>
  assert.deepStrictEqual(parse('Fix:\n```\nnpm i'), [
    { type: 'p', runs: [{ code: false, text: 'Fix:' }] },
    { type: 'code', text: 'npm i' },
  ]));

t('HTML in the answer stays text', () => {
  const b = parse('<img src=x onerror=alert(1)>');
  assert.strictEqual(b[0].runs[0].text, '<img src=x onerror=alert(1)>');
});

t('empty input is no blocks', () => assert.deepStrictEqual(parse(''), []));

console.log(`answer-blocks: ${n} passed`);
