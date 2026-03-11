/**
 * Removes inline C-style comments from expression strings.
 * Example: "A + 1 // note" -> "A + 1"
 */
export function stripComments(text: string): string {
  const withoutLineComments = text.split("//")[0];
  return withoutLineComments.replace(/\/\*.*?\*\//g, "").trim();
}

/**
 * Removes backslash line continuations from C/C++ source code.
 * In C, a backslash at the end of a line joins that line with the next.
 * Example: "#define A \\\n  1" -> "#define A   1"
 * 
 * @param text - Source text with potential line continuations
 * @returns Text with line continuations resolved
 */
export function stripLineContinuations(text: string): string {
  // Match backslash followed by newline (CRLF or LF)
  return text.replace(/\\\r?\n/g, "");
}

/**
 * Truncates long strings for UI safety.
 */
export function clampLen(text: string, max = 5000): string {
  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max)} ...`;
}

