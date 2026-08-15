"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { grammarDirectory, repositoryDirectory } = require("./tree-sitter.js");
const scannerFiles = [
  path.join(grammarDirectory, "src", "scanner.c"),
  path.join(repositoryDirectory, "test", "scanner.c"),
];

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: repositoryDirectory,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    if (result.stdout) {
      process.stderr.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function llvmTool(name, environmentName) {
  if (process.platform !== "darwin") {
    return process.env[environmentName] ?? name;
  }
  const result = childProcess.spawnSync("brew", ["--prefix", "llvm"], {
    encoding: "utf8",
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`brew --prefix llvm exited with status ${result.status}`);
  }
  return path.join(result.stdout.trim(), "bin", name);
}

if (process.argv.length === 3 && process.argv[2] === "--write") {
  run(llvmTool("clang-format", "CLANG_FORMAT"), ["-i", ...scannerFiles], {
    stdio: "inherit",
  });
} else if (process.argv.length === 2) {
  run(
    llvmTool("clang-format", "CLANG_FORMAT"),
    ["--dry-run", "--Werror", ...scannerFiles],
    { stdio: "inherit" },
  );

  const clangd = llvmTool("clangd", "CLANGD");
  for (const scannerFile of scannerFiles) {
    run(clangd, [`--check=${scannerFile}`, "--tweaks="], { stdio: "inherit" });
  }

  const testDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "tree-sitter-posix-awk-scanner."),
  );
  try {
    const testBinary = path.join(testDirectory, "scanner");
    run(
      llvmTool("clang", "CLANG"),
      [
        "-std=c11",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-pedantic",
        "-I",
        path.join(grammarDirectory, "src"),
        path.join(repositoryDirectory, "test", "scanner.c"),
        "-o",
        testBinary,
      ],
      { stdio: "inherit" },
    );
    run(testBinary, [], { stdio: "inherit" });
  } finally {
    fs.rmSync(testDirectory, { force: true, recursive: true });
  }
} else {
  throw new Error("Usage: node scripts/check-scanner.js [--write]");
}
