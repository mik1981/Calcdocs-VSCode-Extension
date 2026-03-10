import { stripComments } from "./text";

/**
 * Updates brace depth counter while properly handling strings and comments.
 * Returns the new brace depth after processing the line.
 */
export function updateBraceDepth(currentDepth: number, line: string): number {
  const lineWithoutComments = stripComments(line);
  const trimmed = lineWithoutComments.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return currentDepth;
  }

  let depth = currentDepth;

  for (let i = 0; i < lineWithoutComments.length; i += 1) {
    const char = lineWithoutComments[i];

    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      i += 1;
      while (i < lineWithoutComments.length) {
        const current = lineWithoutComments[i];
        if (current === "\\") {
          i += 2;
          continue;
        }

        if (current === quote) {
          break;
        }

        i += 1;
      }

      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth = Math.max(0, depth - 1);
    }
  }

  return depth;
}

