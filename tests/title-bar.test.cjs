// Colours handed to the Windows overlay title bar: parsed, composited over the page, opaque hex.
const assert = require('assert');
const T = require('../src/core/titleBar');

let n = 0;
const t = (name, fn) => { fn(); n += 1; };

t('parse reads rgb, rgba, percent alpha and hex', () => {
  assert.deepStrictEqual(T.parse('rgb(36, 40, 59)'), { r: 36, g: 40, b: 59, a: 1 });
  assert.deepStrictEqual(T.parse('rgba(255, 255, 255, 0.04)'), { r: 255, g: 255, b: 255, a: 0.04 });
  assert.strictEqual(T.parse('rgb(0 0 0 / 50%)').a, 0.5);
  assert.deepStrictEqual(T.parse('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepStrictEqual(T.parse('#1a1b26'), { r: 26, g: 27, b: 38, a: 1 });
  assert.strictEqual(T.parse('transparent'), null);
  assert.strictEqual(T.parse(''), null);
});

t('an opaque theme header keeps its own colour', () => {
  const c = T.colorsFor({ headerBg: 'rgb(36, 40, 59)', pageBg: 'rgb(26, 27, 38)', text: 'rgb(192, 202, 245)' });
  assert.deepStrictEqual(c, { color: '#24283b', symbolColor: '#c0caf5' });
});

t('a translucent header (Glass) is composited over the page colour', () => {
  const c = T.colorsFor({ headerBg: 'rgba(255, 255, 255, 0.04)', pageBg: 'rgb(13, 17, 23)', text: 'rgb(230, 237, 243)' });
  // 13 + (255-13)*0.04 = 22.68 -> 23 = 0x17 ; 17 + 238*0.04 = 26.52 -> 27 = 0x1b ; 23 + 232*0.04 = 32.28 -> 32 = 0x20
  assert.strictEqual(c.color, '#171b20');
  assert.strictEqual(c.symbolColor, '#e6edf3');
});

t('an unreadable colour gives null, never a bad value', () => {
  assert.strictEqual(T.colorsFor({ headerBg: 'transparent', pageBg: '#000', text: '#fff' }), null);
});

console.log(`title-bar: ${n} cases ok`);
