import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEdits, parseSummary } from "./support/parser.js";

const normalFileBytes = 256 * 1024;
const normalNestingDepths = [16, 32, 64];
const normalParseTimeoutMicros = 1_000_000;
const normalLatencyMs = normalParseTimeoutMicros / 1000;
const measurementSamples = 3;
const warmupSamples = 1;
const scalingItemCounts = [512, 2048, 8192];
const scalingLiteralBytes = [16 * 1024, 64 * 1024, normalFileBytes];
const scalingGrowthAllowance = 3;
const timingNoiseAllowanceMs = 10;
const stressNestingDepth = 2048;
const stressContinuationCount = 32_768;
const stressIncompleteCount = 1200;

function median(samples) {
  return samples.sort((left, right) => left - right)[
    Math.floor(samples.length / 2)
  ];
}

function measure(
  context,
  label,
  source,
  edit,
  successful = true,
  normal = false,
) {
  const final = applyEdits(source, [edit]);
  const freshSamples = [];
  const incrementalSamples = [];
  const options = normal ? { timeoutMicros: normalParseTimeoutMicros } : {};
  for (let run = 0; run < warmupSamples + measurementSamples; run++) {
    const fresh = parseSummary(final, [], options);
    const incremental = parseSummary(source, [edit], options);
    assert.equal(fresh.successful, successful, `${label}: fresh`);
    assert.equal(incremental.successful, successful, `${label}: incremental`);
    if (run >= warmupSamples) {
      freshSamples.push(fresh.freshMs);
      incrementalSamples.push(incremental.incrementalMs);
    }
  }
  const freshMs = median(freshSamples);
  const incrementalMs = median(incrementalSamples);
  context.diagnostic(
    `${label}: bytes=${final.length}, fresh_ms=${freshMs.toFixed(3)}, incremental_ms=${incrementalMs.toFixed(3)}`,
  );
  if (normal) {
    assert.ok(freshMs < normalLatencyMs, `${label}: fresh ${freshMs} ms`);
    assert.ok(
      incrementalMs < normalLatencyMs,
      `${label}: edit ${incrementalMs} ms`,
    );
  }
  return { bytes: final.length, freshMs, incrementalMs };
}

function replacement(source, target, insert, start = 0) {
  const offset = source.indexOf(target, start);
  assert.ok(offset >= 0, `missing edit target: ${target}`);
  return {
    byte: Buffer.byteLength(source.slice(0, offset)),
    deleteBytes: Buffer.byteLength(target),
    insert,
  };
}

const representativeProgram = `@namespace "bench"
function fold(value) {
  if (value ~ /[a-z]+/) return length(value)
  return 0
}
BEGIN {
  total = 0
  values[1][2] = @/a{1,2}/
  name = "fold"
  result = @name("x")
  switch (result) {case 1: print result; default: break;}
  while ((getline record < file) > 0) total += 1
  while (("cat" | getline record) > 0) print record
  while (("cat" |& getline record) > 0) print record
}
/[a-z]+/ {total += 1; print $1}
END {print total}
`;

for (const { name, copies } of [
  { name: "small", copies: 1 },
  {
    name: "256 KiB",
    copies: Math.ceil(
      normalFileBytes / Buffer.byteLength(representativeProgram),
    ),
  },
]) {
  test(`gawk: normal: ${name} GNU programs remain responsive`, (context) => {
    const source = representativeProgram.repeat(copies);
    measure(
      context,
      name,
      source,
      replacement(source, "total = 0", "total = 1"),
      true,
      true,
    );
  });
}

test("gawk: normal: beginning middle and end edits and repairs remain responsive", (context) => {
  const line = '{ name = 1; print "value\\n", /a\\x2bb/; }\n';
  const rows = Math.ceil(normalFileBytes / Buffer.byteLength(line));
  const source = line.repeat(rows);
  for (const row of [0, Math.floor(rows / 2), rows - 1]) {
    const start = row * line.length;
    for (const [target, insert] of [
      ["name", "item"],
      ["1", "2"],
      ["value", "other"],
      ["\\x2b", "\\x2a"],
    ]) {
      measure(
        context,
        `row ${row}, ${target}`,
        source,
        replacement(source, target, insert, start),
        true,
        true,
      );
    }
    const remove = replacement(source, "}", "", start);
    measure(context, `row ${row}, deletion`, source, remove, false, true);
    const broken = applyEdits(source, [remove]);
    measure(
      context,
      `row ${row}, repair`,
      broken,
      { byte: remove.byte, deleteBytes: 0, insert: "}" },
      true,
      true,
    );
  }
});

test("gawk: normal: namespace and parameter edits reclassify later source responsively", (context) => {
  const body = "BEGIN {print systime (3)}\n";
  const copies = Math.ceil(normalFileBytes / Buffer.byteLength(body));
  const namespaced = `@namespace "awk"\n${body.repeat(copies)}`;
  measure(
    context,
    "namespace",
    namespaced,
    replacement(namespaced, '"awk"', '"lib"'),
    true,
    true,
  );
  const functionBody = "print systime (3);\n";
  const parameter = `function f(systime) {\n${functionBody.repeat(Math.ceil(normalFileBytes / functionBody.length))}}\n${body}`;
  measure(
    context,
    "parameter",
    parameter,
    replacement(parameter, "systime", "local"),
    true,
    true,
  );
});

const nestedCases = [
  {
    name: "blocks",
    source: (n) => `BEGIN ${"{".repeat(n)}print x;${"}".repeat(n)}\n`,
  },
  {
    name: "parentheses",
    source: (n) => `BEGIN {print ${"(".repeat(n)}x${")".repeat(n)}}\n`,
  },
  {
    name: "calls",
    source: (n) => `BEGIN {print ${"f(".repeat(n)}x${")".repeat(n)}}\n`,
  },
  {
    name: "subscripts",
    source: (n) => `BEGIN {print ${"a[".repeat(n)}x${"]".repeat(n)}}\n`,
  },
  {
    name: "fields",
    source: (n) => `BEGIN {print ${"$(".repeat(n)}x${")".repeat(n)}}\n`,
  },
  {
    name: "regexp groups",
    source: (n) => `/${"(".repeat(n)}x${")".repeat(n)}/\n`,
  },
  {
    name: "getline targets",
    source: (n) => `{${"getline $(".repeat(n)}x${")".repeat(n)}}\n`,
  },
  {
    name: "getline sources",
    source: (n) => `{${"getline x < (".repeat(n)}x${")".repeat(n)}}\n`,
  },
  {
    name: "multidimensional arrays",
    source: (n) => `BEGIN {print a${"[1]".repeat(n)}[x]}\n`,
  },
];

for (const { name, source: createSource } of nestedCases) {
  test(`gawk: normal: ${name} at 16 32 and 64 levels remain responsive`, (context) => {
    for (const depth of normalNestingDepths) {
      const source = createSource(depth);
      measure(
        context,
        `${name}/${depth}`,
        source,
        replacement(source, "x", "y"),
        true,
        true,
      );
    }
  });
}

const scalingCases = [
  { name: "rules", source: (n) => '{print "x"}\n'.repeat(n) },
  {
    name: "functions",
    source: (n) =>
      Array.from({ length: n }, (_, i) => `function f${i}() {return x}\n`).join(
        "",
      ),
  },
  {
    name: "namespace directives",
    source: (n) =>
      '@namespace "lib"\nBEGIN {print systime (x)}\n@namespace "awk"\nBEGIN {print systime(x)}\n'.repeat(
        n,
      ),
  },
  { name: "include directives", source: (n) => '@include "x.awk"\n'.repeat(n) },
  {
    name: "strings",
    sizes: scalingLiteralBytes,
    source: (n) => `BEGIN {print "x${"a".repeat(n)}"}\n`,
  },
  { name: "regular expressions", source: (n) => `/x${"a".repeat(n)}/\n` },
  { name: "addition", source: (n) => `{x${"+1".repeat(n)}}\n` },
  { name: "assignments", source: (n) => `{${"a=".repeat(n)}x}\n` },
  { name: "conditionals", source: (n) => `{${"a?b:".repeat(n)}x}\n` },
  { name: "arguments", source: (n) => `{f(x${",a".repeat(n)})}\n` },
  {
    name: "getline sources",
    source: (n) => `{getline a < x${"+1".repeat(n)}}\n`,
  },
  {
    name: "unterminated strings",
    sizes: scalingLiteralBytes,
    successful: false,
    source: (n) => `BEGIN {print "x${"a".repeat(n)}`,
  },
];

for (const {
  name,
  sizes = scalingItemCounts,
  source: createSource,
  successful = true,
} of scalingCases) {
  test(`gawk: large: ${name} avoid extreme scaling`, (context) => {
    let previous;
    for (const size of sizes) {
      const source = createSource(size);
      const current = measure(
        context,
        `${name}/${size}`,
        source,
        replacement(source, "x", "y"),
        successful,
      );
      if (previous) {
        const byteRatio = current.bytes / previous.bytes;
        for (const metric of ["freshMs", "incrementalMs"]) {
          const limitMs =
            previous[metric] * byteRatio * scalingGrowthAllowance +
            timingNoiseAllowanceMs;
          assert.ok(
            current[metric] <= limitMs,
            `${name}: ${metric} grew from ${previous[metric]} to ${current[metric]} ms for ${byteRatio.toFixed(2)} times the bytes`,
          );
        }
      }
      previous = current;
    }
  });
}

const stressCases = [
  ...nestedCases.map(({ name, source }) => ({
    name,
    source: source(stressNestingDepth),
    successful: true,
  })),
  {
    name: "split regexp escape",
    source: `/a\\x2${"\\\n".repeat(stressContinuationCount)}b/\n`,
    successful: true,
  },
  {
    name: "incomplete directives",
    source: '@namespace "\n'.repeat(stressIncompleteCount),
    successful: false,
  },
  {
    name: "incomplete getline expressions",
    source: ") getline < \n".repeat(stressIncompleteCount),
    successful: false,
  },
  {
    name: "incomplete operators and delimiters",
    source: "$ ) , \n".repeat(stressIncompleteCount),
    successful: false,
  },
];

for (const { name, source, successful } of stressCases) {
  test(`gawk: stress: ${name} finish through EOF`, () => {
    assert.equal(
      parseSummary(source, [], { completionOnly: true }).successful,
      successful,
      name,
    );
  });
}
