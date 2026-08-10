"use strict";

const fs = require("node:fs");

const [testName, initialPath, expectedPath, ...edits] = process.argv.slice(2);

if (
  testName === undefined ||
  initialPath === undefined ||
  expectedPath === undefined ||
  edits.length === 0
) {
  throw new Error(
    "Usage: node test/assert_runtime_edits.js TEST INITIAL EXPECTED EDIT...",
  );
}

let actual = fs.readFileSync(initialPath);
const expected = fs.readFileSync(expectedPath);

for (const edit of edits) {
  const firstSpace = edit.indexOf(" ");
  const secondSpace = edit.indexOf(" ", firstSpace + 1);
  if (firstSpace < 1 || secondSpace < firstSpace + 2) {
    throw new Error(`${testName}: invalid edit ${JSON.stringify(edit)}`);
  }

  const positionText = edit.slice(0, firstSpace);
  const deleteCountText = edit.slice(firstSpace + 1, secondSpace);
  if (!/^[0-9]+$/.test(positionText) || !/^[0-9]+$/.test(deleteCountText)) {
    throw new Error(`${testName}: invalid edit ${JSON.stringify(edit)}`);
  }

  const position = Number(positionText);
  const deleteCount = Number(deleteCountText);
  if (
    !Number.isSafeInteger(position) ||
    !Number.isSafeInteger(deleteCount) ||
    position > actual.length ||
    deleteCount > actual.length - position
  ) {
    throw new Error(
      `${testName}: out-of-bounds edit ${JSON.stringify(edit)} for ${actual.length} bytes`,
    );
  }

  const insertion = Buffer.from(edit.slice(secondSpace + 1));
  actual = Buffer.concat([
    actual.subarray(0, position),
    insertion,
    actual.subarray(position + deleteCount),
  ]);
}

if (!actual.equals(expected)) {
  let difference = 0;
  while (
    difference < actual.length &&
    difference < expected.length &&
    actual[difference] === expected[difference]
  ) {
    difference += 1;
  }

  throw new Error(
    `${testName}: edits do not produce the final fixture; first difference at byte ${difference} ` +
      `(actual length ${actual.length}, expected length ${expected.length})`,
  );
}
