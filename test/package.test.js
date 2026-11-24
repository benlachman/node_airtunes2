const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { builtinModules } = require('node:module');
const { spawnSync } = require('node:child_process');

const packageRoot = path.join(__dirname, '..');
const target = `${process.platform}-${process.arch}-node-${process.versions.modules}`;
const compiledAddon = path.join(packageRoot, 'build', 'Release', 'airtunes.node');

function runUsePrebuilt(t, prebuiltContents) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'airtunes2-'));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  fs.mkdirSync(path.join(directory, 'scripts'));
  fs.copyFileSync(path.join(packageRoot, 'scripts', 'use-prebuilt.js'), path.join(directory, 'scripts', 'use-prebuilt.js'));
  if (prebuiltContents) {
    fs.mkdirSync(path.join(directory, 'prebuilds', target), { recursive: true });
    fs.writeFileSync(path.join(directory, 'prebuilds', target, 'airtunes.node'), prebuiltContents);
  }
  const { status } = spawnSync(process.execPath, [path.join(directory, 'scripts', 'use-prebuilt.js')]);
  return { status, installed: path.join(directory, 'build', 'Release', 'airtunes.node') };
}

test('asks for a compile when no prebuilt addon matches this machine', (t) => {
  const { status, installed } = runUsePrebuilt(t, null);
  assert.strictEqual(status, 1);
  assert.strictEqual(fs.existsSync(installed), false);
});

test('asks for a compile when the prebuilt addon does not load', (t) => {
  const { status, installed } = runUsePrebuilt(t, 'not an addon');
  assert.strictEqual(status, 1);
  assert.strictEqual(fs.existsSync(installed), false);
});

// Loading the addon crashes on macOS, so lib/ never loads it there either
const skipReason = process.platform === 'darwin' ? 'addon does not load on macOS' : !fs.existsSync(compiledAddon) && 'addon not compiled';

test('installs a prebuilt addon that loads', { skip: skipReason }, (t) => {
  const addon = fs.readFileSync(compiledAddon);
  const { status, installed } = runUsePrebuilt(t, addon);
  assert.strictEqual(status, 0);
  assert.deepStrictEqual(fs.readFileSync(installed), addon);
});

test('every package lib/ requires is a dependency, and every dependency is required', () => {
  const required = new Set();
  for (const file of fs.readdirSync(path.join(packageRoot, 'lib'), { recursive: true })) {
    if (!file.endsWith('.js')) continue;
    const source = fs.readFileSync(path.join(packageRoot, 'lib', file), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    for (const [, specifier] of source.matchAll(/\brequire\(['"]([^'"]+)['"]\)/g)) {
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
      const name = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
      if (!builtinModules.includes(name)) required.add(name);
    }
  }
  assert.deepStrictEqual([...required].sort(), Object.keys(require('../package.json').dependencies).sort());
});
