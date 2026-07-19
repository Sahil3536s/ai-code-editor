/**
 * languages.js — Single Source of Truth for all language configurations.
 *
 * This module is the ONLY place where Docker images, filenames, file
 * extensions, and execution commands are defined. Both the execution service
 * and the health/languages API import from here.
 *
 * ─── Structure of each entry ─────────────────────────────────────────────────
 *
 *   id          {string}   Canonical key — must match the frontend langConfig.id
 *   label       {string}   Human-readable name shown in APIs and logs
 *   extension   {string}   File extension including dot  (e.g. ".py")
 *   filename    {string}   Exact file created at /code/<filename> inside container
 *   monacoLang  {string}   Monaco editor language ID (for reference / documentation)
 *   image       {string}   Docker image:tag to use for execution
 *   runCmd      {()=>string[]}  Returns argv passed to docker after the image name.
 *                               For compiled languages this is ["sh","-c","<script>"]
 *                               where <script> compiles then runs the binary.
 *   isWeb       {boolean?} True for browser-rendered languages (React/HTML).
 *                          These are NEVER sent to Docker — handled by iframe.
 *
 * ─── Compiled language strategy ──────────────────────────────────────────────
 *
 * Compiled languages (Java, C, C++, Rust) use a two-phase sh -c script:
 *
 *   1. Compile  → stderr redirected to /tmp/cerr
 *   2. On compile failure: print "Compilation error:\n" + compiler output → exit 1
 *   3. On compile success: execute the binary normally
 *
 * This gives the user a clear signal about which phase failed and why.
 * All temporary build artefacts live in /tmp (the container's writeable tmpfs).
 *
 * ─── Security notes ──────────────────────────────────────────────────────────
 *
 * Every container is launched by executionService.js with:
 *   --network=none        no internet access inside the container
 *   --memory=128m         RAM hard cap
 *   --memory-swap=128m    swap disabled
 *   --cpus=0.5            CPU share cap
 *   --read-only           immutable root filesystem
 *   --tmpfs /tmp          32 MB writeable scratch (compilers write here)
 *   --no-stdin            prevents hangs on interactive input()
 *   --rm + --name=<uuid>  auto-cleaned, named for force-kill on timeout
 */

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build a two-phase compile-then-run shell script for compiled langs.
//
// Compilation stderr is captured to /tmp/cerr.
// On compile failure: outputs "Compilation error:\n<compiler messages>" and exits.
// On compile success: runs the binary normally (runtime errors surface naturally).
// ─────────────────────────────────────────────────────────────────────────────
const compileAndRun = (compileCmd, runCmd) =>
  // Using sh newlines (not && chaining) so we can capture $? reliably
  `${compileCmd} 2>/tmp/cerr\n` +
  `if [ $? -ne 0 ]; then printf 'Compilation error:\\n'; cat /tmp/cerr; exit 1; fi\n` +
  `${runCmd}`;

// ─────────────────────────────────────────────────────────────────────────────
// Language registry
// ─────────────────────────────────────────────────────────────────────────────
export const LANGUAGE_CONFIG = {

  // ── Python ──────────────────────────────────────────────────────────────────
  python: {
    id:         "python",
    label:      "Python 3.11",
    extension:  ".py",
    filename:   "main.py",
    monacoLang: "python",
    image:      "python:3.11-slim",
    // -u disables output buffering so print() appears immediately
    runCmd: () => ["python", "-u", "/code/main.py"],
  },

  // ── JavaScript (Node.js) ────────────────────────────────────────────────────
  javascript: {
    id:         "javascript",
    label:      "JavaScript (Node 20)",
    extension:  ".js",
    filename:   "main.js",
    monacoLang: "javascript",
    image:      "node:20-slim",
    runCmd: () => ["node", "/code/main.js"],
  },

  // ── TypeScript (Deno — native TS support, no compile step, no network needed)
  typescript: {
    id:         "typescript",
    label:      "TypeScript (Deno)",
    extension:  ".ts",
    filename:   "main.ts",
    monacoLang: "typescript",
    image:      "denoland/deno:alpine",
    // --no-remote: blocks remote imports (belt-and-suspenders alongside --network=none)
    // --allow-read=/code: only read the source file
    runCmd: () => ["deno", "run", "--no-remote", "--allow-read=/code", "/code/main.ts"],
  },

  // ── Java ────────────────────────────────────────────────────────────────────
  // Two-phase: javac compiles Main.java → /tmp/out/, then java runs Main.
  // Public class name MUST be "Main" to match the filename.
  java: {
    id:         "java",
    label:      "Java 21",
    extension:  ".java",
    filename:   "Main.java",
    monacoLang: "java",
    image:      "eclipse-temurin:21-jdk-alpine",
    runCmd: () => [
      "sh", "-c",
      compileAndRun(
        "mkdir -p /tmp/out && javac /code/Main.java -d /tmp/out",
        "java -cp /tmp/out Main"
      ),
    ],
  },

  // ── C++ ─────────────────────────────────────────────────────────────────────
  // Compiled with g++ -O2 -Wall. Binary written to /tmp/prog (tmpfs writeable).
  cpp: {
    id:         "cpp",
    label:      "C++ (GCC 12)",
    extension:  ".cpp",
    filename:   "main.cpp",
    monacoLang: "cpp",
    image:      "gcc:12",
    runCmd: () => [
      "sh", "-c",
      compileAndRun(
        "g++ -O2 -Wall -o /tmp/prog /code/main.cpp",
        "/tmp/prog"
      ),
    ],
  },

  // ── C ───────────────────────────────────────────────────────────────────────
  // Compiled with gcc -O2 -Wall. Binary written to /tmp/prog.
  c: {
    id:         "c",
    label:      "C (GCC 12)",
    extension:  ".c",
    filename:   "main.c",
    monacoLang: "c",
    image:      "gcc:12",
    runCmd: () => [
      "sh", "-c",
      compileAndRun(
        "gcc -O2 -Wall -o /tmp/prog /code/main.c",
        "/tmp/prog"
      ),
    ],
  },

  // ── Go ──────────────────────────────────────────────────────────────────────
  // go run compiles and runs in one step. HOME=/tmp so module cache stays in /tmp.
  go: {
    id:         "go",
    label:      "Go 1.22",
    extension:  ".go",
    filename:   "main.go",
    monacoLang: "go",
    image:      "golang:1.22-alpine",
    runCmd: () => ["sh", "-c", "HOME=/tmp GOPATH=/tmp/go go run /code/main.go"],
  },

  // ── Rust ────────────────────────────────────────────────────────────────────
  // rustc compiles the file; binary written to /tmp/prog.
  rust: {
    id:         "rust",
    label:      "Rust (stable)",
    extension:  ".rs",
    filename:   "main.rs",
    monacoLang: "rust",
    image:      "rust:slim",
    runCmd: () => [
      "sh", "-c",
      compileAndRun(
        "rustc /code/main.rs -o /tmp/prog",
        "/tmp/prog"
      ),
    ],
  },

  // ── Ruby ────────────────────────────────────────────────────────────────────
  ruby: {
    id:         "ruby",
    label:      "Ruby 3",
    extension:  ".rb",
    filename:   "main.rb",
    monacoLang: "ruby",
    image:      "ruby:3-slim",
    runCmd: () => ["ruby", "/code/main.rb"],
  },

  // ── PHP ─────────────────────────────────────────────────────────────────────
  php: {
    id:         "php",
    label:      "PHP 8",
    extension:  ".php",
    filename:   "main.php",
    monacoLang: "php",
    image:      "php:8-cli-alpine",
    runCmd: () => ["php", "/code/main.php"],
  },

  // ── React / HTML ─────────────────────────────────────────────────────────────
  // Browser-rendered only. Code runs inside a sandboxed <iframe> on the client.
  // This entry is NEVER forwarded to Docker — the backend must reject it.
  react: {
    id:         "react",
    label:      "React / HTML",
    extension:  ".jsx",
    filename:   "App.jsx",
    monacoLang: "javascript",
    image:      null,   // no Docker image — browser preview only
    runCmd:     null,
    isWeb:      true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Convenience exports
// ─────────────────────────────────────────────────────────────────────────────

/** All language keys that can be executed server-side (non-web). */
export const executableLanguages = Object.keys(LANGUAGE_CONFIG).filter(
  (k) => !LANGUAGE_CONFIG[k].isWeb
);

/** All language keys including browser-rendered ones. */
export const allLanguageKeys = Object.keys(LANGUAGE_CONFIG);
