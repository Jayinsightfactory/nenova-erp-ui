import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

const DEFAULT_ROOT_PHASES = ['erp:contract:pre', 'erp:contract:main', 'erp:contract:post'];

// Child-process latency / real-time deadline benchmarks that spawn heavy sub-worker pools.
// Running these in a dedicated low-contention phase prevents CPU starvation & flaky timeouts on CI/Windows.
const ISOLATED_SERIAL_PATTERNS = [
  /workDriveListWorker\.test\.cjs/,
  /workDriveIngestWorker\.test\.cjs/,
  /orderImportFileIsolation\.test\.cjs/,
  /workDrivePairsWorker\.test\.cjs/,
  /shipmentFieldUploadIsolation\.test\.cjs/,
  /test-user-activity-server\.cjs/,
  /test-distribution-connection\.cjs/,
];

export function isIsolatedSerialCommand(cmd) {
  return ISOLATED_SERIAL_PATTERNS.some((re) => re.test(cmd));
}

export function expandScriptChain(scripts, scriptName, chain = []) {
  if (chain.includes(scriptName)) {
    throw new Error(`Circular npm script reference: ${[...chain, scriptName].join(' -> ')}`);
  }
  if (!scripts || typeof scripts[scriptName] !== 'string') {
    throw new Error(`Missing npm script in package.json: ${scriptName}`);
  }
  const out = [];
  const preName = `pre${scriptName}`;
  const postName = `post${scriptName}`;
  if (typeof scripts[preName] === 'string') {
    out.push(...expandCommandExpression(scripts, scripts[preName], [...chain, preName]));
  }
  out.push(...expandCommandExpression(scripts, scripts[scriptName], [...chain, scriptName]));
  if (typeof scripts[postName] === 'string') {
    out.push(...expandCommandExpression(scripts, scripts[postName], [...chain, postName]));
  }
  return out;
}

export function expandCommandExpression(scripts, expression, chain = []) {
  const parts = String(expression)
    .split(/\s*&&\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const out = [];
  for (const part of parts) {
    const npmMatch = part.match(/^npm\s+run\s+([A-Za-z0-9:_-]+)(?:\s+--\s+(.+))?$/);
    if (npmMatch) {
      const [, subScript, forwardedArgs] = npmMatch;
      if (!forwardedArgs) {
        out.push(...expandScriptChain(scripts, subScript, chain));
      } else {
        const preName = `pre${subScript}`;
        const postName = `post${subScript}`;
        if (typeof scripts[preName] === 'string') {
          out.push(...expandCommandExpression(scripts, scripts[preName], [...chain, preName]));
        }
        out.push({
          cmd: `${scripts[subScript]} ${forwardedArgs}`.trim(),
          chain: [...chain, subScript].join(' > '),
        });
        if (typeof scripts[postName] === 'string') {
          out.push(...expandCommandExpression(scripts, scripts[postName], [...chain, postName]));
        }
      }
      continue;
    }
    out.push({ cmd: part, chain: chain.join(' > ') });
  }
  return out;
}

export function expandErpContractSuite(scripts, rootPhases = DEFAULT_ROOT_PHASES) {
  const phases = rootPhases.filter((phase) => typeof scripts?.[phase] === 'string');
  if (phases.length === 0) {
    throw new Error(`No ERP contract phases found among: ${rootPhases.join(', ')}`);
  }
  const tasks = [];
  for (const phase of phases) {
    tasks.push(...expandScriptChain(scripts, phase, []));
  }
  return tasks.map((task, index) => ({ ...task, index: index + 1 }));
}

function tokenizeArgs(input) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(input)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

const chdirCache = new Map();
function fileUsesProcessOnlyApis(absFile) {
  if (chdirCache.has(absFile)) return chdirCache.get(absFile);
  let usesProcessOnly = true;
  try {
    const src = fs.readFileSync(absFile, 'utf8');
    usesProcessOnly = /\bprocess\.(?:chdir|umask|setuid|setgid)\b/.test(src);
  } catch {
    usesProcessOnly = true;
  }
  chdirCache.set(absFile, usesProcessOnly);
  return usesProcessOnly;
}

export function parseLeafCommand(cmd, {
  cwd = process.cwd(),
  nodeExecPath = process.execPath,
  multiTestConcurrency = 2,
  allowWorkerThread = true,
} = {}) {
  const trimmed = String(cmd).trim();
  if (trimmed.startsWith('node ')) {
    const tokens = tokenizeArgs(trimmed.slice(5).trim());
    if (tokens[0] === '--test') {
      const rest = tokens.slice(1);
      const fileTokens = rest.filter((token) => !token.startsWith('-'));
      const hasConcurrencyFlag = rest.some((token) => token.startsWith('--test-concurrency'));
      const args = fileTokens.length > 1 && !hasConcurrencyFlag
        ? ['--test', `--test-concurrency=${multiTestConcurrency}`, ...rest]
        : ['--test', ...rest];
      return {
        mode: 'spawn',
        execPath: nodeExecPath,
        args,
        targetCount: Math.max(1, fileTokens.length),
      };
    }
    const firstToken = tokens[0] || '';
    const isPlainScriptPath = !firstToken.startsWith('-') && /\.(?:c?js|mjs)$/.test(firstToken);
    if (allowWorkerThread && isPlainScriptPath && firstToken.startsWith('__tests__/')) {
      const absFile = path.resolve(cwd, firstToken);
      if (fs.existsSync(absFile) && !fileUsesProcessOnlyApis(absFile)) {
        return {
          mode: 'worker',
          workerFile: absFile,
          workerArgv: tokens.slice(1),
          execPath: nodeExecPath,
          args: tokens,
          targetCount: 1,
        };
      }
    }
    return {
      mode: 'spawn',
      execPath: nodeExecPath,
      args: tokens,
      targetCount: 1,
    };
  }
  const isWin = process.platform === 'win32';
  return {
    mode: 'spawn',
    execPath: isWin ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh',
    args: isWin ? ['/d', '/s', '/c', trimmed] : ['-c', trimmed],
    targetCount: 1,
  };
}

export function coalesceNodeTestTasks(tasks, { maxFilesPerBatch = 14 } = {}) {
  const result = [];
  let bucketFiles = [];
  let bucketTasks = [];

  const flushBucket = () => {
    if (bucketTasks.length === 0) return;
    if (bucketTasks.length === 1) {
      result.push({ ...bucketTasks[0], representedCount: 1, fileSet: new Set(bucketFiles) });
    } else {
      result.push({
        index: bucketTasks[0].index,
        cmd: `node --test ${bucketFiles.join(' ')}`,
        chain: `batched(${bucketTasks.length} cmds: #${bucketTasks[0].index}..#${bucketTasks[bucketTasks.length - 1].index})`,
        representedCount: bucketTasks.length,
        sourceTasks: bucketTasks,
        fileSet: new Set(bucketFiles),
      });
    }
    bucketFiles = [];
    bucketTasks = [];
  };

  for (const task of tasks) {
    const trimmed = task.cmd.trim();
    if (trimmed.startsWith('node --test ')) {
      const tokens = tokenizeArgs(trimmed.slice('node --test '.length).trim());
      const onlyFiles = tokens.length > 0 && tokens.every((t) => !t.startsWith('-'));
      if (onlyFiles && tokens.length < maxFilesPerBatch) {
        const hasOverlap = tokens.some((f) => bucketFiles.includes(f));
        if (hasOverlap || (bucketFiles.length > 0 && bucketFiles.length + tokens.length > maxFilesPerBatch)) {
          flushBucket();
        }
        bucketFiles.push(...tokens);
        bucketTasks.push(task);
        if (bucketFiles.length >= maxFilesPerBatch) flushBucket();
        continue;
      }
    }
    flushBucket();
    result.push({ ...task, representedCount: 1, fileSet: new Set([trimmed]) });
  }
  flushBucket();
  return result;
}

export function countSuiteTargets(tasks) {
  return tasks.reduce((sum, task) => sum + parseLeafCommand(task.cmd, { allowWorkerThread: false }).targetCount, 0);
}

export function defaultConcurrency({ env = process.env, cpuCount = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length } = {}) {
  const fromEnv = Number(env?.ERP_CONTRACT_CONCURRENCY);
  if (Number.isInteger(fromEnv) && fromEnv >= 1 && fromEnv <= 32) return fromEnv;
  if (env?.CI) return Math.min(8, Math.max(6, cpuCount));
  return Math.min(8, Math.max(4, cpuCount - 2));
}

function runViaSpawn(spec, { cwd, env, timeoutMs = 180_000 }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(spec.execPath, spec.args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const outChunks = [];
    const errChunks = [];
    let timedOut = false;
    const timer = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs)
      : null;

    child.stdout.on('data', (chunk) => outChunks.push(chunk));
    child.stderr.on('data', (chunk) => errChunks.push(chunk));
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      resolve({
        ok: false,
        code: 1,
        signal: null,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout: Buffer.concat(outChunks).toString('utf8'),
        stderr: `${Buffer.concat(errChunks).toString('utf8')}\n${error.stack || error.message}`.trim(),
      });
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({
        ok: !timedOut && code === 0 && !signal,
        code: code ?? 1,
        signal: signal || null,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout: Buffer.concat(outChunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
      });
    });
  });
}

function runViaWorkerThread(spec, { env, timeoutMs = 180_000 }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const outChunks = [];
    const errChunks = [];
    const workerErrors = [];
    let timedOut = false;
    let settled = false;

    let worker;
    try {
      worker = new Worker(pathToFileURL(spec.workerFile), {
        argv: spec.workerArgv,
        env: { ...env },
        stdout: true,
        stderr: true,
      });
    } catch (err) {
      resolve({
        ok: false,
        code: 1,
        signal: null,
        timedOut: false,
        workerUnsupported: err?.code === 'ERR_WORKER_UNSUPPORTED_OPERATION',
        durationMs: Date.now() - startedAt,
        stdout: '',
        stderr: err.stack || err.message,
      });
      return;
    }

    const timer = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        worker.terminate().catch(() => {});
      }, timeoutMs)
      : null;

    if (worker.stdout) worker.stdout.on('data', (chunk) => outChunks.push(Buffer.from(chunk)));
    if (worker.stderr) worker.stderr.on('data', (chunk) => errChunks.push(Buffer.from(chunk)));
    worker.on('error', (error) => {
      workerErrors.push(error);
    });
    worker.on('exit', (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const stdout = Buffer.concat(outChunks).toString('utf8');
      const errText = [
        Buffer.concat(errChunks).toString('utf8').trim(),
        ...workerErrors.map((e) => e?.stack || e?.message || String(e)),
      ].filter(Boolean).join('\n');
      const unsupported = workerErrors.some((e) => e?.code === 'ERR_WORKER_UNSUPPORTED_OPERATION')
        || errText.includes('ERR_WORKER_UNSUPPORTED_OPERATION');
      const finalCode = workerErrors.length > 0 && code === 0 ? 1 : (code ?? 1);
      resolve({
        ok: !timedOut && workerErrors.length === 0 && finalCode === 0,
        code: finalCode,
        signal: null,
        timedOut,
        workerUnsupported: unsupported,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr: errText,
      });
    });
  });
}

async function executeSpec(spec, options) {
  if (spec.mode === 'worker') {
    const res = await runViaWorkerThread(spec, options);
    if (!res.ok && res.workerUnsupported) {
      return runViaSpawn(spec, options);
    }
    return res;
  }
  return runViaSpawn(spec, options);
}

export async function runTaskPool(tasks, {
  concurrency = defaultConcurrency(),
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = 180_000,
  milestoneStep = 100,
  quiet = false,
  allowWorkerThread = true,
  coalesceNodeTest = true,
} = {}) {
  const startedAt = Date.now();
  const rawIsolated = tasks.filter((t) => isIsolatedSerialCommand(t.cmd));
  const rawParallel = tasks.filter((t) => !isIsolatedSerialCommand(t.cmd));
  const parallelUnits = coalesceNodeTest
    ? coalesceNodeTestTasks(rawParallel)
    : rawParallel.map((t) => ({ ...t, representedCount: 1, fileSet: new Set([t.cmd]) }));

  const failures = [];
  let completedCommands = 0;
  let passedCommands = 0;
  let cumulativeMs = 0;
  let nextMilestone = milestoneStep;

  const recordOutcome = (unit, result) => {
    const count = unit.representedCount || 1;
    completedCommands += count;
    cumulativeMs += result.durationMs;
    if (result.ok) {
      passedCommands += count;
      if (!quiet && (completedCommands >= nextMilestone || completedCommands === tasks.length)) {
        while (nextMilestone <= completedCommands) nextMilestone += milestoneStep;
        const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(`[erp-contract] ${completedCommands}/${tasks.length} commands done (${passedCommands} passed, ${failures.length} failed, ${elapsedSec}s)`);
      }
    } else {
      const failure = { task: unit, representedCount: count, ...result };
      failures.push(failure);
      if (!quiet) {
        const reason = result.timedOut ? `TIMEOUT>${timeoutMs}ms` : result.signal ? `signal=${result.signal}` : `exit=${result.code}`;
        console.error(`\n[FAIL] (${unit.index}/${tasks.length}, ${result.durationMs}ms, ${reason}) ${unit.cmd} [${unit.chain}]`);
        if (result.stdout.trim()) console.error(`--- stdout ---\n${result.stdout.trimEnd()}`);
        if (result.stderr.trim()) console.error(`--- stderr ---\n${result.stderr.trimEnd()}`);
      }
    }
  };

  if (parallelUnits.length > 0) {
    const pending = parallelUnits.slice();
    const activeKeys = new Set();
    let wakeIdleWorkers = null;
    const notifyIdle = () => {
      if (wakeIdleWorkers) {
        const fn = wakeIdleWorkers;
        wakeIdleWorkers = null;
        fn();
      }
    };

    const worker = async () => {
      while (pending.length > 0) {
        const readyIdx = pending.findIndex((unit) => {
          for (const key of unit.fileSet) {
            if (activeKeys.has(key)) return false;
          }
          return true;
        });
        if (readyIdx < 0) {
          await new Promise((resolve) => {
            const prev = wakeIdleWorkers;
            wakeIdleWorkers = () => {
              if (prev) prev();
              resolve();
            };
          });
          continue;
        }
        const [unit] = pending.splice(readyIdx, 1);
        for (const key of unit.fileSet) activeKeys.add(key);
        const spec = parseLeafCommand(unit.cmd, {
          cwd,
          multiTestConcurrency: 2,
          allowWorkerThread,
        });
        const result = await executeSpec(spec, { cwd, env, timeoutMs });
        for (const key of unit.fileSet) activeKeys.delete(key);
        notifyIdle();
        recordOutcome(unit, result);
      }
    };

    const workerCount = Math.max(1, Math.min(concurrency, parallelUnits.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  if (rawIsolated.length > 0) {
    const cpuCount = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
    if (!quiet) {
      console.log(`[erp-contract] Running ${rawIsolated.length} contention-sensitive child-worker suite(s) in isolated low-contention mode...`);
    }
    for (const task of rawIsolated) {
      const isHeavy20ChildTest = /shipmentFieldUploadIsolation\.test\.cjs/.test(task.cmd);
      const innerConc = isHeavy20ChildTest ? 2 : Math.min(4, Math.max(2, cpuCount));
      const spec = parseLeafCommand(task.cmd, {
        cwd,
        multiTestConcurrency: innerConc,
        allowWorkerThread: false,
      });
      const result = await runViaSpawn(spec, { cwd, env, timeoutMs });
      recordOutcome({ ...task, representedCount: 1 }, result);
    }
  }

  return {
    totalCommands: tasks.length,
    executedUnits: parallelUnits.length + rawIsolated.length,
    totalTargets: countSuiteTargets(tasks),
    isolatedCommands: rawIsolated.length,
    passed: passedCommands,
    failed: failures.reduce((s, f) => s + (f.representedCount || 1), 0),
    failures,
    concurrency: Math.max(1, Math.min(concurrency, tasks.length || 1)),
    wallMs: Date.now() - startedAt,
    cumulativeMs,
  };
}

function parseCliArgs(argv) {
  let concurrency = null;
  let phaseFilter = null;
  let noWorkerThreads = false;
  let noCoalesce = false;
  for (const arg of argv) {
    if (arg.startsWith('--concurrency=')) {
      const value = Number(arg.slice('--concurrency='.length));
      if (!Number.isInteger(value) || value < 1 || value > 32) {
        throw new Error(`Invalid --concurrency value: ${arg}`);
      }
      concurrency = value;
    } else if (arg.startsWith('--phase=')) {
      phaseFilter = arg.slice('--phase='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--no-worker-threads') {
      noWorkerThreads = true;
    } else if (arg === '--no-coalesce') {
      noCoalesce = true;
    }
  }
  return { concurrency, phaseFilter, noWorkerThreads, noCoalesce };
}

async function main() {
  const root = process.cwd();
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const { concurrency: cliConcurrency, phaseFilter, noWorkerThreads, noCoalesce } = parseCliArgs(process.argv.slice(2));
  const phases = phaseFilter || DEFAULT_ROOT_PHASES;
  const tasks = expandErpContractSuite(pkg.scripts, phases);
  const concurrency = cliConcurrency || defaultConcurrency();
  const targetCount = countSuiteTargets(tasks);

  console.log(`[erp-contract] Starting ${tasks.length} commands (${targetCount} test targets) across ${concurrency} parallel workers...`);
  const summary = await runTaskPool(tasks, {
    concurrency,
    cwd: root,
    env: process.env,
    allowWorkerThread: !noWorkerThreads && process.env.ERP_CONTRACT_NO_WORKERS !== '1',
    coalesceNodeTest: !noCoalesce,
  });
  const wallSec = (summary.wallMs / 1000).toFixed(1);
  const cumSec = (summary.cumulativeMs / 1000).toFixed(1);

  if (summary.failed > 0) {
    console.error(`\nERP contract suite FAILED: ${summary.failed}/${summary.totalCommands} command(s) failed in ${wallSec}s`);
    for (const f of summary.failures) {
      console.error(` - [${f.task.index}] ${f.task.cmd} (${f.task.chain})`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`ERP contract suite PASS: ${summary.passed}/${summary.totalCommands} commands (${summary.totalTargets} test targets, ${summary.executedUnits} units, ${summary.isolatedCommands} isolated) in ${wallSec}s (cumulative ${cumSec}s, concurrency=${summary.concurrency})`);
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedUrl === import.meta.url) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
