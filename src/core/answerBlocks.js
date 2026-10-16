/**
 * Splits a Diagnose answer into blocks the renderer builds with textContent:
 * paragraphs (text and `inline code` runs) and fenced code blocks. Nothing is
 * HTML, so model output can never inject markup. Loaded as a browser global
 * (window.PortPilotAnswerBlocks) and as a CommonJS module by tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PortPilotAnswerBlocks = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** One paragraph's text as [{ code: bool, text }] runs; an unpaired backtick stays literal. */
  function inlineRuns(line) {
    const parts = String(line).split('`');
    if (parts.length % 2 === 0) return [{ code: false, text: String(line) }];
    return parts.map((text, i) => ({ code: i % 2 === 1, text })).filter((r) => r.text !== '');
  }

  /** Blocks: { type: 'p', runs } | { type: 'code', text }. An unclosed fence (mid-stream) is code to the end. */
  function parse(text) {
    const blocks = [];
    let para = [];
    let code = null;
    const flush = () => {
      if (para.length) blocks.push({ type: 'p', runs: inlineRuns(para.join('\n')) });
      para = [];
    };
    for (const line of String(text || '').split(/\r?\n/)) {
      if (/^\s*```/.test(line)) {
        if (code) { blocks.push({ type: 'code', text: code.join('\n') }); code = null; } else { flush(); code = []; }
      } else if (code) {
        code.push(line);
      } else if (!line.trim()) {
        flush();
      } else {
        para.push(line);
      }
    }
    if (code) blocks.push({ type: 'code', text: code.join('\n') });
    flush();
    return blocks;
  }

  return { parse, inlineRuns };
});
