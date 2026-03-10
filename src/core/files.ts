import * as fsp from "fs/promises";
import * as path from "path";
import { Dirent } from "fs";
import { CalcDocsState } from "./state";

/**
 * Recursively lists files under root, skipping directories matched by callback.
 * Example: `(name) => name === "node_modules"` avoids scanning dependencies.
 */
export async function listFilesRecursive(
  root: string,
  isIgnoredDir: (absoluteDirPath: string, dirName: string) => boolean,
  state: CalcDocsState
): Promise<string[]> {
  const collectedFiles: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    let entries: Dirent[];

    try {
      entries = (await fsp.readdir(currentDir, {
        withFileTypes: true,
      })) as Dirent[];
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryName = String(entry.name);
      const absolutePath = path.join(currentDir, entryName);

      if (entry.isDirectory()) {
        if (!isIgnoredDir(absolutePath, entryName)) {
          // state.output.appendLine(`************** ${entryName} -- ${absolutePath}`);
          await walk(absolutePath);
        // } else {
        //   state.output.appendLine(`Ignorata ${entryName} -- ${absolutePath}`);
        }
        continue;
      }

      collectedFiles.push(absolutePath);
    }
  }

  await walk(root);
  return collectedFiles;
}

/**
 * Returns first formulas YAML candidate (formula*.yml|yaml) from file list.
 */
export function findFormulaYamlFile(files: string[]): string | undefined {
  return files.find((file) => {
    const basename = path.basename(file).toLowerCase();

    return (
      (basename.startsWith("formula") || basename.startsWith("formulas")) &&
      (basename.endsWith(".yaml") || basename.endsWith(".yml"))
    );
  });
}
