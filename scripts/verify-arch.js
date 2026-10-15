'use strict';

// Fail unless every native binary under the given paths was built for the CPU
// architecture a package claims to be for. Used by the "Build installers"
// workflow so an arm64 job cannot pass with an x64 Electron or add-on inside.
//
//   node scripts/verify-arch.js <x64|arm64> [--require=<text>]... [--allow=<text>]... <file|dir>...
//
// A directory is scanned recursively (symlinks are not followed) and every ELF
// file (Linux executables, .so libraries, .node add-ons) and PE file (Windows
// .exe, .dll, .node) is checked by the machine field of its header; anything
// else is ignored. A file named on the command line must itself be a native
// binary of the right architecture.
//
//   --require=<text>  also fail unless at least one checked binary has <text>
//                     in its path, which catches a native add-on that was
//                     silently left out of a package.
//   --allow=<text>    do not fail on a binary of another architecture whose
//                     path has <text> in it (reported as an exception); for a
//                     known helper that is the same on every architecture.
//
// Prebuilt add-ons for other platforms and CPUs (node-gyp-build's
// prebuilds/<platform>-<arch>/ folders, which npm packages ship all of) are
// never loaded on the target, so only the folder for the target itself is
// checked and the rest are counted and skipped.

const fs = require('fs');
const path = require('path');

const MACHINE = {
  elf: { x64: 0x3e, arm64: 0xb7 },
  pe: { x64: 0x8664, arm64: 0xaa64 },
};
const MACHINE_NAME = {
  elf: { 0x3e: 'x86-64', 0xb7: 'aarch64', 0x03: 'x86', 0x28: 'arm' },
  pe: { 0x8664: 'x64', 0xaa64: 'arm64', 0x14c: 'x86', 0x1c4: 'arm', 0xa641: 'arm64ec' },
};

// Returns { kind: 'elf'|'pe', machine } for a native binary, or null.
function sniff(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(64);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    if (n >= 20 && head.readUInt32BE(0) === 0x7f454c46) {
      // EI_DATA 1 = little endian; no other byte order is shipped.
      return { kind: 'elf', machine: head[5] === 1 ? head.readUInt16LE(18) : -1 };
    }
    if (n >= 64 && head[0] === 0x4d && head[1] === 0x5a) {
      const pe = Buffer.alloc(6);
      const at = head.readUInt32LE(0x3c);
      if (fs.readSync(fd, pe, 0, pe.length, at) === pe.length && pe.toString('latin1', 0, 4) === 'PE\0\0') {
        return { kind: 'pe', machine: pe.readUInt16LE(4) };
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

const args = process.argv.slice(2);
const arch = args.shift();
const option = (name) => args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
const required = option('require');
const allowed = option('allow');
const targets = args.filter((a) => !a.startsWith('--'));
if (!MACHINE.elf[arch] || !targets.length || args.some((a) => a.startsWith('--') && !/^--(require|allow)=/.test(a))) {
  console.error('usage: node scripts/verify-arch.js <x64|arm64> [--require=<text>]... [--allow=<text>]... <file|dir>...');
  process.exit(2);
}

const slashed = (file) => file.split(path.sep).join('/');
const found = [];
const problems = [];
const exceptions = [];
let skippedPrebuilds = 0;
const check = (file, explicit) => {
  const info = sniff(file);
  if (!info) {
    if (explicit) problems.push(`${file}: not a native ELF/PE binary`);
    return;
  }
  // prebuilds/<platform>-<arch>/...: only the target's own folder can be loaded.
  const parts = slashed(file).split('/');
  const at = parts.lastIndexOf('prebuilds');
  if (!explicit && at !== -1 && parts[at + 1] !== `${info.kind === 'elf' ? 'linux' : 'win32'}-${arch}`) {
    skippedPrebuilds++;
    return;
  }
  const name = MACHINE_NAME[info.kind][info.machine] || `unknown (0x${info.machine.toString(16)})`;
  found.push({ file, kind: info.kind, name });
  if (info.machine !== MACHINE[info.kind][arch]) {
    const problem = `${file}: ${info.kind.toUpperCase()} machine is ${name}, expected ${arch}`;
    if (allowed.some((text) => slashed(file).includes(text))) exceptions.push(problem);
    else problems.push(problem);
  }
};

for (const target of targets) {
  let stat;
  try { stat = fs.statSync(target); } catch { problems.push(`${target}: does not exist`); continue; }
  if (stat.isDirectory()) for (const f of walk(target)) check(f, false);
  else check(target, true);
}

for (const text of required) {
  if (!found.some((f) => slashed(f.file).includes(text))) {
    problems.push(`no native binary with "${text}" in its path was found`);
  }
}
if (!found.length) problems.push('no native binaries found');

const addons = found.filter((f) => f.file.endsWith('.node'));
console.log(`[verify-arch] ${found.length} native binaries checked (${found.filter((f) => f.kind === 'elf').length} ELF, ${found.filter((f) => f.kind === 'pe').length} PE), expected ${arch}`);
if (skippedPrebuilds) console.log(`  skipped ${skippedPrebuilds} prebuilt add-ons for other platforms or CPUs (never loaded here)`);
for (const f of addons) console.log(`  add-on: ${f.file} (${f.name})`);
for (const e of exceptions) console.log('  allowed exception: ' + e);
if (problems.length) {
  for (const p of problems) console.error('  FAIL ' + p);
  process.exit(1);
}
console.log(`[verify-arch] OK: everything is ${arch}`);
