// Installs the addon bundled for this platform and Node ABI, if there is one.
// Exits non-zero when the addon has to be compiled instead.
const fs = require('fs');
const path = require('path');

const packageRoot = path.join(__dirname, '..');
const target = `${process.platform}-${process.arch}-node-${process.versions.modules}`;
const prebuilt = path.join(packageRoot, 'prebuilds', target, 'airtunes.node');
const installed = path.join(packageRoot, 'build', 'Release', 'airtunes.node');

try {
  require(prebuilt); // proves it matches this machine's libc and Node
  fs.mkdirSync(path.dirname(installed), { recursive: true });
  fs.copyFileSync(prebuilt, installed);
  console.log(`airtunes2: using the prebuilt addon for ${target}`);
} catch (error) {
  console.log(`airtunes2: no usable prebuilt addon for ${target}: ${error.message.split('\n')[0]}`);
  process.exitCode = 1;
}
