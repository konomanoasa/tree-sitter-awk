import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEdits, parseSummary } from "./support/parser.js";
import {
  normalWorkloads,
  replacement,
  scalingCases,
  scalingItemCounts,
} from "./support/workloads.js";

const normalParseTimeoutMicros = 1_000_000;
const normalLatencyMs = normalParseTimeoutMicros / 1000;
const measurementSamples = 3;
const warmupSamples = 1;
const scalingGrowthAllowance = 3;
const timingNoiseAllowanceMs = 10;

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

for (const { name, run } of normalWorkloads()) {
  test(`gawk: normal: ${name} remain responsive`, (context) => {
    run((label, source, edit, successful = true) =>
      measure(context, label, source, edit, successful, true),
    );
  });
}
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
