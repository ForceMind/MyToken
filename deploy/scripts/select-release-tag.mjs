#!/usr/bin/env node

let input = "";
for await (const chunk of process.stdin) input += chunk;

const releases = input.split(/\r?\n/u).flatMap((tag) => {
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:-preview\.(\d+))?$/u.exec(tag.trim());
  if (!match) return [];
  return [
    {
      tag: tag.trim(),
      parts: [
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
        match[4] ? Number(match[4]) : Number.MAX_SAFE_INTEGER,
      ],
    },
  ];
});

releases.sort((left, right) => {
  for (let index = 0; index < left.parts.length; index += 1) {
    const difference = (right.parts[index] ?? 0) - (left.parts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
});

if (releases[0]) process.stdout.write(releases[0].tag);
