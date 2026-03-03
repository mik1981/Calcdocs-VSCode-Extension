/**
 * Removes inline C-style comments from expression strings.
 * Example: "A + 1 // note" -> "A + 1"
 */
export function stripComments(text: string): string {
  const withoutLineComments = text.split("//")[0];
  return withoutLineComments.replace(/\/\*.*?\*\//g, "").trim();
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