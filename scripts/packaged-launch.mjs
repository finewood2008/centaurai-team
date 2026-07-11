#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

function parseArgs(argv) {
  const flags = new Set(argv.filter((x) => x.startsWith('--')));
  const values = argv.filter((x) => !x.startsWith('--'));
  return { flags, values };
}

function isWindows() {
  return process.platform === 'win32';
}

function killProcessByName(name) {
  return new Promise((resolve) => {
    const args = isWindows() ? ['/F', '/IM', name] : ['-f', name];
    const cmd = isWindows() ? 'taskkill' : 'pkill';
    const child = spawn(cmd, args, { stdio: 'ignore', shell: false });
    child.on('exit', () => resolve());
    child.on('error', () => resolve());
  });
}

function findWindowsExecutable(unpackedDir) {
  const executableNames = fs
    .readdirSync(unpackedDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^CentaurAI(?: .+)?\.exe$/i.test(entry.name))
    .map((entry) => entry.name)
    .filter((name) => name.toLowerCase() !== 'centaurai-core.exe');
  const executableName = executableNames[0];
  return executableName ? path.join(unpackedDir, executableName) : null;
}

function findMacExecutable(appPath) {
  const infoPlistPath = path.join(appPath, 'Contents', 'Info.plist');
  const macosDir = path.join(appPath, 'Contents', 'MacOS');
  if (!fs.existsSync(infoPlistPath) || !fs.existsSync(macosDir)) return null;

  const infoPlist = fs.readFileSync(infoPlistPath, 'utf8');
  const configuredName = infoPlist.match(/<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
  const executableName =
    configuredName ??
    fs
      .readdirSync(macosDir, { withFileTypes: true })
      .find((entry) => entry.isFile() && /^CentaurAI(?: .+)?$/i.test(entry.name))?.name;
  if (!executableName) return null;

  const executablePath = path.join(macosDir, executableName);
  return fs.existsSync(executablePath) ? executablePath : null;
}

function findLinuxExecutable(unpackedDir) {
  const executableNames = fs
    .readdirSync(unpackedDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^centaurai(?:[- ].+)?$/i.test(entry.name))
    .map((entry) => entry.name);
  const executableName = executableNames[0];
  return executableName ? path.join(unpackedDir, executableName) : null;
}

function resolvePackagedApp(projectRoot) {
  const outDir = path.join(projectRoot, 'out');
  if (!fs.existsSync(outDir)) return null;

  if (process.platform === 'win32') {
    for (const dir of ['win-unpacked', 'win-x64-unpacked', 'win-arm64-unpacked']) {
      const unpackedDir = path.join(outDir, dir);
      if (!fs.existsSync(unpackedDir)) continue;
      const exe = findWindowsExecutable(unpackedDir);
      if (exe) return { executablePath: exe, cwd: unpackedDir };
    }
  } else if (process.platform === 'darwin') {
    for (const dir of ['mac-arm64', 'mac-x64', 'mac', 'mac-universal']) {
      const macDir = path.join(outDir, dir);
      if (!fs.existsSync(macDir)) continue;
      const appBundle = fs.readdirSync(macDir).find((f) => f.endsWith('.app'));
      if (!appBundle) continue;
      const exe = findMacExecutable(path.join(macDir, appBundle));
      if (exe) return { executablePath: exe, cwd: macDir };
    }
  } else {
    for (const dir of ['linux-unpacked', 'linux-x64-unpacked', 'linux-arm64-unpacked']) {
      const dirPath = path.join(outDir, dir);
      if (!fs.existsSync(dirPath)) continue;
      const exe = findLinuxExecutable(dirPath);
      if (exe) return { executablePath: exe, cwd: dirPath };
    }
  }

  return null;
}

async function main() {
  const { flags, values } = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const dryRun = flags.has('--dry-run');
  const shouldClean = !flags.has('--no-clean');
  const passthroughArgs = values;

  const packaged = resolvePackagedApp(projectRoot);
  if (!packaged) {
    console.error('[packaged-launch] No unpacked app found under out/. Run `just build-package` first.');
    process.exit(1);
  }

  if (shouldClean) {
    await killProcessByName(path.basename(packaged.executablePath));
    await killProcessByName('electron.exe');
    await killProcessByName('electron');
  }

  const env = {
    ...process.env,
    AIONUI_EXTENSIONS_PATH: path.join(projectRoot, 'examples'),
  };

  console.log(`[packaged-launch] executable: ${packaged.executablePath}`);
  console.log(`[packaged-launch] cwd: ${packaged.cwd}`);
  console.log(`[packaged-launch] AIONUI_EXTENSIONS_PATH: ${env.AIONUI_EXTENSIONS_PATH}`);

  if (dryRun) return;

  const child = spawn(packaged.executablePath, passthroughArgs, {
    cwd: packaged.cwd,
    env,
    stdio: 'inherit',
    shell: false,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error('[packaged-launch] Failed:', error);
  process.exit(1);
});
