import * as fs from 'fs';
import * as path from 'path';


function findFormulaYamlFiles(root: string): string[] {
    const results: string[] = [];

    function walk(dir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const e of entries) {
            const full = path.join(dir, e.name);

            if (e.isDirectory()) {
                if (!isExcluded(full, { projectRoot: root, exclusions: [], compileFlags: [], pathMode: 'absolute' })) {
                    walk(full);
                }
            } else if (/formulas.*\.ya?ml$/.test(e.name)) {
                results.push(full);
            }
        }
    }

    walk(root);
    return results;
}

/**
 * Parser YAML super leggero (key: value)
 * Nota: assume struttura semplice come nel tuo caso
 */
function parseFormulaYaml(filePath: string): Record<string, string> {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    const result: Record<string, string> = {};

    let currentKey: string | null = null;

    for (const line of lines) {
        const match = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);

        if (match) {
            currentKey = match[1];
            const value = match[2]?.trim();

            if (value && !value.endsWith(':')) {
                result[currentKey] = value;
            }
        }
    }

    return result;
}

// -----------------------------------------------------------------------------
// TIPI PUBBLICI
// -----------------------------------------------------------------------------

/**
 * Configurazione per la generazione del file compile_commands.json
 * Questa interfaccia viene esportata e deve essere passata dall'esterno
 * quando la funzione viene chiamata dall'interno dell'estensione
 */
export interface Configuration {
    /** Percorso radice del progetto da analizzare */
    projectRoot: string;
    /** Modalità generazione percorsi: 'relative' | 'absolute' */
    pathMode: 'relative' | 'absolute';
    /** Lista di esclusioni (file o cartelle, relativi a projectRoot) */
    exclusions: string[];
    /** Flag generali di compilazione da aggiungere */
    compileFlags: string[];
}

/**
 * Struttura di una singola entry nel file compile_commands.json
 */
export interface CompileCommand {
    directory: string;
    command: string;
    file: string;
}

/**
 * Risultato della generazione
 */
export interface GenerationResult {
    commands: CompileCommand[];
    processedFiles: number;
    includeDirectories: number;
}

// -----------------------------------------------------------------------------
// FUNZIONI HELPER
// -----------------------------------------------------------------------------

/**
 * Normalizza e formatta il percorso secondo la modalità configurata
 */
function formatPath(relativePath: string, config: Configuration): string {
    let normalized = relativePath.replace(/\\/g, '/');

    if (config.pathMode === 'absolute') {
        normalized = path.resolve(config.projectRoot, normalized).replace(/\\/g, '/');
    }

    return normalized;
}

/**
 * Verifica se un percorso è presente nelle esclusioni
 */
function isExcluded(testPath: string, config: Configuration): boolean {
    const normalized = testPath.replace(/\\/g, '/');
    return config.exclusions.some(excl => normalized.startsWith(excl));
}

/**
 * Ricerca ricorsiva directory e applica filtri esclusione
 */
function* walkDirectory(rootDir: string, config: Configuration): IterableIterator<{ dir: string; files: string[] }> {
    const stack: string[] = [rootDir];

    while (stack.length > 0) {
        const currentDir = stack.pop()!;
        const relativeDir = path.relative(config.projectRoot, currentDir).replace(/\\/g, '/');

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch {
            continue; // skip directory non leggibile
        }

        const directories: string[] = [];
        const files: string[] = [];

        for (const entry of entries) {
            const entryPath = path.join(relativeDir, entry.name).replace(/\\/g, '/');

            if (entry.isDirectory()) {
                if (!isExcluded(entryPath, config)) {
                    directories.push(path.join(currentDir, entry.name));
                }
            } else {
                files.push(entry.name);
            }
        }

        yield { dir: relativeDir, files };

        // Aggiungi sotto cartelle in stack (ordine inverso per mantenere consistenza)
        stack.push(...directories.reverse());
    }
}

// -----------------------------------------------------------------------------
// FUNZIONE PRINCIPALE ESPORTATA
// -----------------------------------------------------------------------------

/**
 * Genera i comandi di compilazione per clangd a partire dalla configurazione fornita
 * Questa è la funzione pubblica che viene chiamata dall'interno dell'estensione VS Code
 * 
 * @param config Configurazione completa fornita dal chiamante
 * @returns Risultato della generazione con lista dei comandi e statistiche
 */
export function generateCompileCommands(config: Configuration): GenerationResult {
    const commands: CompileCommand[] = [];

    // -----------------------------------------------------------------
    // 1. Raccogli formule SOLO da YAML
    // -----------------------------------------------------------------
    const yamlFiles = findFormulaYamlFiles(config.projectRoot);

    const macroBlocks: string[] = [];
    const includeFlags = new Set<string>();

    for (const yamlFile of yamlFiles) {
        const formulas = parseFormulaYaml(yamlFile);

        const fileName = path.relative(config.projectRoot, yamlFile).replace(/\\/g, '/');

        macroBlocks.push(`// ----------------------------`);
        macroBlocks.push(`// FORMULAS FROM: ${fileName}`);
        macroBlocks.push(`// ----------------------------`);

        for (const [key, value] of Object.entries(formulas)) {
            // evita roba vuota o nonsense
            if (!key || !value) continue;

            macroBlocks.push(`#define ${key} (${value})`);
        }
    }

    // -----------------------------------------------------------------
    // 2. Raccogli file C (MA SENZA generare macro da loro)
    // -----------------------------------------------------------------
    const cFiles: string[] = [];

    for (const { dir, files } of walkDirectory(config.projectRoot, config)) {
        for (const file of files) {
            if (file.endsWith('.c')) {
                const relFile = path.join(dir, file).replace(/\\/g, '/');

                if (!isExcluded(relFile, config)) {
                    cFiles.push(formatPath(relFile, config));
                }
            }
        }
    }

    // -----------------------------------------------------------------
    // 3. Include dirs solo da header (come prima)
    // -----------------------------------------------------------------
    const includeDirsSet = new Set<string>();

    for (const { dir, files } of walkDirectory(config.projectRoot, config)) {
        if (files.some(f => f.endsWith('.h'))) {
            includeDirsSet.add(formatPath(dir, config));
        }
    }

    const includeDirs = Array.from(includeDirsSet).sort();

    const includeFlagsStr = includeDirs.map(inc => `-I${inc}`).join(' ');
    const baseFlags = config.compileFlags.join(' ');

    // -----------------------------------------------------------------
    // 4. Genera compile commands + inject macro-only system
    // -----------------------------------------------------------------
    const macroString = macroBlocks.join('\n');

    for (const file of cFiles) {
        commands.push({
            directory: formatPath(".", config),

            command: `clang -c ${includeFlagsStr} ${baseFlags} -D__FORMULA_MACROS__="${macroString.replace(/"/g, '\\"')}" ${file}`,

            file
        });
    }

    return {
        commands,
        processedFiles: commands.length,
        includeDirectories: includeDirs.length
    };
}

/**
 * Helper opzionale per scrivere il risultato su disco
 * @param result Risultato dalla generazione
 * @param outputPath Percorso completo dove salvare il file compile_commands.json
 */
export function writeCompileCommandsToFile(result: GenerationResult, outputPath: string): void {
    fs.writeFileSync(outputPath, JSON.stringify(result.commands, null, 2), 'utf8');
}

// -----------------------------------------------------------------------------
// BACKWARD COMPATIBILITY: Modalità CLI standalone
// -----------------------------------------------------------------------------

if (require.main === module) {
    // Se viene eseguito direttamente come script, mantieni il funzionamento originale
    const config: Configuration = {
        projectRoot: process.argv[2] ?? process.cwd(),
        pathMode: (process.argv[3] as 'relative' | 'absolute') ?? 'absolute',

        exclusions: [
            "Bitmap/_Old",
            "Drivers/STM32F0xx_HAL_Driver/Src/stm32f0xx_hal_old.c",
            "Tools",
            ".git",
            "build",
            "dist",
            "node_modules"
        ],

        compileFlags: [
            "-std=c99",
            "-DSTM32F0"
        ]
    };

    console.log(`🔍 Analisi progetto in: ${config.projectRoot}`);
    console.log(`📌 Modalità percorsi: ${config.pathMode}\n`);

    const result = generateCompileCommands(config);

    const outputPath = path.join(process.cwd(), 'compile_commands.json');
    writeCompileCommandsToFile(result, outputPath);

    console.log(`✅ compile_commands.json generato con successo!`);
    console.log(`   📄 File .c processati: ${result.processedFiles}`);
    console.log(`   📂 Directory include:  ${result.includeDirectories}`);
    console.log(`   📍 Percorso output:    ${outputPath}`);
}