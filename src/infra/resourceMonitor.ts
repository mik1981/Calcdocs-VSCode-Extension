import * as vscode from "vscode";

import { ResourceStatusMode } from "../core/config";

export type ExtensionResourceSnapshot = {
  cpuPercent: number;
  memoryRssMb: number;
  shouldShowStatus: boolean;
};

type ResourceMonitorConfig = {
  mode: ResourceStatusMode;
  cpuThreshold: number;
};

/**
 * Periodically samples extension host CPU and memory usage.
 * CPU percentage is calculated using process CPU time delta over wall-clock delta.
 */
export class ExtensionResourceMonitor implements vscode.Disposable {
  private timer: NodeJS.Timeout | null = null;
  private lastCpuUsage = process.cpuUsage();
  private lastTimeNs = process.hrtime.bigint();
  private config: ResourceMonitorConfig;

  constructor(
    private readonly onSample: (snapshot: ExtensionResourceSnapshot) => void,
    config: ResourceMonitorConfig,
    private readonly sampleIntervalMs: number = 2000
  ) {
    this.config = {
      mode: config.mode,
      cpuThreshold: clampCpuThreshold(config.cpuThreshold),
    };
  }

  start(): void {
    if (this.timer) {
      return;
    }

    this.resetCpuBaseline();
    this.emitSample();

    this.timer = setInterval(() => {
      this.emitSample();
    }, this.sampleIntervalMs);
  }

  applyConfiguration(config: ResourceMonitorConfig): void {
    this.config = {
      mode: config.mode,
      cpuThreshold: clampCpuThreshold(config.cpuThreshold),
    };
    this.resetCpuBaseline();
    this.emitSample();
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private resetCpuBaseline(): void {
    this.lastCpuUsage = process.cpuUsage();
    this.lastTimeNs = process.hrtime.bigint();
  }

  private emitSample(): void {
    const currentCpuUsage = process.cpuUsage();
    const currentTimeNs = process.hrtime.bigint();
    const elapsedMicros = Number(currentTimeNs - this.lastTimeNs) / 1000;
    const cpuMicros =
      currentCpuUsage.user -
      this.lastCpuUsage.user +
      currentCpuUsage.system -
      this.lastCpuUsage.system;

    this.lastCpuUsage = currentCpuUsage;
    this.lastTimeNs = currentTimeNs;

    const rawCpuPercent = elapsedMicros > 0 ? (cpuMicros / elapsedMicros) * 100 : 0;
    const cpuPercent = Number.isFinite(rawCpuPercent)
      ? clamp(rawCpuPercent, 0, 100)
      : 0;

    const memoryRssMb = process.memoryUsage().rss / (1024 * 1024);
    const shouldShowStatus =
      this.config.mode === "always" || cpuPercent >= this.config.cpuThreshold;

    this.onSample({
      cpuPercent,
      memoryRssMb,
      shouldShowStatus,
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampCpuThreshold(value: number): number {
  if (!Number.isFinite(value)) {
    return 70;
  }

  return clamp(value, 0, 100);
}
