import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latinFaces } from '../scripts/get-fonts.mjs';

test('picks the latin woff2 files out of a Google Fonts response', () => {
  const css = `/* latin-ext */\n@font-face {\n  font-family: 'Space Mono';\n  font-style: normal;\n  font-weight: 700;\n  src: url(https://fonts.gstatic.com/s/spacemono/v1/ext.woff2) format('woff2');\n}\n/* latin */\n@font-face {\n  font-family: 'Space Mono';\n  font-style: normal;\n  font-weight: 700;\n  font-display: swap;\n  src: url(https://fonts.gstatic.com/s/spacemono/v1/latin.woff2) format('woff2');\n  unicode-range: U+0000-00FF;\n}\n/* latin */\n@font-face {\n  font-family: 'Anton';\n  font-style: normal;\n  font-weight: 400;\n  src: url(https://fonts.gstatic.com/s/anton/v1/a.woff2) format('woff2');\n}`;
  assert.deepEqual(latinFaces(css), [
    { family: 'Space Mono', weight: '700', url: 'https://fonts.gstatic.com/s/spacemono/v1/latin.woff2' },
    { family: 'Anton', weight: '400', url: 'https://fonts.gstatic.com/s/anton/v1/a.woff2' },
  ]);
});
