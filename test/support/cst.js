import assert from "node:assert/strict";

function sourceEndPoint(source) {
  const bytes = Buffer.from(source);
  let row = 0;
  for (const byte of bytes) if (byte === 0x0a) row++;
  return `${row}:${bytes.length - bytes.lastIndexOf(0x0a) - 1}`;
}

function parseCst(stdout, source, status) {
  assert.ok(
    status === 0 || status === 1,
    `parser exited with status ${status}\n${stdout}`,
  );
  const tree = stdout
    .split("\n")
    .filter((line) => /^[0-9]+:[0-9]+ +- +/.test(line))
    .join("\n");
  const root = /^[0-9]+:[0-9]+ +- +([0-9]+:[0-9]+) +•?([^ \n]+)/.exec(tree);
  assert.ok(root, "parser produced no CST root");
  assert.equal(
    root[1],
    sourceEndPoint(source),
    "root must reach the edited source end",
  );
  if (status === 0) assert.equal(root[2], "program", tree);
  return tree;
}

export { parseCst, sourceEndPoint };
