import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatDuration,
  formatViewCount,
  qualityLabel,
  sourceLabel,
} from "./format";

describe("format helpers", () => {
  it("formats short and long durations", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3661)).toBe("1:01:01");
    expect(formatDuration(null)).toBe("—");
  });

  it("formats byte sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
  });

  it("formats view counts compactly in Spanish", () => {
    expect(formatViewCount(999)).toBe("999 visualizaciones");
    expect(formatViewCount(1_234_567)).toContain("M visualizaciones");
    expect(formatViewCount(null)).toBe("");
    expect(formatViewCount(-5)).toBe("");
  });

  it("creates friendly source and quality labels", () => {
    expect(sourceLabel("youtube")).toBe("YouTube");
    expect(sourceLabel("Dailymotion")).toBe("Dailymotion");
    expect(qualityLabel("1080", "video")).toBe("1080p");
  });
});
