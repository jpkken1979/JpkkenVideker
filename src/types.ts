export type View = "home" | "search" | "downloads" | "settings";
export type MediaKind = "video" | "audio";
export type DownloadStatus =
  | "queued"
  | "downloading"
  | "retrying"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface AppStatus {
  ytDlpReady: boolean;
  ytDlpVersion: string | null;
  ffmpegReady: boolean;
  ffmpegVersion: string | null;
  denoReady: boolean;
  denoVersion: string | null;
  engineSource: "bundled" | "updated";
  defaultDownloadDir: string;
}

export interface EngineUpdateInfo {
  currentVersion: string | null;
  latestVersion: string;
  updateAvailable: boolean;
  source: "bundled" | "updated";
}

export type SearchSource = "youtube" | "soundcloud" | "dailymotion";

export interface SearchResult {
  id: string;
  url: string;
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
  viewCount: number | null;
  source: string;
}

export type RingtonePreset = "iphone" | "android";

export interface AppUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  downloadUrl: string;
}

export interface RingtoneRequest {
  inputPath: string;
  outputDir: string;
  startSeconds: number;
  durationSeconds: number;
  preset: RingtonePreset;
  fade: boolean;
}

export interface MediaInfo {
  id: string;
  title: string;
  uploader: string;
  duration: number | null;
  thumbnail: string | null;
  extractor: string;
  webpageUrl: string;
  isPlaylist: boolean;
  playlistCount: number | null;
  resolutions: number[];
}

import type { Lang } from "./i18n";

export interface UserSettings {
  theme: "dark" | "light";
  language: Lang;
  downloadDir: string;
  kind: MediaKind;
  videoFormat: "mp4" | "mkv" | "webm";
  videoQuality: "best" | "2160" | "1440" | "1080" | "720" | "480";
  audioFormat: "mp3" | "m4a" | "opus";
  audioQuality: "best" | "320" | "256" | "192" | "128";
  subtitles: boolean;
  embedMetadata: boolean;
  embedThumbnail: boolean;
  includePlaylist: boolean;
  browserCookies: "none" | "chrome" | "edge" | "firefox" | "brave";
  concurrentFragments: number;
  compatibilityMode: boolean;
  useDeno: boolean;
  avoidDuplicates: boolean;
  autoUpdateEngine: boolean;
}

export interface DownloadRequest {
  jobId: string;
  url: string;
  title: string;
  outputDir: string;
  kind: MediaKind;
  format: string;
  quality: string;
  subtitles: boolean;
  embedMetadata: boolean;
  embedThumbnail: boolean;
  includePlaylist: boolean;
  browserCookies: string | null;
  concurrentFragments: number;
  compatibilityMode: boolean;
  useDeno: boolean;
  avoidDuplicates: boolean;
}

export interface DownloadItem {
  id: string;
  url: string;
  title: string;
  uploader: string;
  thumbnail: string | null;
  kind: MediaKind;
  format: string;
  quality: string;
  status: DownloadStatus;
  progress: number;
  speed: string;
  eta: string;
  filePath: string | null;
  error: string | null;
  errorCategory: string | null;
  suggestions: string[];
  technicalDetails: string | null;
  retryAttempt: number;
  request: DownloadRequest;
  createdAt: number;
}

export type DownloadEvent =
  | { event: "started"; data: { jobId: string } }
  | {
      event: "progress";
      data: {
        jobId: string;
        percent: number;
        speed: string;
        eta: string;
        downloadedBytes: number;
        totalBytes: number | null;
      };
    }
  | {
      event: "stage";
      data: { jobId: string; label: string };
    }
  | {
      event: "retrying";
      data: {
        jobId: string;
        attempt: number;
        maxAttempts: number;
        label: string;
      };
    }
  | {
      event: "completed";
      data: { jobId: string; filePath: string | null };
    }
  | {
      event: "failed";
      data: {
        jobId: string;
        message: string;
        category: string;
        suggestions: string[];
        technicalDetails: string;
      };
    }
  | { event: "cancelled"; data: { jobId: string } };
