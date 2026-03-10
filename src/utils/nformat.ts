import { CalcDocsState } from "../core/state";
import { getConfig, getThousandsSeparatorChar } from "../core/config";

/**
 * Adds high dot (⋅) as thousands separator to all numbers in a string.
 * Example: "value is 1234567" → "value is 1⋅234⋅567"
 *
 * @param text - The input string containing numbers to format
 * @returns The string with all numbers formatted with thousands separators
 */
export function formatNumbersWithThousandsSeparator(state: CalcDocsState, text: string): string {
  // Get separator from config
  const config = getConfig();
  const separator = getThousandsSeparatorChar(config.thousandsSeparator);
  // Match numbers: integers, decimals, and numbers with scientific notation
  // Also matches negative numbers and numbers with C suffixes like ul, lu, ull, etc.
  const numberPattern =
    /[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][-+]?\d+)?\s*(?:ul|lu|ull|llu|u|l|ll|f)?/g;

  const ret = text.replace(numberPattern, (match) => {
    // Remove any existing spaces/suffixes from the number for processing
    const cleanNumber = match.trim();

    // Split into integer and decimal parts
    const parts = cleanNumber.split(".");
    let integerPart = parts[0];
    const decimalPart = parts[1];

    // Remove any existing commas for processing
    integerPart = integerPart.replace(/,/g, "");

    // Add thousands separator (high dot) to integer part
    // The negative lookahead (?!\d|\.) ensures we don't add separator before decimal point
    // Carattere 	Nome Unicode	Codice Unicode	Uso tipico
    // .	Full Stop	U+002E	Europa, Italia
    // ,	Comma	U+002C	USA, UK
    // ** **	Narrow No-Break Space	U+202F	Standard Scientifico
    // '	Apostrophe	U+0027	Svizzera
    const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d|\.))/g, separator);

    // Reconstruct the number with decimal part if present
    if (decimalPart !== undefined) {
      return `${formattedInteger}.${decimalPart}`;
    }

    return formattedInteger;
  });

  state.output.detail(`${text} → ${ret}`)
  return ret
}

