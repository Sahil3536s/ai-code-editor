/**
 * ExecutionService — Reusable, concurrent-safe Docker code execution engine.
 *
 * Security model (applied to every container):
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  THREAT                    │  MITIGATION                                │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  Network exfiltration      │  --network=none                            │
 * │  Memory exhaustion         │  --memory + --memory-swap (same value)     │
 * │  CPU starvation            │  --cpus (fraction)                         │
 * │  Fork bomb / PID exhaustion│  --pids-limit                              │
 * │  FD exhaustion             │  --ulimit nofile=<n>:<n>                   │
 * │  Privilege escalation      │  --cap-drop=ALL  +  --security-opt=no-new-privileges │
 * │  Root-owned malware persist│  --read-only root FS + limited /tmp tmpfs  │
 * │  Infinite output           │  in-memory buffer cap + truncation         │
 * │  Timeout evasion           │  setTimeout → docker kill + SIGKILL        │
 * │  Parallel container flood  │  Semaphore (maxConcurrent)                 │
 * │  Oversized code            │  maxCodeBytes input guard                  │
 * │  Running as root           │  --user=<uid>:<gid> (non-root)             │
 * │  Host env var leakage      │  Minimal spawn env (PATH/HOME/DOCKER_*)    │
 * │  Docker socket exposure    │  Never mounted — not even a -v flag        │
 * │  Privileged containers     │  Never used — flag deliberately absent     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * All resource limits are configurable via constructor options,
 * which are read from environment variables in index.js.
 *
 * @module executionService
 */

import { execFile, spawn } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import { LANGUAGE_CONFIG } from "./languages.js";

const execFileAsync = promisify(execFile);

// ─────────────────────────────────────────────────────────────────────────────
// Semaphore — bounds simultaneous container launches
// ─────────────────────────────────────────────────────────────────────────────
class Semaphore {
  /** @param {number} limit  Max simultaneous acquisitions. */
  constructor(limit) {
    this._limit   = limit;
    this._running = 0;
    this._queue   = [];
  }

  /** Acquire a slot; resolves immediately if one is free, queues otherwise. */
  acquire() {
    return new Promise((resolve) => {
      if (this._running < this._limit) {
        this._running++;
        resolve();
      } else {
        this._queue.push(resolve);
      }
    });
  }

  /** Release a slot; unblocks the oldest queued waiter if any. */
  release() {
    if (this._queue.length > 0) {
      // Hand the slot directly — don't decrement running count
      const next = this._queue.shift();
      next();
    } else {
      this._running--;
    }
  }

  get runningCount() { return this._running; }
  get queuedCount()  { return this._queue.length; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom error types
// ─────────────────────────────────────────────────────────────────────────────
export class ValidationError extends Error {
  constructor(msg) { super(msg); this.name = "ValidationError"; }
}

export class DockerUnavailableError extends Error {
  constructor(msg) { super(msg); this.name = "DockerUnavailableError"; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal environment passed to docker CLI processes.
// ONLY variables the docker CLI itself needs — no host secrets are forwarded.
// The variables below are intentionally whitelisted, not inherited blindly.
// ─────────────────────────────────────────────────────────────────────────────
function buildDockerCliEnv() {
  const safe = {};
  // Required for any process to find binaries
  if (process.env.PATH)             safe.PATH             = process.env.PATH;
  if (process.env.HOME)             safe.HOME             = process.env.HOME;
  // Docker CLI configuration knobs (user may have custom daemon/TLS setup)
  if (process.env.DOCKER_HOST)      safe.DOCKER_HOST      = process.env.DOCKER_HOST;
  if (process.env.DOCKER_TLS_VERIFY) safe.DOCKER_TLS_VERIFY = process.env.DOCKER_TLS_VERIFY;
  if (process.env.DOCKER_CERT_PATH) safe.DOCKER_CERT_PATH = process.env.DOCKER_CERT_PATH;
  if (process.env.DOCKER_CONFIG)    safe.DOCKER_CONFIG    = process.env.DOCKER_CONFIG;
  if (process.env.DOCKER_CONTEXT)   safe.DOCKER_CONTEXT   = process.env.DOCKER_CONTEXT;
  // Windows: Docker Desktop on WSL2 needs USERPROFILE / LOCALAPPDATA
  if (process.env.USERPROFILE)      safe.USERPROFILE      = process.env.USERPROFILE;
  if (process.env.LOCALAPPDATA)     safe.LOCALAPPDATA     = process.env.LOCALAPPDATA;
  if (process.env.APPDATA)          safe.APPDATA          = process.env.APPDATA;
  return safe;
}

const DOCKER_CLI_ENV = buildDockerCliEnv();

// ─────────────────────────────────────────────────────────────────────────────
// ExecutionService
// ─────────────────────────────────────────────────────────────────────────────
export class ExecutionService {
  /**
   * @param {object} [opts]
   *
   * ── Timing / sizing ──────────────────────────────────────────────────────
   * @param {number} [opts.timeoutMs=10000]         Hard kill timeout per run (ms).
   * @param {number} [opts.maxOutputBytes=65536]    Stdout+stderr truncation cap (bytes).
   * @param {number} [opts.maxConcurrent=5]         Max simultaneous Docker containers.
   * @param {number} [opts.maxCodeBytes=102400]     Max accepted source code size (bytes).
   * @param {number} [opts.maxInputBytes=8192]      Max stdin input size (bytes).
   *
   * ── Container resource limits (all configurable via env vars) ────────────
   * @param {string} [opts.memoryLimit="128m"]      --memory and --memory-swap value.
   * @param {string} [opts.cpuLimit="0.5"]          --cpus fractional value.
   * @param {number} [opts.pidsLimit=64]            --pids-limit (blocks fork bombs).
   * @param {number} [opts.maxOpenFiles=512]        --ulimit nofile soft:hard value.
   * @param {number} [opts.tmpfsSizeMb=32]          /tmp tmpfs size in megabytes.
   *
   * ── Container identity ──────────────────────────────────────────────────
   * @param {number} [opts.uid=65534]   UID for --user (65534 = nobody on most distros).
   * @param {number} [opts.gid=65534]   GID for --user.
   */
  constructor({
    timeoutMs      = 10_000,
    maxOutputBytes = 65_536,
    maxConcurrent  = 5,
    maxCodeBytes   = 100 * 1024,
    maxInputBytes  = 8 * 1024,
    memoryLimit    = "128m",
    cpuLimit       = "0.5",
    pidsLimit      = 64,
    maxOpenFiles   = 512,
    tmpfsSizeMb    = 32,
    uid            = 65534,
    gid            = 65534,
  } = {}) {
    this.timeoutMs      = timeoutMs;
    this.maxOutputBytes = maxOutputBytes;
    this.maxCodeBytes   = maxCodeBytes;
    this.maxInputBytes  = maxInputBytes;
    this.memoryLimit    = memoryLimit;
    this.cpuLimit       = cpuLimit;
    this.pidsLimit      = pidsLimit;
    this.maxOpenFiles   = maxOpenFiles;
    this.tmpfsSizeMb    = tmpfsSizeMb;
    this.uid            = uid;
    this.gid            = gid;
    this._semaphore     = new Semaphore(maxConcurrent);
    this._dockerReady   = false;
    this._pulledImages  = new Set();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Returns metadata for all languages that can be executed server-side.
   * Web-only languages (React/HTML) are excluded — they never reach Docker.
   * @returns {{ key: string, label: string, extension: string, monacoLang: string }[]}
   */
  supportedLanguages() {
    return Object.values(LANGUAGE_CONFIG)
      .filter((cfg) => !cfg.isWeb)
      .map(({ id, label, extension, monacoLang }) => ({
        key: id,
        label,
        extension,
        monacoLang,
      }));
  }

  /**
   * Execute source code in an isolated Docker container.
   *
   * This method is safe to call concurrently from multiple HTTP requests.
   * Excess requests beyond maxConcurrent are queued (not rejected) by the Semaphore.
   *
   * @param {{ code: string, language: string, input?: string }} params
   * @returns {Promise<ExecutionResult>}
   * @throws {ValidationError}        Invalid or rejected input.
   * @throws {DockerUnavailableError} Docker daemon not reachable.
   */
  async execute({ code, language, input = "" }) {
    // ── Input validation ────────────────────────────────────────────────────
    if (!code || typeof code !== "string") {
      throw new ValidationError("Missing or invalid `code` field.");
    }
    if (!language || typeof language !== "string") {
      throw new ValidationError("Missing or invalid `language` field.");
    }
    if (input !== null && input !== undefined && typeof input !== "string") {
      throw new ValidationError("`input` must be a string.");
    }
    const stdinData = (typeof input === "string") ? input : "";
    const inputBytes = Buffer.byteLength(stdinData, "utf8");
    if (inputBytes > this.maxInputBytes) {
      throw new ValidationError(
        `stdin input too large: ${inputBytes} bytes (limit: ${this.maxInputBytes} bytes).`
      );
    }

    const langKey = language.toLowerCase().trim();
    const langCfg = LANGUAGE_CONFIG[langKey];

    if (!langCfg) {
      throw new ValidationError(
        `Unsupported language: "${language}". ` +
        `Supported: ${this.supportedLanguages().map((l) => l.key).join(", ")}.`
      );
    }

    // Reject web-only languages — they are browser-rendered, never executed here
    if (langCfg.isWeb) {
      throw new ValidationError(
        `"${langKey}" is browser-rendered and cannot be executed server-side.`
      );
    }

    // Reject oversized payloads before doing any I/O
    const codeBytes = Buffer.byteLength(code, "utf8");
    if (codeBytes > this.maxCodeBytes) {
      throw new ValidationError(
        `Code too large: ${codeBytes} bytes (limit: ${this.maxCodeBytes} bytes).`
      );
    }

    // ── Unique IDs — prevent filename and container name collisions ─────────
    // The same UUID is used for the temp dir suffix AND the container --name.
    // UUID v4 is cryptographically random: P(collision) ≈ 0 even under load.
    const executionId   = uuidv4();
    const containerName = `codeanywhere-${executionId}`;
    const tmpDir        = path.join(os.tmpdir(), containerName);

    // ── Concurrency slot ────────────────────────────────────────────────────
    await this._semaphore.acquire();

    const t0     = Date.now();
    let stdout   = "";
    let stderr   = "";
    let exitCode = 0;
    let timedOut = false;

    try {
      // 1. Verify Docker daemon (cached after first success)
      await this._assertDockerAvailable();

      // 2. Create unique temp workspace with explicit permissions so
      //    the non-root container user (uid/gid) can read the source file.
      //    0o755 = rwxr-xr-x (directory: world-enterable + readable)
      //    0o644 = rw-r--r-- (file:      world-readable)
      await fs.mkdir(tmpDir, { recursive: true, mode: 0o755 });
      await fs.writeFile(
        path.join(tmpDir, langCfg.filename),
        code,
        { encoding: "utf8", mode: 0o644 }
      );

      // 3. Pull image if not already in local cache
      await this._ensureImage(langCfg.image);

      // 4. Build docker run args with the full security profile
      const runCmd     = langCfg.runCmd();
      const dockerArgs = this._buildDockerArgs(
        langCfg.image,
        containerName,
        tmpDir,
        runCmd
      );

      console.log(
        `[exec:${executionId.slice(0, 8)}] ` +
        `lang=${langKey} image=${langCfg.image} container=${containerName}`
      );

      // 5. Run the container — pipe stdin input (empty string = instant EOF)
      const result = await this._runContainer(dockerArgs, containerName, executionId, stdinData);

      stdout   = result.stdout;
      stderr   = result.stderr;
      exitCode = result.exitCode;
      timedOut = result.timedOut;

    } finally {
      // 6. Always clean up — fires even when the try block throws
      await this._cleanupWorkspace(tmpDir, containerName, executionId);
      this._semaphore.release();
    }

    const durationMs = Date.now() - t0;

    console.log(
      `[done:${executionId.slice(0, 8)}] ` +
      `exit=${exitCode} time=${durationMs}ms timedOut=${timedOut}`
    );

    /** @type {ExecutionResult} */
    return {
      executionId,
      language:   langKey,
      exitCode,
      stdout:     this._truncate(stdout),
      stderr:     this._truncate(stderr),
      timedOut,
      durationMs,
      engine:     "docker",
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** Verify Docker daemon reachable. Throws DockerUnavailableError on failure. */
  async _assertDockerAvailable() {
    if (this._dockerReady) return;
    try {
      await execFileAsync(
        "docker", ["info", "--format", "{{.ServerVersion}}"],
        { timeout: 6_000, env: DOCKER_CLI_ENV }
      );
      this._dockerReady = true;
    } catch {
      throw new DockerUnavailableError(
        "Docker is not running or not installed. " +
        "Please start Docker Desktop and try again."
      );
    }
  }

  /**
   * Pull a Docker image if it is not already cached locally.
   * Uses an in-memory Set so the pull cost is paid at most once per server lifetime.
   * @param {string} image
   */
  async _ensureImage(image) {
    if (this._pulledImages.has(image)) return;
    try {
      await execFileAsync(
        "docker", ["image", "inspect", "--format", "{{.Id}}", image],
        { timeout: 5_000, env: DOCKER_CLI_ENV }
      );
      this._pulledImages.add(image);
    } catch {
      console.log(`[docker] Pulling ${image} — first use, may take a minute…`);
      await execFileAsync(
        "docker", ["pull", image],
        { timeout: 300_000, env: DOCKER_CLI_ENV }
      );
      this._pulledImages.add(image);
      console.log(`[docker] ${image} ready.`);
    }
  }

  /**
   * Builds the complete `docker run` argument array.
   *
   * ═══ Security flags ═══════════════════════════════════════════════════════
   *
   * ── Lifecycle ──────────────────────────────────────────────────────────────
   *  --rm                  Auto-remove container on exit. Belt-and-suspenders:
   *                        cleanup() also calls `docker rm -f` in case --rm fails.
   *  --name=<uuid>         Unique name so `docker kill <name>` works on timeout.
   *
   * ── Network ────────────────────────────────────────────────────────────────
   *  --network=none        Completely disables networking inside the container.
   *                        No outbound connections, no DNS, no loopback traffic.
   *                        Prevents exfiltration, C2 callbacks, and dependency pulls.
   *
   * ── Resource limits ────────────────────────────────────────────────────────
   *  --memory=<limit>      Hard RAM cap. Docker's OOM killer fires if exceeded.
   *  --memory-swap=<limit> Same value as --memory disables swap entirely.
   *                        Without this, a container can use RAM + full swap.
   *  --cpus=<fraction>     CPU share cap (e.g. 0.5 = half a core).
   *  --pids-limit=<n>      Maximum number of processes/threads. Blocks fork bombs.
   *                        Set to 64 by default — enough for JVM threads, too few
   *                        for exponential fork bombs (which need 2^N processes).
   *  --ulimit nofile=<n>   Limits open file descriptors. Prevents FD exhaustion
   *                        attacks that can crash the host daemon.
   *
   * ── Filesystem ─────────────────────────────────────────────────────────────
   *  --read-only           Container root FS is immutable. Malware cannot persist
   *                        itself, modify system binaries, or write to disk.
   *  --tmpfs=/tmp:...      32 MB writeable scratch space in RAM (tmpfs).
   *                        nosuid: setuid bits on files in /tmp have no effect.
   *                        uid/gid: tmpfs owned by the non-root container user
   *                        so compiled binaries and output files can be written.
   *                        NOTE: noexec is intentionally ABSENT — compiled binaries
   *                        (C, C++, Java .class, Rust) must execute from /tmp.
   *  -v <tmpDir>:/code:ro  Source code directory mounted read-only.
   *                        The container cannot modify the source.
   *                        NEVER mounted: Docker socket, host root, or secrets.
   *
   * ── Identity / privilege ───────────────────────────────────────────────────
   *  --user=<uid>:<gid>    Run all processes as a non-root user (nobody, UID 65534).
   *                        Even if the container is compromised, the process has
   *                        no privileges outside its own process space.
   *  --security-opt=no-new-privileges
   *                        Prevents setuid/setgid programs from gaining elevated
   *                        privileges. Blocks most local privilege escalation paths.
   *  --cap-drop=ALL        Drops ALL Linux capabilities from the container.
   *                        Without capabilities, even root inside the container
   *                        cannot modify network settings, mount filesystems,
   *                        load kernel modules, or perform other privileged ops.
   *
   * ── Explicitly absent flags (never used) ───────────────────────────────────
   *  --privileged          Would grant full host access — never used.
   *  --cap-add             Would re-add capabilities — never used.
   *  -v /var/run/docker.sock  Would expose Docker socket — never mounted.
   *  --env <HOST_VAR>      Would forward host secrets — never used.
   *  --pid=host            Would share host PID namespace — never used.
   *  --ipc=host            Would share host IPC namespace — never used.
   *  --net=host            Would expose host network — never used.
   *
   * ── I/O ─────────────────────────────────────────────────────────────────────
   *  --no-stdin            No standard input. Prevents hangs on read()/input().
   *  --log-driver=none     Disables Docker's log buffer for this container.
   *                        All output is captured via the child process pipes.
   *
   * ── Environment ─────────────────────────────────────────────────────────────
   *  -e HOME=/tmp          Explicit safe HOME so JVMs, compilers, and runtimes
   *                        that write to ~/.cache don't fail with "no such directory".
   *                        No other host env vars are forwarded.
   *
   * @param {string}   image
   * @param {string}   containerName
   * @param {string}   hostCodeDir
   * @param {string[]} runCmd
   * @returns {string[]}
   */
  _buildDockerArgs(image, containerName, hostCodeDir, runCmd) {
    return [
      "run",

      // ── Lifecycle ─────────────────────────────────────────────────────────
      "--rm",
      `--name=${containerName}`,

      // ── Network ───────────────────────────────────────────────────────────
      "--network=none",

      // ── Resource limits ───────────────────────────────────────────────────
      `--memory=${this.memoryLimit}`,
      `--memory-swap=${this.memoryLimit}`,
      `--cpus=${this.cpuLimit}`,
      `--pids-limit=${this.pidsLimit}`,
      `--ulimit=nofile=${this.maxOpenFiles}:${this.maxOpenFiles}`,

      // ── Filesystem ────────────────────────────────────────────────────────
      "--read-only",
      // nosuid: setuid bits inert | uid/gid: tmpfs owned by non-root user
      // noexec intentionally absent — compiled binaries must run from /tmp
      `--tmpfs=/tmp:size=${this.tmpfsSizeMb}m,nosuid,uid=${this.uid},gid=${this.gid}`,
      "-v", `${hostCodeDir}:/code:ro`,

      // ── Identity / privilege ──────────────────────────────────────────────
      `--user=${this.uid}:${this.gid}`,
      "--security-opt=no-new-privileges",
      "--cap-drop=ALL",

      // ── I/O ───────────────────────────────────────────────────────────────
      "--no-stdin",
      "--log-driver=none",

      // ── Environment (explicit safe defaults only — no host secrets) ───────
      "-e", "HOME=/tmp",

      // ── Image + entrypoint ────────────────────────────────────────────────
      image,
      ...runCmd,
    ];
  }

  /**
   * Spawns `docker run` and enforces the hard execution timeout.
   *
   * Timeout strategy (belt-and-suspenders):
   *   1. setTimeout fires after `timeoutMs`
   *   2. `docker kill <name>` — stops the container at the Docker daemon level
   *   3. `child.kill("SIGKILL")` — also kills the docker CLI child process
   *
   * This ensures no zombie containers remain after a timeout.
   *
   * The docker CLI process is spawned with a minimal whitelisted environment
   * (DOCKER_CLI_ENV) so host secrets are never accessible in the child process.
   *
   * @param {string[]} dockerArgs
   * @param {string}   containerName
   * @param {string}   executionId
   * @param {string}   stdinData     Content to write to the container's stdin.
   * @returns {Promise<{stdout:string, stderr:string, exitCode:number, timedOut:boolean}>}
   */
  _runContainer(dockerArgs, containerName, executionId, stdinData = "") {
    return new Promise((resolve) => {
      const BUFFER_CAP = this.maxOutputBytes * 2;
      let stdout   = "";
      let stderr   = "";
      let settled  = false;
      let timedOut = false;

      const child = spawn("docker", dockerArgs, {
        // stdin is always a pipe so we control exactly when it closes.
        // Writing stdinData then calling end() is equivalent to --no-stdin
        // when stdinData is empty, and enables real stdin when it's not.
        stdio: ["pipe", "pipe", "pipe"],
        // Pass only the minimal whitelisted env — no host secrets forwarded
        env: DOCKER_CLI_ENV,
      });

      // Write stdin payload and close immediately.
      // This prevents programs from hanging on read() when no input is given
      // and allows programs to consume exactly the provided input.
      child.stdin.on("error", () => {});  // suppress EPIPE if container exits early
      child.stdin.end(stdinData);

      child.stdout.on("data", (chunk) => {
        if (stdout.length < BUFFER_CAP) stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        if (stderr.length < BUFFER_CAP) stderr += chunk.toString("utf8");
      });

      // ── Hard timeout ─────────────────────────────────────────────────────
      const killTimer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        console.warn(
          `[timeout:${executionId.slice(0, 8)}] ` +
          `Killing ${containerName} after ${this.timeoutMs}ms`
        );
        // 1. Stop the container at the daemon level
        execFile("docker", ["kill", containerName],
          { env: DOCKER_CLI_ENV }, () => {}
        );
        // 2. Kill the docker CLI process as well
        child.kill("SIGKILL");
      }, this.timeoutMs);

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        resolve({
          stdout,
          stderr: timedOut
            ? `${stderr}\n\n⏱  Execution timed out after ${this.timeoutMs / 1000}s.`
            : stderr,
          exitCode: timedOut ? 124 : (code ?? 1),
          timedOut,
        });
      });

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        resolve({ stdout, stderr: err.message, exitCode: 1, timedOut: false });
      });
    });
  }

  /**
   * Removes the temporary workspace and force-removes the container.
   * Never throws — cleanup errors are logged but never propagated.
   * This runs in a `finally` block so it fires even on uncaught errors.
   *
   * @param {string} tmpDir
   * @param {string} containerName
   * @param {string} executionId
   */
  async _cleanupWorkspace(tmpDir, containerName, executionId) {
    const tag = executionId.slice(0, 8);

    // Remove temp workspace
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[cleanup:${tag}] tmpDir removal failed: ${err.message}`);
    }

    // Belt-and-suspenders: force-remove container in case --rm didn't fire
    // (e.g. Docker daemon restart during execution, or mid-timeout race)
    try {
      await execFileAsync(
        "docker", ["rm", "-f", containerName],
        { timeout: 5_000, env: DOCKER_CLI_ENV }
      );
    } catch {
      // Expected when --rm already cleaned it up — silently ignore
    }
  }

  /**
   * Truncates a string to maxOutputBytes, appending a notice if cut.
   * Truncation is byte-aware (not character-aware) to prevent encoding tricks.
   * @param {string} str
   * @returns {string}
   */
  _truncate(str) {
    if (!str) return "";
    const buf = Buffer.from(str, "utf8");
    if (buf.length <= this.maxOutputBytes) return str;
    return (
      buf.slice(0, this.maxOutputBytes).toString("utf8") +
      "\n\n[Output truncated — exceeded maximum output size]"
    );
  }
}

/**
 * @typedef {object} ExecutionResult
 * @property {string}  executionId  UUID uniquely identifying this run.
 * @property {string}  language     Normalised language key (e.g. "python").
 * @property {number}  exitCode     0=success, 1=error/compile-fail, 124=timeout.
 * @property {string}  stdout       Captured standard output (truncated if large).
 * @property {string}  stderr       Captured standard error  (truncated if large).
 * @property {boolean} timedOut     True when the hard timeout was triggered.
 * @property {number}  durationMs   Wall-clock ms from container launch to cleanup.
 * @property {string}  engine       Always "docker".
 */
