import * as vscode from "vscode"

/**
 * Returns identifier token under cursor.
 * Example: on "FLOW_RATE", returns "FLOW_RATE".
 */
export function pickWord(
  doc: vscode.TextDocument,
  pos: vscode.Position
): string | undefined {

  const range = doc.getWordRangeAtPosition(
    pos,
    /[A-Za-z_][A-Za-z0-9_]*/
  )

  if (!range) return

  return doc.getText(range)
}
