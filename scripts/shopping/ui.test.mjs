import { test } from 'node:test';
import { withShoppingBrowser } from './ui-runner.mjs';
import { runShoppingChecks } from './browser-cases.mjs';

test('shopping production UI in Chromium', { timeout: 120000 }, async t => {
  await withShoppingBrowser(async browser => runShoppingChecks({ t, ...browser }));
});
