const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  grammarDirectory,
  repositoryDirectory,
  throwIfFailed,
} = require("./tree-sitter.js");
const bindingFiles = [
  path.join(
    repositoryDirectory,
    "bindings",
    "c",
    "tree_sitter",
    "tree-sitter-posix-awk.h",
  ),
  path.join(repositoryDirectory, "test", "binding.test.c"),
];
const scannerFiles = [
  path.join(grammarDirectory, "src", "scanner.c"),
  path.join(repositoryDirectory, "test", "scanner.test.c"),
];
const cFiles = [...bindingFiles, ...scannerFiles];

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: repositoryDirectory,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
  throwIfFailed(result, command);
}

let llvmPrefix;

function llvmTool(name, environmentName) {
  if (process.platform !== "darwin") {
    return process.env[environmentName] ?? name;
  }
  if (llvmPrefix === undefined) {
    const result = childProcess.spawnSync("brew", ["--prefix", "llvm"], {
      encoding: "utf8",
    });
    throwIfFailed(result, "brew --prefix llvm");
    llvmPrefix = result.stdout.trim();
  }
  return path.join(llvmPrefix, "bin", name);
}

if (process.argv.length === 3 && process.argv[2] === "--write") {
  run(llvmTool("clang-format", "CLANG_FORMAT"), ["-i", ...cFiles], {
    stdio: "inherit",
  });
} else if (process.argv.length === 2) {
  run(
    llvmTool("clang-format", "CLANG_FORMAT"),
    ["--dry-run", "--Werror", ...cFiles],
    { stdio: "inherit" },
  );

  const testDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "tree-sitter-posix-awk-c."),
  );
  try {
    const clang = llvmTool("clang", "CLANG");
    const bindingInclude = path.join(repositoryDirectory, "bindings", "c");
    const scannerInclude = path.join(grammarDirectory, "src");
    const compileCommands = [
      {
        arguments: [clang, "-std=c17", "-xc", "-fsyntax-only", bindingFiles[0]],
        directory: repositoryDirectory,
        file: bindingFiles[0],
      },
      {
        arguments: [
          clang,
          "-std=c17",
          `-I${bindingInclude}`,
          "-fsyntax-only",
          bindingFiles[1],
        ],
        directory: repositoryDirectory,
        file: bindingFiles[1],
      },
      ...scannerFiles.map((scannerFile) => ({
        arguments: [
          clang,
          "-std=c17",
          `-I${scannerInclude}`,
          "-fsyntax-only",
          scannerFile,
        ],
        directory: repositoryDirectory,
        file: scannerFile,
      })),
    ];
    fs.writeFileSync(
      path.join(testDirectory, "compile_commands.json"),
      `${JSON.stringify(compileCommands)}\n`,
    );

    const clangd = llvmTool("clangd", "CLANGD");
    for (const cFile of cFiles) {
      run(
        clangd,
        [
          `--compile-commands-dir=${testDirectory}`,
          `--check=${cFile}`,
          "--tweaks=",
        ],
        { stdio: "inherit" },
      );
    }

    for (const standard of ["c99", "c17"]) {
      run(
        clang,
        [
          `-std=${standard}`,
          "-Wall",
          "-Wextra",
          "-Werror",
          "-pedantic",
          "-I",
          bindingInclude,
          "-fsyntax-only",
          bindingFiles[1],
        ],
        { stdio: "inherit" },
      );

      const testBinary = path.join(testDirectory, `scanner-${standard}`);
      run(
        clang,
        [
          `-std=${standard}`,
          "-Wall",
          "-Wextra",
          "-Werror",
          "-pedantic",
          "-I",
          scannerInclude,
          path.join(repositoryDirectory, "test", "scanner.test.c"),
          "-o",
          testBinary,
        ],
        { stdio: "inherit" },
      );
      run(testBinary, [], { stdio: "inherit" });
    }
  } finally {
    fs.rmSync(testDirectory, { force: true, recursive: true });
  }
} else {
  throw new Error("Usage: node scripts/check-c.js [--write]");
}
