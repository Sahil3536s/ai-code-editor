/**
 * CodeAnywhere — Docker Execution HTTP Server
 *
 * This file handles HTTP concerns only (routing, middleware, rate limiting,
 * security headers). All execution logic lives in executionService.js.
 *
 * Security layers applied here:
 *   • helmet()             — Secure HTTP response headers (XSS, clickjacking, MIME sniffing, etc.)
 *   • express-rate-limit   — Per-IP rate limiting (separate limits for /api/execute vs. general)
 *   • CORS                 — Restricted to localhost origins only
 *   • Body size cap        — express.json({ limit }) rejects oversized requests before parsing
 *   • Input validation     — Delegated to ExecutionService.execute()
 *   • No env var leakage   — Error responses never include process.env values
 *
 * Endpoints:
 *   GET  /               — HTML status page (browser-friendly, shows security config)
 *   GET  /api/health     — JSON health + runtime stats + current limits
 *   GET  /api/languages  — List of executable languages
 *   POST /api/execute    — Run code in an isolated Docker container
 *
 * POST /api/execute body:   { code: string, language: string }
 * POST /api/execute success: ExecutionResult (see executionService.js)
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import {
  ExecutionService,
  ValidationError,
  DockerUnavailableError,
} from "./executionService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration — all values read from environment variables with secure defaults.
// Copy server/.env.example to server/.env and adjust as needed.
// ─────────────────────────────────────────────────────────────────────────────

// ── Server ─────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3001;

// ── Timing / sizing ─────────────────────────────────────────────────────────
/** Max ms a single container is allowed to run before force-kill */
const TIMEOUT_MS     = Number(process.env.EXECUTION_TIMEOUT_MS) || 10_000;
/** Max bytes captured from stdout+stderr combined */
const MAX_OUTPUT     = Number(process.env.MAX_OUTPUT_BYTES)     || 65_536;   // 64 KB
/** Max simultaneous Docker containers (excess requests queue) */
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT)       || 5;
/** Max source code size per request */
const MAX_CODE_BYTES = Number(process.env.MAX_CODE_BYTES)       || 102_400;  // 100 KB
/** Max stdin input size per request */
const MAX_INPUT_BYTES = Number(process.env.MAX_INPUT_BYTES)     || 8_192;    // 8 KB

// ── Container resource limits ───────────────────────────────────────────────
const MEMORY_LIMIT    = process.env.MEMORY_LIMIT                    || "128m";
const CPU_LIMIT       = process.env.CPU_LIMIT                       || "0.5";
/** PID limit — blocks fork bombs (each fork() counts against this) */
const PIDS_LIMIT      = Number(process.env.PIDS_LIMIT)              || 64;
/** Open file descriptor limit per container */
const MAX_OPEN_FILES  = Number(process.env.MAX_OPEN_FILES)          || 512;
/** /tmp tmpfs size in MB — writeable scratch for compilers */
const TMPFS_SIZE_MB   = Number(process.env.TMPFS_SIZE_MB)           || 32;

// ── Container identity (non-root user) ──────────────────────────────────────
/** UID for --user flag (65534 = nobody on most Linux distros) */
const CONTAINER_UID   = Number(process.env.CONTAINER_UID)           || 65534;
/** GID for --user flag */
const CONTAINER_GID   = Number(process.env.CONTAINER_GID)           || 65534;

// ── HTTP rate limiting ───────────────────────────────────────────────────────
/** Max /api/execute requests per IP per minute */
const RATE_LIMIT_EXECUTE = Number(process.env.RATE_LIMIT_EXECUTE)   || 15;
/** Max general API requests per IP per minute */
const RATE_LIMIT_GENERAL = Number(process.env.RATE_LIMIT_GENERAL)   || 60;

// ─────────────────────────────────────────────────────────────────────────────
// Execution service singleton
// ─────────────────────────────────────────────────────────────────────────────
const executor = new ExecutionService({
  timeoutMs:      TIMEOUT_MS,
  maxOutputBytes: MAX_OUTPUT,
  maxConcurrent:  MAX_CONCURRENT,
  maxCodeBytes:   MAX_CODE_BYTES,
  maxInputBytes:  MAX_INPUT_BYTES,
  memoryLimit:    MEMORY_LIMIT,
  cpuLimit:       CPU_LIMIT,
  pidsLimit:      PIDS_LIMIT,
  maxOpenFiles:   MAX_OPEN_FILES,
  tmpfsSizeMb:    TMPFS_SIZE_MB,
  uid:            CONTAINER_UID,
  gid:            CONTAINER_GID,
});

/** Formats the internal execution result to a public-facing object */
function formatResponse(result) {
  const success = result.exitCode === 0 && !result.timedOut;
  let error = null;
  let errorType = null;
  let output = result.stdout;

  if (result.timedOut) {
    error = `Execution timed out after ${TIMEOUT_MS / 1000}s.`;
    errorType = "TIMEOUT";
  } else if (result.exitCode !== 0) {
    // Check if it's a compilation error
    const compileErrMarker = "Compilation error:\n";
    const markerIndex = result.stdout.indexOf(compileErrMarker);
    
    if (markerIndex !== -1) {
      errorType = "COMPILATION_ERROR";
      error = result.stdout.substring(markerIndex).trim();
      // Clean up the output to exclude the compilation error message
      output = result.stdout.substring(0, markerIndex).trim();
    } else {
      errorType = "RUNTIME_ERROR";
      error = result.stderr.trim() || `Process exited with code ${result.exitCode}.`;
    }
  }

  return {
    success,
    output,
    error,
    errorType,
    executionTime: result.durationMs,
    language:      result.language,
    executionId:   result.executionId,
    engine:        "docker"
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Runtime counters
// ─────────────────────────────────────────────────────────────────────────────
let totalRequests = 0;
const startedAt   = new Date().toISOString();

// ─────────────────────────────────────────────────────────────────────────────
// Express app
// ─────────────────────────────────────────────────────────────────────────────
const app = express();

// ── Security headers (helmet) ────────────────────────────────────────────────
// Sets: Content-Security-Policy, X-Content-Type-Options, X-Frame-Options,
//       Strict-Transport-Security, X-XSS-Protection, Referrer-Policy, etc.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        scriptSrc:   ["'none'"],    // API server serves no scripts
        styleSrc:    ["'unsafe-inline'"],  // Inline styles for status page
        imgSrc:      ["'none'"],
        connectSrc:  ["'none'"],
        fontSrc:     ["'none'"],
        objectSrc:   ["'none'"],
        frameSrc:    ["'none'"],
        baseUri:     ["'self'"],
        formAction:  ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-origin" },
  })
);

// ── Body parsing — cap BEFORE parsing to reject oversized payloads early ────
// This is the HTTP-layer defense; maxCodeBytes in ExecutionService is the
// application-layer defense. Both are needed.
app.use(express.json({ limit: "512kb" }));

// ── CORS — restrict to localhost origins only ────────────────────────────────
app.use(
  cors({
    origin(origin, cb) {
      // Allow same-origin requests (no Origin header) and localhost only
      if (!origin || /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        cb(null, true);
      } else {
        cb(new Error("CORS: origin not allowed"));
      }
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

// ── General rate limit (all routes) ─────────────────────────────────────────
// Protects all endpoints from basic flooding.
app.use(
  rateLimit({
    windowMs:        60 * 1000,       // 1-minute window
    max:             RATE_LIMIT_GENERAL,
    standardHeaders: true,            // RateLimit-* headers in response
    legacyHeaders:   false,
    message:         { error: "Too many requests. Please slow down." },
    // Skip rate-limiting for internal/localhost (useful for dev health checks)
    skip: (req) => req.ip === "127.0.0.1" || req.ip === "::1",
  })
);

// ── Execute-specific rate limit (stricter) ───────────────────────────────────
// Code execution is expensive; apply a tighter limit to this endpoint only.
const executeRateLimit = rateLimit({
  windowMs:        60 * 1000,
  max:             RATE_LIMIT_EXECUTE,
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    error: `Execution rate limit reached. Max ${RATE_LIMIT_EXECUTE} runs per minute per IP.`,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// GET / — browser-friendly status + security dashboard
// ─────────────────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  const langs = executor
    .supportedLanguages()
    .map((l) => `<li><code>${l.key}</code> — ${l.label}</li>`)
    .join("\n");

  // Build a live security config summary for the status page
  const secRows = [
    ["--network",      "none (disabled)"],
    ["--memory",       MEMORY_LIMIT],
    ["--memory-swap",  MEMORY_LIMIT + " (swap disabled)"],
    ["--cpus",         CPU_LIMIT],
    ["--pids-limit",   String(PIDS_LIMIT)],
    ["--ulimit nofile",String(MAX_OPEN_FILES)],
    ["--read-only",    "enabled"],
    ["--tmpfs /tmp",   `${TMPFS_SIZE_MB}MB (nosuid, uid=${CONTAINER_UID})`],
    ["--user",         `${CONTAINER_UID}:${CONTAINER_GID} (non-root)`],
    ["--cap-drop",     "ALL"],
    ["--security-opt", "no-new-privileges"],
    ["stdin",          "closed immediately after input (no hang risk)"],
    ["--privileged",   "never used"],
    ["docker.sock",    "never mounted"],
    ["timeout",        `${TIMEOUT_MS / 1000}s`],
    ["max code",       `${(MAX_CODE_BYTES / 1024).toFixed(0)} KB`],
    ["max input",      `${(MAX_INPUT_BYTES / 1024).toFixed(0)} KB`],
    ["max output",     `${(MAX_OUTPUT / 1024).toFixed(0)} KB`],
  ].map(([k, v]) =>
    `<tr><td><code class="flag">${k}</code></td><td class="val">${v}</td></tr>`
  ).join("\n");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>CodeAnywhere — Execution Server</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0; padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0e1a; color: #f1f5f9; min-height: 100vh;
    }
    .wrap  { max-width: 760px; margin: 40px auto; display: grid; gap: 20px; }
    .card  {
      background: #131832; border: 1px solid #1e293b;
      border-radius: 16px; padding: 28px 32px;
    }
    .badge {
      display: inline-flex; align-items: center; gap: 8px;
      background: rgba(34,197,94,.12); color: #4ade80;
      border: 1px solid rgba(34,197,94,.3);
      border-radius: 999px; padding: 4px 14px; font-size: 13px;
      font-weight: 600; margin-bottom: 18px;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e;
           animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
    h1 { margin: 0 0 6px; font-size: 1.7rem; font-weight: 800; }
    h2 { margin: 0 0 14px; font-size: 1rem; color: #94a3b8; font-weight: 600;
         text-transform: uppercase; letter-spacing: .06em; }
    p  { color: #94a3b8; margin: 0 0 20px; line-height: 1.65; font-size: 14px; }
    a  { color: #38bdf8; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    td    { padding: 6px 10px; border-bottom: 1px solid #1e293b; }
    td:first-child { width: 45%; }
    code.flag { color: #a78bfa; background: #1e293b; padding: 2px 8px;
                border-radius: 4px; font-size: 12px; }
    .val  { color: #4ade80; font-weight: 500; }
    ul    { margin: 0; padding-left: 20px; color: #94a3b8;
            line-height: 2.0; font-size: 13px; }
    li code { background: #1e293b; padding: 1px 6px; border-radius: 3px; }
    pre   {
      background: #0a0e1a; border-radius: 10px; padding: 14px 18px;
      font-size: 12px; line-height: 1.8; overflow-x: auto;
      border: 1px solid #1e293b; color: #94a3b8;
    }
    .m  { color: #38bdf8; font-weight: 700; }
    .pa { color: #a78bfa; }
  </style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="badge"><span class="dot"></span> Server Running</div>
    <h1>🐳 CodeAnywhere</h1>
    <p>Docker Execution Backend is online.<br/>
       Open your app at <strong><a href="http://localhost:5173">localhost:5173</a></strong>.</p>

    <h2>API Endpoints</h2>
    <pre><span class="m">GET</span>  <span class="pa">/api/health</span>     → JSON health + runtime stats
<span class="m">GET</span>  <span class="pa">/api/languages</span>  → supported languages list
<span class="m">POST</span> <span class="pa">/api/execute</span>   → see request/response below</pre>

    <h2>Request / Response Format</h2>
    <pre><span style="color:#64748b">// Request body</span>
{ "language": "python",
  "code":     "print('Hello')",
  "input":    ""  }

<span style="color:#64748b">// Success response</span>
{ "success":       true,
  "output":        "Hello\n",
  "error":         null,
  "errorType":     null,
  "executionTime": 312,
  "language":      "python",
  "engine":        "docker" }

<span style="color:#64748b">// Error response (errorType: COMPILATION_ERROR | RUNTIME_ERROR | TIMEOUT)</span>
{ "success":       false,
  "output":        "",
  "error":         "Compilation error: ...compiler message...",
  "errorType":     "COMPILATION_ERROR",
  "executionTime": 820 }</pre>

    <h2>Supported Languages</h2>
    <ul>${langs}</ul>
  </div>

  <div class="card">
    <h2>🔒 Active Security Profile</h2>
    <table>${secRows}</table>
  </div>
</div>
</body>
</html>`);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/health
// ─────────────────────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    status:    "ok",
    engine:    "docker",
    uptime:    process.uptime(),
    startedAt,
    totalRequests,
    concurrency: {
      running:  executor._semaphore.runningCount,
      queued:   executor._semaphore.queuedCount,
      max:      MAX_CONCURRENT,
    },
    limits: {
      timeoutMs:      TIMEOUT_MS,
      maxCodeBytes:   MAX_CODE_BYTES,
      maxOutputBytes: MAX_OUTPUT,
      memory:         MEMORY_LIMIT,
      cpu:            CPU_LIMIT,
      pids:           PIDS_LIMIT,
      openFiles:      MAX_OPEN_FILES,
      tmpfsMb:        TMPFS_SIZE_MB,
      containerUser:  `${CONTAINER_UID}:${CONTAINER_GID}`,
    },
    rateLimit: {
      executePerMin: RATE_LIMIT_EXECUTE,
      generalPerMin: RATE_LIMIT_GENERAL,
    },
    supportedLanguages: executor.supportedLanguages().map((l) => l.key),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/languages
// ─────────────────────────────────────────────────────────────────────────────
app.get("/api/languages", (_req, res) => {
  res.json({ languages: executor.supportedLanguages() });
});

// ───────────────────────────────────────────────────────────────────────────────
// POST /api/execute  (strict rate limit applied)
// ───────────────────────────────────────────────────────────────────────────────
//
// Request body:
//   { language: string, code: string, input?: string }
//
// Success response (HTTP 200):
//   { success: true, output, error: null, errorType: null, executionTime, language, executionId, engine }
//
// Error responses:
//   HTTP 200  { success: false, errorType: "COMPILATION_ERROR" | "RUNTIME_ERROR" | "TIMEOUT", ... }
//   HTTP 400  { success: false, errorType: "INVALID_REQUEST" | "UNSUPPORTED_LANGUAGE" | "WEB_LANGUAGE", error }
//   HTTP 429  (from rate-limiter middleware)  { error: "...rate limit message..." }
//   HTTP 503  { success: false, errorType: "DOCKER_UNAVAILABLE", error, dockerUnavailable: true }
//   HTTP 500  { success: false, errorType: "INTERNAL_ERROR", error: "Internal server error." }
app.post("/api/execute", executeRateLimit, async (req, res) => {
  totalRequests++;

  const { code, language, input = "" } = req.body ?? {};

  try {
    const rawResult = await executor.execute({ code, language, input });
    const formatted = formatResponse(rawResult);
    res.json(formatted);

  } catch (err) {
    if (err instanceof ValidationError) {
      const msg = err.message.toLowerCase();
      let errorType = "INVALID_REQUEST";
      if (msg.includes("unsupported language")) errorType = "UNSUPPORTED_LANGUAGE";
      if (msg.includes("browser-rendered"))     errorType = "WEB_LANGUAGE";

      return res.status(400).json({
        success:   false,
        output:    "",
        error:     err.message,
        errorType,
      });
    }

    if (err instanceof DockerUnavailableError) {
      return res.status(503).json({
        success:          false,
        output:           "",
        error:            err.message,
        errorType:        "DOCKER_UNAVAILABLE",
        dockerUnavailable: true,
      });
    }

    // Unexpected error — log internally, return generic message (no details exposed)
    console.error("[unhandled]", err);
    res.status(500).json({
      success:   false,
      output:    "",
      error:     "Internal server error.",
      errorType: "INTERNAL_ERROR",
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 404 catch-all
// ─────────────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Not found. See GET / for available routes." });
});

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🐳 CodeAnywhere Docker Execution Server`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`\n   ── Security profile ──────────────────────`);
  console.log(`   Network       : none (disabled)`);
  console.log(`   Memory        : ${MEMORY_LIMIT} (swap disabled)`);
  console.log(`   CPU           : ${CPU_LIMIT} cores`);
  console.log(`   PIDs          : ${PIDS_LIMIT} max (fork bomb protection)`);
  console.log(`   Open files    : ${MAX_OPEN_FILES} max`);
  console.log(`   tmpfs         : ${TMPFS_SIZE_MB} MB (nosuid)`);
  console.log(`   User          : ${CONTAINER_UID}:${CONTAINER_GID} (non-root)`);
  console.log(`   Capabilities  : ALL dropped`);
  console.log(`   Privileges    : no-new-privileges`);
  console.log(`   Stdin         : disabled`);
  console.log(`\n   ── Limits ────────────────────────────────`);
  console.log(`   Timeout       : ${TIMEOUT_MS}ms`);
  console.log(`   Max code      : ${(MAX_CODE_BYTES / 1024).toFixed(0)} KB`);
  console.log(`   Max output    : ${(MAX_OUTPUT / 1024).toFixed(0)} KB`);
  console.log(`   Max concurrent: ${MAX_CONCURRENT}`);
  console.log(`   Rate limit    : ${RATE_LIMIT_EXECUTE} runs/min, ${RATE_LIMIT_GENERAL} req/min`);
  console.log(`\n   ── Languages ─────────────────────────────`);
  console.log(`   ${executor.supportedLanguages().map((l) => l.key).join(", ")}\n`);
});
