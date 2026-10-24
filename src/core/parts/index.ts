export * from "./types";
export * from "./geometry";
export { PART_LIBRARY } from "./library";
import { PART_LIBRARY } from "./library";
import type { PartTemplate } from "./types";

/** Look up a template by id. */
export function findPart(id: string): PartTemplate | undefined {
  return PART_LIBRARY.find((t) => t.id === id);
}
