import { spawn } from 'node:child_process';
import { access, copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import net from 'node:net';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'omnihq-intro.html');
const output = path.join(root, 'omnihq.mp4');
const publicOutput = path.join(root, 'frontend', 'public', 'omnihq.mp4');
const chromeCandidates = [
  process.env.CHROME_BIN,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const ffmpegCandidates = [
  process.env.FFMPEG_BIN,
  'C:\\Users\\khalil\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.1-essentials_build\\bin\\ffmpeg.exe',
  'ffmpeg',
];

async function executableExists(file) {
  if (!file) return false;
  if (file === 'ffmpeg') return true;
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function findExecutable(candidates, label) {
  for (const candidate of candidates) {
    if (await executableExists(candidate)) return candidate;
  }
  throw new Error(`${label} was not found. Set its executable path in the matching environment variable.`);
}

async function removeTempDirectory(directory) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code) || attempt === 9) throw error;
      await delay(250);
    }
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited with code ${code}.`));
    });
  });
}

async function findPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a local debugging port.'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForPage(port, chrome) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (chrome.exitCode !== null) throw new Error('Chrome exited before its debugging endpoint became ready.');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === 'page');
        if (page) return page;
      }
    } catch {
      await delay(100);
      continue;
    }
    await delay(100);
  }
  throw new Error('Timed out waiting for Chrome DevTools.');
}

function createCdpClient(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data.toString());
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });

  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const id = ++nextId;
          return new Promise((requestResolve, requestReject) => {
            pending.set(id, { resolve: requestResolve, reject: requestReject });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          socket.close();
        },
      });
    }, { once: true });
    socket.addEventListener('error', () => reject(new Error('Could not connect to Chrome DevTools.')), { once: true });
  });
}

async function main() {
  const chromePath = await findExecutable(chromeCandidates, 'Chrome or Edge');
  const ffmpegPath = await findExecutable(ffmpegCandidates, 'FFmpeg');
  const temp = await mkdtemp(path.join(tmpdir(), 'omnihq-video-'));
  const frames = path.join(temp, 'frames');
  const profile = path.join(temp, 'chrome-profile');
  await mkdir(frames);

  let chrome;
  let cdp;
  try {
    const port = await findPort();
    chrome = spawn(chromePath, [
      '--headless=new',
      '--disable-gpu',
      '--disable-crash-reporter',
      '--disable-breakpad',
      '--disable-crashpad',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      pathToFileURL(source).href,
    ], { stdio: 'ignore', windowsHide: true });

    const page = await waitForPage(port, chrome);
    cdp = await createCdpClient(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: pathToFileURL(source).href });
    await delay(500);

    const frameCount = 240;
    for (let frame = 0; frame < frameCount; frame += 1) {
      const sourceTime = Math.min(5, frame / 30 / 1.5);
      await cdp.send('Runtime.evaluate', {
        expression: `window.seek(${sourceTime})`,
        returnByValue: true,
      });
      const capture = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      });
      await writeFile(path.join(frames, `${String(frame).padStart(5, '0')}.png`), Buffer.from(capture.data, 'base64'));
    }

    await run(ffmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-framerate', '30',
      '-i', path.join(frames, '%05d.png'),
      '-frames:v', '240',
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', '17',
      '-movflags', '+faststart',
      output,
    ]);
    await copyFile(output, publicOutput);
    console.log(`Created ${output} and ${publicOutput}`);
  } finally {
    cdp?.close();
    if (chrome && chrome.exitCode === null) {
      await Promise.race([
        new Promise((resolve) => chrome.once('exit', resolve)),
        delay(3000),
      ]);
      if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill();
      await delay(1000);
    }
    await removeTempDirectory(temp);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
