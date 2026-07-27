import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import type {
  AppStatus,
  DownloadEvent,
  DownloadRequest,
  EngineUpdateInfo,
  MediaInfo,
} from "../types";

const mockMedia: MediaInfo = {
  id: "preview",
  title: "Una historia para recordar",
  uploader: "Canal creativo",
  duration: 248,
  thumbnail:
    "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1200&q=85",
  extractor: "youtube",
  webpageUrl: "https://example.com/video",
  isPlaylist: false,
  playlistCount: null,
  resolutions: [2160, 1440, 1080, 720, 480],
};

export const runningInTauri = isTauri();

export async function getAppStatus(): Promise<AppStatus> {
  if (!runningInTauri) {
    return {
      ytDlpReady: true,
      ytDlpVersion: "modo diseño",
      ffmpegReady: true,
      ffmpegVersion: "modo diseño",
      denoReady: true,
      denoVersion: "modo diseño",
      engineSource: "bundled",
      defaultDownloadDir: "C:\\Usuarios\\Tú\\Descargas",
    };
  }
  return invoke<AppStatus>("get_app_status");
}

export async function analyzeUrl(
  url: string,
  includePlaylist: boolean,
  browserCookies: string | null,
  useDeno: boolean,
  compatibilityMode: boolean,
): Promise<MediaInfo> {
  if (!runningInTauri) {
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    return { ...mockMedia, webpageUrl: url };
  }
  return invoke<MediaInfo>("analyze_url", {
    url,
    includePlaylist,
    browserCookies,
    useDeno,
    compatibilityMode,
  });
}

export async function checkEngineUpdate(): Promise<EngineUpdateInfo> {
  if (!runningInTauri) {
    return {
      currentVersion: "modo diseño",
      latestVersion: "modo diseño",
      updateAvailable: false,
      source: "bundled",
    };
  }
  return invoke<EngineUpdateInfo>("check_engine_update");
}

export async function updateEngine(): Promise<EngineUpdateInfo> {
  if (!runningInTauri) {
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    return checkEngineUpdate();
  }
  return invoke<EngineUpdateInfo>("update_engine");
}

export async function beginDownload(
  request: DownloadRequest,
  onEvent: (event: DownloadEvent) => void,
): Promise<void> {
  if (!runningInTauri) {
    onEvent({ event: "started", data: { jobId: request.jobId } });
    for (let progress = 4; progress <= 100; progress += 4) {
      await new Promise((resolve) => window.setTimeout(resolve, 90));
      onEvent({
        event: "progress",
        data: {
          jobId: request.jobId,
          percent: progress,
          speed: "8.4 MiB/s",
          eta: progress < 100 ? `${Math.ceil((100 - progress) / 12)}s` : "0s",
          downloadedBytes: progress * 1_200_000,
          totalBytes: 120_000_000,
        },
      });
      if (progress === 48 && request.compatibilityMode) {
        onEvent({
          event: "retrying",
          data: {
            jobId: request.jobId,
            attempt: 2,
            maxAttempts: 3,
            label: "Ajustando la conexión automáticamente",
          },
        });
      }
    }
    onEvent({
      event: "completed",
      data: {
        jobId: request.jobId,
        filePath: `${request.outputDir}\\${request.title}.${request.format}`,
      },
    });
    return;
  }

  const onEventChannel = new Channel<DownloadEvent>();
  onEventChannel.onmessage = onEvent;
  await invoke("start_download", { request, onEvent: onEventChannel });
}

export async function cancelDownload(jobId: string): Promise<void> {
  if (!runningInTauri) return;
  return invoke("cancel_download", { jobId });
}

export async function chooseDirectory(defaultPath?: string): Promise<string | null> {
  if (!runningInTauri) return defaultPath || "C:\\Usuarios\\Tú\\Descargas";
  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath,
    title: "Elige dónde guardar tus archivos",
  });
  return typeof selected === "string" ? selected : null;
}

export async function revealDirectory(path: string): Promise<void> {
  if (!runningInTauri) return;
  await openPath(path);
}
