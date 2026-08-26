#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { constants } from "node:fs";
import { open } from "node:fs/promises";

const [sourcePath, destinationPath, expectedUidText, maxBytesText] = process.argv.slice(2);
const expectedUid = Number(expectedUidText);
const maxBytes = Number(maxBytesText);

try {
  if (
    !sourcePath ||
    !destinationPath ||
    !Number.isSafeInteger(expectedUid) ||
    expectedUid < 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0
  ) {
    throw new Error("invalid_arguments");
  }
  const source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let data;
  try {
    const metadata = await source.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== expectedUid ||
      metadata.size <= 0 ||
      metadata.size > maxBytes ||
      metadata.nlink !== 1
    ) {
      throw new Error("invalid_source");
    }
    data = Buffer.alloc(metadata.size);
    let offset = 0;
    while (offset < data.byteLength) {
      const { bytesRead } = await source.read(data, offset, data.byteLength - offset, offset);
      if (bytesRead === 0) throw new Error("source_truncated");
      offset += bytesRead;
    }
    const afterRead = await source.stat();
    if (
      afterRead.size !== metadata.size ||
      afterRead.ctimeMs !== metadata.ctimeMs ||
      afterRead.mtimeMs !== metadata.mtimeMs ||
      data.byteLength > maxBytes
    ) {
      throw new Error("source_changed");
    }
  } finally {
    await source.close();
  }

  const destination = await open(
    destinationPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await destination.writeFile(data);
    await destination.sync();
  } finally {
    await destination.close();
  }
} catch {
  console.error("Codex credential copy validation failed");
  process.exitCode = 1;
}
