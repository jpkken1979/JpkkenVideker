import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatDuration,
  formatViewCount,
  matchesDurationFilter,
  parseTimeInput,
  previewEmbedUrl,
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

  it("parses ringtone start times", () => {
    expect(parseTimeInput("90")).toBe(90);
    expect(parseTimeInput("1:30")).toBe(90);
    expect(parseTimeInput("1:02:05")).toBe(3725);
    expect(parseTimeInput("0:00")).toBe(0);
    expect(parseTimeInput("1:75")).toBeNull();
    expect(parseTimeInput("abc")).toBeNull();
    expect(parseTimeInput("")).toBeNull();
  });

  it("filters results by duration ranges", () => {
    expect(matchesDurationFilter(null, "all")).toBe(true);
    expect(matchesDurationFilter(null, "long")).toBe(false);
    expect(matchesDurationFilter(239, "short")).toBe(true);
    expect(matchesDurationFilter(240, "short")).toBe(false);
    expect(matchesDurationFilter(240, "medium")).toBe(true);
    expect(matchesDurationFilter(1800, "medium")).toBe(true);
    expect(matchesDurationFilter(1801, "medium")).toBe(false);
    expect(matchesDurationFilter(1801, "long")).toBe(true);
    expect(matchesDurationFilter(5400, "long")).toBe(true);
  });

  it("builds preview embed urls per source", () => {
    expect(previewEmbedUrl("youtube", "abc123", "https://youtube.com/watch?v=abc123")).toBe(
      "https://www.youtube-nocookie.com/embed/abc123?autoplay=1",
    );
    expect(previewEmbedUrl("dailymotion", "x9fkzy", "https://dailymotion.com/video/x9fkzy")).toBe(
      "https://www.dailymotion.com/embed/video/x9fkzy?autoplay=1",
    );
    expect(
      previewEmbedUrl("soundcloud", "track-1", "https://soundcloud.com/a/b"),
    ).toBe(
      "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fa%2Fb&auto_play=true",
    );
    expect(previewEmbedUrl("vimeo", "1", "https://vimeo.com/1")).toBeNull();
  });

  it("creates friendly source and quality labels", () => {
    expect(sourceLabel("youtube")).toBe("YouTube");
    expect(sourceLabel("Dailymotion")).toBe("Dailymotion");
    expect(qualityLabel("1080", "video")).toBe("1080p");
  });
});
