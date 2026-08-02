import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type {
  AppStatus,
  AppUpdateInfo,
  DownloadEvent,
  DownloadRequest,
  EngineUpdateInfo,
  MediaInfo,
  RingtoneRequest,
  SearchResult,
  SearchSource,
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

const mockSearchResults: SearchResult[] = [
  {
    id: "mock-1",
    url: "https://example.com/video-1",
    title: "Videoclip oficial",
    uploader: "Canal creativo",
    duration: 248,
    thumbnail:
      "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=640&q=80",
    viewCount: 12_400_000,
    source: "youtube",
  },
  {
    id: "mock-2",
    url: "https://example.com/video-2",
    title: "Presentación en vivo (1994)",
    uploader: "Archivo musical",
    duration: 312,
    thumbnail:
      "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=640&q=80",
    viewCount: 830_000,
    source: "youtube",
  },
  {
    id: "mock-3",
    url: "https://example.com/video-3",
    title: "Mezcla extendida",
    uploader: null,
    duration: 512,
    thumbnail: null,
    viewCount: 45_000,
    source: "youtube",
  },
  {
    id: "mock-4",
    url: "https://example.com/video-4",
    title: "Entrevista completa",
    uploader: "Estudio independiente",
    duration: null,
    thumbnail:
      "https://images.unsplash.com/photo-1478737270239-2f02b77fc618?auto=format&fit=crop&w=640&q=80",
    viewCount: null,
    source: "youtube",
  },
];

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

export async function searchMedia(
  query: string,
  limit = 20,
  source: SearchSource = "youtube",
): Promise<SearchResult[]> {
  if (!runningInTauri) {
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    return mockSearchResults.map((result, index) => ({
      ...result,
      title: `${query} — ${result.title}`,
      source,
      id: `${source}-mock-${index + 1}`,
    }));
  }
  return invoke<SearchResult[]>("search_media", { query, limit, source });
}

export async function createRingtone(request: RingtoneRequest): Promise<string> {
  if (!runningInTauri) {
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    const extension = request.preset === "iphone" ? "m4r" : "mp3";
    return `${request.outputDir}\\Tonos\\Vista previa (tono ${Math.round(
      request.durationSeconds,
    )}s).${extension}`;
  }
  return invoke<string>("create_ringtone", { request });
}

export async function notifyUser(title: string, body: string): Promise<void> {
  try {
    if (!runningInTauri) {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body });
      }
      return;
    }
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (granted) {
      sendNotification({ title, body });
    }
  } catch {
    // Las notificaciones nunca deben romper el flujo de descarga.
  }
}

export async function checkAppUpdate(): Promise<AppUpdateInfo> {
  if (!runningInTauri) {
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    return {
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      updateAvailable: true,
      downloadUrl: "https://github.com/jpkken1979/JpkkenVideker/releases/latest",
    };
  }
  return invoke<AppUpdateInfo>("check_app_update");
}

export async function openExternal(url: string): Promise<void> {
  if (!runningInTauri) {
    window.open(url, "_blank", "noopener");
    return;
  }
  await openUrl(url);
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
