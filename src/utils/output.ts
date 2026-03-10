import * as vscode from "vscode";

export type LogLevel = "error" | "warn" | "info" | "debug" | "detail" | "silent";

interface LogOptions {
  level: LogLevel;
  indent: number;
}

/**
 * Smart logger for VSCode OutputChannel with:
 * - timestamps
 * - indentation
 * - log levels
 * - emoji-based "colors"
 * - debug toggle
 */
export class ColoredOutput {
  private channel: vscode.OutputChannel;
  private currentIndent = 0;
  private enabledDebug = true;
  private minLevel: LogLevel = "debug";

  // Map log levels to severity order
  private levelOrder: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    detail: 4,
    silent: 999,
  };

  // Emoji "colors"
  private levelEmoji: Record<LogLevel, string> = {
    error: "🔴",
    warn: "🟡",
    info: "🟢",
    debug: "🔵",
    detail: "⚪",
    silent: "",
  };

  constructor(channel: vscode.OutputChannel) {
    this.channel = channel;
  }

  //
  // ------------------------- CONFIGURAZIONE -------------------------
  //

  /**
   * Abilita o disabilita completamente il debug.
   */
  enableDebug(enable: boolean): void {
    this.enabledDebug = enable;
  }

  /**
   * Imposta il livello minimo visibile.
   * Esempio: setLevel("warn") → mostra solo warn + error.
   */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Modifica il livello di indentazione corrente.
   */
  indent(levels = 1): void {
    this.currentIndent += levels;
  }

  /**
   * Riduce l’indentazione.
   */
  outdent(levels = 1): void {
    this.currentIndent = Math.max(0, this.currentIndent - levels);
  }

  //
  // ------------------------- LOGGING CORE -------------------------
  //

  private shouldLog(level: LogLevel): boolean {
    if (level === "debug" && !this.enabledDebug) return false;
    return this.levelOrder[level] <= this.levelOrder[this.minLevel];
  }

  private timestamp(): string {
    const now = new Date();
    // return now.toISOString().split("T")[1].replace("Z", ""); // hh:mm:ss.sss
    return now.toLocaleTimeString();
  }

  private format(message: string, options: LogOptions): string {
    const emoji = this.levelEmoji[options.level];
    const indentSpaces = "  ".repeat(options.indent);
    return `${this.timestamp()} ${emoji} [${options.level.toUpperCase()}] ${indentSpaces}${message}`;
  }

  private write(level: LogLevel, message: string): void {
    if (!this.shouldLog(level)) return;

    const formatted = this.format(message, {
      level,
      indent: this.currentIndent,
    });

    this.channel.appendLine(formatted);
  }

  //
  // ------------------------- API PUBBLICA -------------------------
  //

  error(message: string): void {
    this.write("error", message);
  }

  warn(message: string): void {
    this.write("warn", message);
  }

  info(message: string): void {
    this.write("info", message);
  }

  debug(message: string): void {
    this.write("debug", message);
  }

  detail(message: string): void {
    this.write("detail", message);
  }

  heading(title: string): void {
    this.channel.appendLine(`\n=== ${title.toUpperCase()} ===`);
  }

  appendLine(message: string): void {
    this.channel.appendLine(message);
  }

  show(preserveFocus = false): void {
    this.channel.show(preserveFocus);
  }
}

/**
 * Factory per comodità.
 */
export function createColoredOutput(channel: vscode.OutputChannel): ColoredOutput {
  return new ColoredOutput(channel);
}