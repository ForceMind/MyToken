import { copyFile } from "node:fs/promises";
import { URL } from "node:url";

await copyFile(
  new URL("../../../LICENSE", import.meta.url),
  new URL("../LICENSE", import.meta.url),
);
