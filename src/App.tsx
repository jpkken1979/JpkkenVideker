import {
  AlertCircle,
  ArrowDownToLine,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleGauge,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FileAudio2,
  FileVideo2,
  Film,
  Folder,
  FolderOpen,
  Gauge,
  Headphones,
  History,
  Home,
  Info,
  Link2,
  LoaderCircle,
  Moon,
  MoreHorizontal,
  Music2,
  Play,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  Trash2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import logo from "./assets/logo.svg";
import {
  analyzeUrl,
  beginDownload,
  cancelDownload,
  checkEngineUpdate,
  chooseDirectory,
  getAppStatus,
  openExternal,
  revealDirectory,
  runningInTauri,
  searchMedia,
  updateEngine,
} from "./lib/bridge";
import {
  formatDuration,
  formatViewCount,
  matchesDurationFilter,
  previewEmbedUrl,
  qualityLabel,
  sourceLabel,
  type DurationFilter,
} from "./lib/format";
import type {
  AppStatus,
  DownloadEvent,
  DownloadItem,
  DownloadRequest,
  EngineUpdateInfo,
  MediaInfo,
  SearchResult,
  SearchSource,
  UserSettings,
  View,
} from "./types";

const SETTINGS_KEY = "jpkkenvideker.settings.v1";
const DOWNLOADS_KEY = "jpkkenvideker.downloads.v1";
const ENGINE_CHECK_KEY = "jpkkenvideker.engine-check.v1";
const SEARCH_HISTORY_KEY = "jpkkenvideker.search-history.v1";
const SEARCH_HISTORY_LIMIT = 8;
const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;

const defaultSettings: UserSettings = {
  theme: "dark",
  downloadDir: "",
  kind: "video",
  videoFormat: "mp4",
  videoQuality: "1080",
  audioFormat: "mp3",
  audioQuality: "320",
  subtitles: false,
  embedMetadata: true,
  embedThumbnail: true,
  includePlaylist: false,
  browserCookies: "none",
  concurrentFragments: 4,
  compatibilityMode: true,
  useDeno: true,
  avoidDuplicates: true,
  autoUpdateEngine: true,
};

function readStored<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function statusText(status: DownloadItem["status"]): string {
  const labels = {
    queued: "En cola",
    downloading: "Descargando",
    retrying: "Reparando conexión",
    processing: "Preparando archivo",
    completed: "Completado",
    failed: "No se pudo descargar",
    cancelled: "Cancelado",
  };
  return labels[status];
}

function App() {
  const [view, setView] = useState<View>("home");
  const [settings, setSettings] = useState<UserSettings>(() => ({
    ...defaultSettings,
    ...readStored<Partial<UserSettings>>(SETTINGS_KEY, {}),
  }));
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);
  const [downloads, setDownloads] = useState<DownloadItem[]>(() =>
    readStored<DownloadItem[]>(DOWNLOADS_KEY, []).map((item) => ({
      ...item,
      errorCategory: item.errorCategory ?? null,
      suggestions: item.suggestions ?? [],
      technicalDetails: item.technicalDetails ?? null,
      retryAttempt: item.retryAttempt ?? 0,
      request:
        item.request ??
        ({
          jobId: item.id,
          url: item.url,
          title: item.title,
          outputDir: "",
          kind: item.kind,
          format: item.format,
          quality: item.quality,
          subtitles: false,
          embedMetadata: true,
          embedThumbnail: true,
          includePlaylist: false,
          browserCookies: null,
          concurrentFragments: 4,
          compatibilityMode: true,
          useDeno: true,
          avoidDuplicates: true,
        } satisfies DownloadRequest),
    })),
  );
  const [url, setUrl] = useState("");
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchSource, setSearchSource] = useState<SearchSource>("youtube");
  const [searchPerformed, setSearchPerformed] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>(() =>
    readStored<string[]>(SEARCH_HISTORY_KEY, []),
  );
  const [notice, setNotice] = useState<{
    tone: "success" | "error" | "neutral";
    message: string;
  } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [engineUpdate, setEngineUpdate] =
    useState<EngineUpdateInfo | null>(null);
  const [updatingEngine, setUpdatingEngine] = useState(false);
  const noticeTimer = useRef<number | null>(null);

  const activeDownloads = downloads.filter(
    (item) =>
      item.status === "downloading" ||
      item.status === "retrying" ||
      item.status === "processing",
  ).length;
  const completedDownloads = downloads.filter(
    (item) => item.status === "completed",
  ).length;

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    window.localStorage.setItem(
      DOWNLOADS_KEY,
      JSON.stringify(downloads.slice(0, 80)),
    );
  }, [downloads]);

  useEffect(() => {
    window.localStorage.setItem(
      SEARCH_HISTORY_KEY,
      JSON.stringify(searchHistory.slice(0, SEARCH_HISTORY_LIMIT)),
    );
  }, [searchHistory]);

  useEffect(() => {
    void getAppStatus()
      .then((status) => {
        setAppStatus(status);
        setSettings((current) => ({
          ...current,
          downloadDir: current.downloadDir || status.defaultDownloadDir,
        }));
      })
      .catch((error) => {
        showNotice("error", String(error));
      });
  }, []);

  useEffect(() => {
    if (!runningInTauri || !settings.autoUpdateEngine) return;
    const lastCheck = Number(window.localStorage.getItem(ENGINE_CHECK_KEY) || 0);
    if (Date.now() - lastCheck < WEEK_IN_MS) return;
    window.localStorage.setItem(ENGINE_CHECK_KEY, String(Date.now()));
    setUpdatingEngine(true);
    void checkEngineUpdate()
      .then(async (info) => {
        setEngineUpdate(info);
        if (!info.updateAvailable) return;
        const updated = await updateEngine();
        setEngineUpdate(updated);
        setAppStatus(await getAppStatus());
        showNotice(
          "success",
          `Motor actualizado y verificado: yt-dlp ${updated.latestVersion}.`,
        );
      })
      .catch((error) => {
        showNotice("neutral", `Actualización automática pendiente: ${error}`);
      })
      .finally(() => setUpdatingEngine(false));
  }, []);

  function showNotice(
    tone: "success" | "error" | "neutral",
    message: string,
  ) {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice({ tone, message });
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4500);
  }

  function updateSettings(patch: Partial<UserSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      showNotice("neutral", "Usa Ctrl+V para pegar el enlace.");
    }
  }

  async function handleSearch(rawQuery?: string, source?: SearchSource) {
    const cleanQuery = (rawQuery ?? searchQuery).trim();
    if (!cleanQuery) {
      showNotice("error", "Escribe algo para buscar.");
      return;
    }
    if (appStatus && !appStatus.ytDlpReady) {
      showNotice("error", "Falta el motor yt-dlp. Reinstala JpkkenVideker o ejecuta npm run sidecars.");
      return;
    }
    setSearching(true);
    try {
      const results = await searchMedia(cleanQuery, 20, source ?? searchSource);
      setSearchResults(results);
      setSearchPerformed(true);
      setSearchHistory((current) =>
        [
          cleanQuery,
          ...current.filter(
            (item) => item.toLowerCase() !== cleanQuery.toLowerCase(),
          ),
        ].slice(0, SEARCH_HISTORY_LIMIT),
      );
    } catch (error) {
      showNotice("error", String(error));
    } finally {
      setSearching(false);
    }
  }

  function handlePickHistory(pickedQuery: string) {
    setSearchQuery(pickedQuery);
    void handleSearch(pickedQuery);
  }

  function handleSelectResult(resultUrl: string) {
    setUrl(resultUrl);
    setView("home");
    void handleAnalyze(resultUrl);
  }

  async function handleAnalyze(overrideUrl?: string) {
    const cleanUrl = (overrideUrl ?? url).trim();
    if (!isValidUrl(cleanUrl)) {
      if (cleanUrl && overrideUrl === undefined) {
        setSearchQuery(cleanUrl);
        setSearchResults([]);
        setSearchPerformed(false);
        setView("search");
        showNotice("neutral", "Eso no parece un enlace; buscándolo por ti.");
        void handleSearch(cleanUrl);
        return;
      }
      showNotice("error", "Pega un enlace válido que empiece por http o https.");
      return;
    }
    if (appStatus && !appStatus.ytDlpReady) {
      showNotice("error", "Falta el motor yt-dlp. Reinstala JpkkenVideker o ejecuta npm run sidecars.");
      return;
    }

    setAnalyzing(true);
    setMedia(null);
    try {
      const result = await analyzeUrl(
        cleanUrl,
        settings.includePlaylist,
        settings.browserCookies === "none" ? null : settings.browserCookies,
        settings.useDeno,
        settings.compatibilityMode,
      );
      setMedia(result);
      showNotice("success", "Enlace listo. Elige el formato y la calidad.");
    } catch (error) {
      showNotice("error", String(error));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleChooseDirectory() {
    const selected = await chooseDirectory(settings.downloadDir);
    if (selected) updateSettings({ downloadDir: selected });
  }

  function applyDownloadEvent(event: DownloadEvent) {
    setDownloads((current) =>
      current.map((item) => {
        if (item.id !== event.data.jobId) return item;
        switch (event.event) {
          case "started":
            return {
              ...item,
              status: "downloading",
              error: null,
              errorCategory: null,
              suggestions: [],
              technicalDetails: null,
            };
          case "progress":
            return {
              ...item,
              status: "downloading",
              progress: Math.min(100, Math.max(0, event.data.percent)),
              speed: event.data.speed,
              eta: event.data.eta,
            };
          case "stage":
            return {
              ...item,
              status: "processing",
              progress: Math.max(96, item.progress),
            };
          case "retrying":
            return {
              ...item,
              status: "retrying",
              speed: event.data.label,
              eta: "",
              retryAttempt: event.data.attempt,
            };
          case "completed":
            return {
              ...item,
              status: "completed",
              progress: 100,
              speed: "",
              eta: "",
              filePath: event.data.filePath,
            };
          case "failed":
            return {
              ...item,
              status: "failed",
              error: event.data.message,
              errorCategory: event.data.category,
              suggestions: event.data.suggestions,
              technicalDetails: event.data.technicalDetails,
              speed: "",
              eta: "",
            };
          case "cancelled":
            return { ...item, status: "cancelled", speed: "", eta: "" };
        }
      }),
    );
  }

  async function enqueueDownload(
    info: {
      url: string;
      title: string;
      uploader: string | null;
      thumbnail: string | null;
    },
    noticeMessage = "Descarga añadida a la cola.",
  ) {
    if (!settings.downloadDir) {
      showNotice("error", "Elige primero una carpeta de destino.");
      return;
    }
    const id = crypto.randomUUID();
    const format =
      settings.kind === "video"
        ? settings.videoFormat
        : settings.audioFormat;
    const quality =
      settings.kind === "video"
        ? settings.videoQuality
        : settings.audioQuality;
    const request: DownloadRequest = {
      jobId: id,
      url: info.url,
      title: info.title,
      outputDir: settings.downloadDir,
      kind: settings.kind,
      format,
      quality,
      subtitles: settings.subtitles,
      embedMetadata: settings.embedMetadata,
      embedThumbnail: settings.embedThumbnail,
      includePlaylist: settings.includePlaylist,
      browserCookies:
        settings.browserCookies === "none" ? null : settings.browserCookies,
      concurrentFragments: settings.concurrentFragments,
      compatibilityMode: settings.compatibilityMode,
      useDeno: settings.useDeno,
      avoidDuplicates: settings.avoidDuplicates,
    };
    const item: DownloadItem = {
      id,
      url: info.url,
      title: info.title,
      uploader: info.uploader || "Autor desconocido",
      thumbnail: info.thumbnail,
      kind: settings.kind,
      format,
      quality,
      status: "queued",
      progress: 0,
      speed: "",
      eta: "",
      filePath: null,
      error: null,
      errorCategory: null,
      suggestions: [],
      technicalDetails: null,
      retryAttempt: 0,
      request,
      createdAt: Date.now(),
    };

    setDownloads((current) => [item, ...current]);
    setView("downloads");
    showNotice("neutral", noticeMessage);
    try {
      await beginDownload(request, applyDownloadEvent);
    } catch (error) {
      applyDownloadEvent({
        event: "failed",
        data: {
          jobId: id,
          message: "No se pudo iniciar el motor de descarga.",
          category: "startup",
          suggestions: [
            "Comprueba los componentes desde Ajustes.",
            "Copia el diagnóstico técnico si el problema continúa.",
          ],
          technicalDetails: String(error),
        },
      });
      showNotice("error", "La descarga terminó con un error.");
    }
  }

  async function handleDownload() {
    if (!media) return;
    await enqueueDownload({
      url: media.webpageUrl || url,
      title: media.title,
      uploader: media.uploader,
      thumbnail: media.thumbnail,
    });
  }

  async function handleQuickDownload(result: SearchResult) {
    if (!settings.downloadDir) {
      showNotice("error", "Elige primero una carpeta de destino en Ajustes.");
      setView("settings");
      return;
    }
    const format =
      settings.kind === "video" ? settings.videoFormat : settings.audioFormat;
    const quality =
      settings.kind === "video" ? settings.videoQuality : settings.audioQuality;
    await enqueueDownload(
      {
        url: result.url,
        title: result.title,
        uploader: result.uploader,
        thumbnail: result.thumbnail,
      },
      `Descarga rápida añadida (${format.toUpperCase()} · ${qualityLabel(
        quality,
        settings.kind,
      )}).`,
    );
  }

  async function handleCancel(id: string) {
    try {
      await cancelDownload(id);
      applyDownloadEvent({ event: "cancelled", data: { jobId: id } });
    } catch (error) {
      showNotice("error", String(error));
    }
  }

  async function repairDownload(item: DownloadItem) {
    const id = crypto.randomUUID();
    const request: DownloadRequest = {
      ...item.request,
      jobId: id,
      url: item.url,
      title: item.title,
      outputDir: item.request.outputDir || settings.downloadDir,
      compatibilityMode: true,
      useDeno: true,
      concurrentFragments: 1,
    };
    if (!request.outputDir) {
      showNotice("error", "Elige una carpeta de destino antes de reparar.");
      setView("settings");
      return;
    }
    const repaired: DownloadItem = {
      ...item,
      id,
      status: "queued",
      progress: 0,
      speed: "",
      eta: "",
      filePath: null,
      error: null,
      errorCategory: null,
      suggestions: [],
      technicalDetails: null,
      retryAttempt: 0,
      request,
      createdAt: Date.now(),
    };
    setDownloads((current) => [repaired, ...current]);
    showNotice(
      "neutral",
      "Reparación iniciada con una conexión más conservadora.",
    );
    try {
      await beginDownload(request, applyDownloadEvent);
    } catch (error) {
      applyDownloadEvent({
        event: "failed",
        data: {
          jobId: id,
          message: "No se pudo iniciar la reparación.",
          category: "startup",
          suggestions: ["Comprueba los componentes desde Ajustes."],
          technicalDetails: String(error),
        },
      });
    }
  }

  async function handleEngineUpdate() {
    setUpdatingEngine(true);
    try {
      const available = await checkEngineUpdate();
      setEngineUpdate(available);
      if (!available.updateAvailable) {
        showNotice(
          "success",
          `El motor ya está al día (${available.latestVersion}).`,
        );
        return;
      }
      const updated = await updateEngine();
      setEngineUpdate(updated);
      setAppStatus(await getAppStatus());
      window.localStorage.setItem(ENGINE_CHECK_KEY, String(Date.now()));
      showNotice(
        "success",
        `Motor actualizado y verificado: yt-dlp ${updated.latestVersion}.`,
      );
    } catch (error) {
      showNotice("error", String(error));
    } finally {
      setUpdatingEngine(false);
    }
  }

  function clearFinished() {
    setDownloads((current) =>
      current.filter(
        (item) =>
          item.status === "downloading" ||
          item.status === "retrying" ||
          item.status === "processing" ||
          item.status === "queued",
      ),
    );
  }

  const navItems = [
    { id: "home" as const, label: "Inicio", icon: Home },
    { id: "search" as const, label: "Buscar", icon: Search },
    {
      id: "downloads" as const,
      label: "Descargas",
      icon: ArrowDownToLine,
      badge: activeDownloads || undefined,
    },
    { id: "settings" as const, label: "Ajustes", icon: Settings },
  ];

  return (
    <div className="app-shell">
      <button
        className="mobile-menu"
        onClick={() => setSidebarOpen((value) => !value)}
        aria-label={sidebarOpen ? "Cerrar navegación" : "Abrir navegación"}
        aria-expanded={sidebarOpen}
        aria-controls="primary-sidebar"
      >
        <MoreHorizontal size={20} />
      </button>

      <aside
        id="primary-sidebar"
        className={`sidebar ${sidebarOpen ? "is-open" : ""}`}
      >
        <div className="brand">
          <img src={logo} alt="" />
          <div>
            <strong>JpkkenVideker</strong>
            <span>media, a tu manera</span>
          </div>
        </div>

        <nav aria-label="Navegación principal">
          <p className="eyebrow nav-label">TU ESPACIO</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${view === item.id ? "active" : ""}`}
                aria-current={view === item.id ? "page" : undefined}
                onClick={() => {
                  setView(item.id);
                  setSidebarOpen(false);
                }}
              >
                <Icon size={19} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.badge ? <b>{item.badge}</b> : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />

        <div className="engine-card">
          <div className="engine-card-title">
            <span
              className={`status-dot ${
                appStatus?.ytDlpReady && appStatus?.ffmpegReady ? "ready" : ""
              }`}
            />
            <strong>Motor de JpkkenVideker</strong>
          </div>
          <p>
            {appStatus
              ? appStatus.ytDlpReady && appStatus.ffmpegReady
                ? "Listo para descargar"
                : "Requiere atención"
              : "Comprobando componentes…"}
          </p>
          {appStatus?.ytDlpVersion ? (
            <span className="engine-version">yt-dlp {appStatus.ytDlpVersion}</span>
          ) : null}
        </div>

        <div className="legal-note">
          <ShieldCheck size={16} />
          <p>Descarga solo contenido propio o que tengas permiso para guardar.</p>
        </div>
      </aside>

      <main className="main-content">
        {view === "home" && (
          <HomeView
            url={url}
            setUrl={setUrl}
            media={media}
            analyzing={analyzing}
            settings={settings}
            setSettings={updateSettings}
            appStatus={appStatus}
            onPaste={handlePaste}
            onAnalyze={() => void handleAnalyze()}
            onChooseDirectory={handleChooseDirectory}
            onDownload={handleDownload}
            completedDownloads={completedDownloads}
          />
        )}
        {view === "search" && (
          <SearchView
            query={searchQuery}
            setQuery={setSearchQuery}
            results={searchResults}
            searching={searching}
            source={searchSource}
            setSource={(source) => {
              setSearchSource(source);
              if (searchQuery.trim() && searchPerformed) {
                void handleSearch(undefined, source);
              }
            }}
            searchPerformed={searchPerformed}
            history={searchHistory}
            onPickHistory={handlePickHistory}
            onClearHistory={() => setSearchHistory([])}
            onSearch={() => void handleSearch()}
            onSelectResult={handleSelectResult}
            onQuickDownload={(result) => void handleQuickDownload(result)}
            onOpenExternal={(resultUrl) => void openExternal(resultUrl)}
          />
        )}
        {view === "downloads" && (
          <DownloadsView
            downloads={downloads}
            downloadDir={settings.downloadDir}
            onCancel={handleCancel}
            onRepair={(item) => void repairDownload(item)}
            onReveal={(path) => void revealDirectory(path)}
            onClear={clearFinished}
            onGoHome={() => setView("home")}
          />
        )}
        {view === "settings" && (
          <SettingsView
            settings={settings}
            appStatus={appStatus}
            setSettings={updateSettings}
            onChooseDirectory={handleChooseDirectory}
            onRefreshStatus={() =>
              void getAppStatus().then((status) => setAppStatus(status))
            }
            engineUpdate={engineUpdate}
            updatingEngine={updatingEngine}
            onUpdateEngine={() => void handleEngineUpdate()}
          />
        )}
      </main>

      {notice && (
        <div
          className={`toast ${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
          aria-live={notice.tone === "error" ? "assertive" : "polite"}
        >
          {notice.tone === "success" ? (
            <CheckCircle2 size={18} />
          ) : notice.tone === "error" ? (
            <AlertCircle size={18} />
          ) : (
            <Info size={18} />
          )}
          <span>{notice.message}</span>
          <button onClick={() => setNotice(null)} aria-label="Cerrar aviso">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

interface HomeViewProps {
  url: string;
  setUrl: (value: string) => void;
  media: MediaInfo | null;
  analyzing: boolean;
  settings: UserSettings;
  setSettings: (patch: Partial<UserSettings>) => void;
  appStatus: AppStatus | null;
  onPaste: () => void;
  onAnalyze: () => void;
  onChooseDirectory: () => void;
  onDownload: () => void;
  completedDownloads: number;
}

function HomeView({
  url,
  setUrl,
  media,
  analyzing,
  settings,
  setSettings,
  appStatus,
  onPaste,
  onAnalyze,
  onChooseDirectory,
  onDownload,
  completedDownloads,
}: HomeViewProps) {
  return (
    <div className="page home-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">DESCARGAS SIN RUIDO</p>
          <h1>
            Guarda lo que <span>te importa.</span>
          </h1>
          <p className="header-copy">
            Vídeo, música y playlists de más de mil sitios compatibles, con el
            formato exacto que necesitas.
          </p>
        </div>
        <div className="header-stats">
          <div>
            <span className="stat-icon">
              <Check size={16} />
            </span>
            <p>
              <strong>{completedDownloads}</strong>
              <span>guardados</span>
            </p>
          </div>
          <div>
            <span className="stat-icon purple">
              <Zap size={16} />
            </span>
            <p>
              <strong>1000+</strong>
              <span>sitios</span>
            </p>
          </div>
        </div>
      </header>

      <section className="capture-card">
        <div className="capture-topline">
          <div>
            <span className="capture-icon">
              <Link2 size={19} />
            </span>
            <div>
              <h2>Pega un enlace</h2>
              <p>YouTube, Dailymotion, Vimeo, TikTok, SoundCloud y más</p>
            </div>
          </div>
          <span className="privacy-pill">
            <ShieldCheck size={14} />
            Procesado en tu equipo
          </span>
        </div>

        <div className={`url-field ${analyzing ? "loading" : ""}`}>
          <Link2 size={20} />
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onAnalyze();
            }}
            placeholder="https://www.youtube.com/watch?v=…"
            aria-label="Enlace del vídeo o audio"
            spellCheck={false}
          />
          {url ? (
            <button
              className="icon-button subtle"
              onClick={() => setUrl("")}
              aria-label="Borrar enlace"
            >
              <X size={17} />
            </button>
          ) : (
            <button className="paste-button" onClick={onPaste}>
              Pegar
            </button>
          )}
          <button
            className="primary-button analyze-button"
            onClick={onAnalyze}
            disabled={analyzing}
          >
            {analyzing ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <Sparkles size={18} />
            )}
            {analyzing ? "Analizando…" : "Analizar"}
          </button>
        </div>

        <label className="inline-check">
          <input
            type="checkbox"
            checked={settings.includePlaylist}
            onChange={(event) =>
              setSettings({ includePlaylist: event.target.checked })
            }
          />
          <span>
            <Check size={12} />
          </span>
          Incluir la playlist completa si el enlace pertenece a una
        </label>
      </section>

      {analyzing && <AnalysisSkeleton />}

      {media && !analyzing ? (
        <section className="download-workspace">
          <MediaPreview media={media} />
          <DownloadOptions
            settings={settings}
            setSettings={setSettings}
            appStatus={appStatus}
            media={media}
            onChooseDirectory={onChooseDirectory}
            onDownload={onDownload}
          />
        </section>
      ) : null}

      {!media && !analyzing ? (
        <section className="feature-strip" aria-label="Características">
          <div>
            <span>
              <Film size={19} />
            </span>
            <p>
              <strong>Calidad a tu medida</strong>
              <small>De 480p a 4K, cuando esté disponible</small>
            </p>
          </div>
          <div>
            <span>
              <Headphones size={19} />
            </span>
            <p>
              <strong>Audio limpio</strong>
              <small>MP3, M4A u Opus con carátula</small>
            </p>
          </div>
          <div>
            <span>
              <Gauge size={19} />
            </span>
            <p>
              <strong>Rápido y privado</strong>
              <small>Sin subidas ni servidores intermedios</small>
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}

interface SearchViewProps {
  query: string;
  setQuery: (value: string) => void;
  results: SearchResult[];
  searching: boolean;
  source: SearchSource;
  setSource: (source: SearchSource) => void;
  searchPerformed: boolean;
  history: string[];
  onPickHistory: (query: string) => void;
  onClearHistory: () => void;
  onSearch: () => void;
  onSelectResult: (url: string) => void;
  onQuickDownload: (result: SearchResult) => void;
  onOpenExternal: (url: string) => void;
}

const durationFilters: { id: DurationFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "short", label: "Cortos" },
  { id: "medium", label: "Medios" },
  { id: "long", label: "Largos (+30 min)" },
];

const searchSources: { id: SearchSource; label: string }[] = [
  { id: "youtube", label: "YouTube" },
  { id: "soundcloud", label: "SoundCloud" },
  { id: "dailymotion", label: "Dailymotion" },
];

function SearchView({
  query,
  setQuery,
  results,
  searching,
  source,
  setSource,
  searchPerformed,
  history,
  onPickHistory,
  onClearHistory,
  onSearch,
  onSelectResult,
  onQuickDownload,
  onOpenExternal,
}: SearchViewProps) {
  const [preview, setPreview] = useState<SearchResult | null>(null);
  const [durationFilter, setDurationFilter] = useState<DurationFilter>("all");

  const visibleResults = useMemo(
    () =>
      results.filter((result) =>
        matchesDurationFilter(result.duration, durationFilter),
      ),
    [results, durationFilter],
  );
  const hiddenCount = results.length - visibleResults.length;

  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [preview]);

  const previewSrc = preview
    ? previewEmbedUrl(preview.source, preview.id, preview.url)
    : null;

  return (
    <div className="page search-page">
      <header className="section-header">
        <div>
          <p className="eyebrow">ENCUENTRA SIN SALIR</p>
          <h1>Buscar</h1>
          <p>
            Escribe un artista, canción o vídeo y descárgalo sin abrir el
            navegador.
          </p>
        </div>
      </header>

      <section className="capture-card">
        <div className={`url-field ${searching ? "loading" : ""}`}>
          <Search size={20} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSearch();
            }}
            placeholder="Ej. Ice MC — Think About The Way"
            aria-label="Qué quieres buscar"
            spellCheck={false}
          />
          {query ? (
            <button
              className="icon-button subtle"
              onClick={() => setQuery("")}
              aria-label="Borrar búsqueda"
            >
              <X size={17} />
            </button>
          ) : null}
          <button
            className="primary-button analyze-button"
            onClick={onSearch}
            disabled={searching}
          >
            {searching ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <Search size={18} />
            )}
            {searching ? "Buscando…" : "Buscar"}
          </button>
        </div>

        <div
          className="segmented-control search-sources"
          role="group"
          aria-label="Fuente de búsqueda"
        >
          {searchSources.map((item) => (
            <button
              key={item.id}
              className={source === item.id ? "active" : ""}
              aria-pressed={source === item.id}
              onClick={() => setSource(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {searching && <SearchSkeleton />}

      {!searching && results.length > 0 && (
        <>
          <div className="search-toolbar">
            <div className="filter-tabs">
              {durationFilters.map((item) => (
                <button
                  key={item.id}
                  className={durationFilter === item.id ? "active" : ""}
                  onClick={() => setDurationFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {hiddenCount > 0 && (
              <p className="filter-hint">
                {hiddenCount === 1
                  ? "1 resultado oculto por el filtro"
                  : `${hiddenCount} resultados ocultos por el filtro`}
              </p>
            )}
          </div>
          <div className="download-list search-results">
          {visibleResults.map((result) => (
            <article className="download-row result-row" key={result.id}>
              <div className="download-thumb">
                {result.thumbnail ? (
                  <img
                    src={result.thumbnail}
                    alt={`Miniatura de ${result.title}`}
                    loading="lazy"
                  />
                ) : (
                  <Film size={26} />
                )}
              </div>
              <div className="download-main">
                <div className="download-title-line">
                  <div>
                    <h3>{result.title}</h3>
                    <p>{result.uploader || "Autor desconocido"}</p>
                  </div>
                </div>
                <div className="result-meta">
                  <span>
                    <Clock3 size={14} />
                    {formatDuration(result.duration)}
                  </span>
                  {formatViewCount(result.viewCount) ? (
                    <span>{formatViewCount(result.viewCount)}</span>
                  ) : null}
                  <span>{sourceLabel(result.source)}</span>
                </div>
              </div>
              <div className="row-actions">
                <button
                  className="icon-button preview-trigger"
                  onClick={() => setPreview(result)}
                  aria-label={`Vista previa de ${result.title}`}
                  title="Vista previa"
                >
                  <Play size={17} />
                </button>
                <button
                  className="primary-button result-download"
                  onClick={() => onSelectResult(result.url)}
                >
                  <Download size={16} />
                  Descargar
                </button>
                <button
                  className="icon-button quick-download"
                  onClick={() => onQuickDownload(result)}
                  aria-label={`Descarga rápida de ${result.title}`}
                  title="Descarga rápida con tus ajustes"
                >
                  <Zap size={17} />
                </button>
                <button
                  className="icon-button"
                  onClick={() => onOpenExternal(result.url)}
                  aria-label={`Abrir ${result.title} en el navegador`}
                  title="Abrir en el navegador"
                >
                  <ExternalLink size={17} />
                </button>
              </div>
            </article>
          ))}
          {!visibleResults.length && (
            <div className="no-results">
              <Search size={24} />
              <p>El filtro de duración ocultó todos los resultados.</p>
              <button
                className="text-button"
                onClick={() => setDurationFilter("all")}
              >
                Mostrar todos
              </button>
            </div>
          )}
          </div>
        </>
      )}

      {!searching && searchPerformed && !results.length && (
        <div className="no-results">
          <Search size={24} />
          <p>No encontramos nada con ese texto. Prueba con otras palabras.</p>
        </div>
      )}

      {!searching && !searchPerformed && !results.length && (
        <div className="empty-state">
          <div className="empty-illustration">
            <div className="empty-orbit orbit-one" />
            <div className="empty-orbit orbit-two" />
            <span>
              <Search size={36} />
            </span>
          </div>
          <h2>Encuentra música y vídeos</h2>
          <p>
            Busca en YouTube, SoundCloud o Dailymotion y descarga el resultado
            con un clic.
          </p>
          {history.length > 0 && (
            <div className="search-history">
              <p className="eyebrow">BÚSQUEDAS RECIENTES</p>
              <div className="history-chips">
                {history.map((item) => (
                  <button
                    key={item}
                    className="history-chip"
                    onClick={() => onPickHistory(item)}
                  >
                    <History size={13} />
                    {item}
                  </button>
                ))}
              </div>
              <button className="text-button" onClick={onClearHistory}>
                Borrar historial
              </button>
            </div>
          )}
        </div>
      )}

      {preview && (
        <div
          className="preview-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Vista previa de ${preview.title}`}
          onClick={() => setPreview(null)}
        >
          <div
            className="preview-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="preview-header">
              <div>
                <p className="eyebrow">VISTA PREVIA</p>
                <h3>{preview.title}</h3>
              </div>
              <button
                className="icon-button subtle"
                onClick={() => setPreview(null)}
                aria-label="Cerrar vista previa"
              >
                <X size={18} />
              </button>
            </header>
            {previewSrc ? (
              <div className="preview-frame">
                <iframe
                  src={previewSrc}
                  title={`Reproductor de ${preview.title}`}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className="preview-unavailable">
                <Info size={20} />
                <p>
                  Esta fuente no permite vista previa integrada. Ábrela en el
                  navegador para comprobar el contenido.
                </p>
              </div>
            )}
            <footer className="preview-footer">
              <button
                className="primary-button"
                onClick={() => {
                  const selected = preview.url;
                  setPreview(null);
                  onSelectResult(selected);
                }}
              >
                <Download size={16} />
                Sí, descargar este
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  const selected = preview;
                  setPreview(null);
                  onQuickDownload(selected);
                }}
              >
                <Zap size={16} />
                Descarga rápida
              </button>
              <button
                className="secondary-button"
                onClick={() => onOpenExternal(preview.url)}
              >
                <ExternalLink size={16} />
                Abrir en el navegador
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="download-list search-results" aria-label="Buscando">
      {[1, 2, 3].map((row) => (
        <div className="download-row search-skeleton-row" key={row}>
          <div className="skeleton search-thumb-skeleton" />
          <div className="skeleton-copy">
            <div className="skeleton line" />
            <div className="skeleton line short" />
          </div>
        </div>
      ))}
    </div>
  );
}

function AnalysisSkeleton() {
  return (
    <section className="analysis-skeleton" aria-label="Analizando enlace">
      <div className="skeleton thumbnail-skeleton" />
      <div className="skeleton-copy">
        <div className="skeleton line short" />
        <div className="skeleton line" />
        <div className="skeleton line medium" />
        <p>
          <LoaderCircle className="spin" size={16} />
          Consultando formatos y calidades disponibles…
        </p>
      </div>
    </section>
  );
}

function MediaPreview({ media }: { media: MediaInfo }) {
  return (
    <article className="media-preview">
      <div className="media-art">
        {media.thumbnail ? (
          <img src={media.thumbnail} alt={`Miniatura de ${media.title}`} />
        ) : (
          <div className="media-art-placeholder">
            <Film size={42} />
          </div>
        )}
        <span className="duration-badge">{formatDuration(media.duration)}</span>
        <span className="source-badge">{sourceLabel(media.extractor)}</span>
      </div>
      <div className="media-copy">
        <p className="eyebrow">
          {media.isPlaylist
            ? `${media.playlistCount ?? "Varias"} piezas`
            : "ENLACE LISTO"}
        </p>
        <h2>{media.title}</h2>
        <p className="media-uploader">{media.uploader || "Autor desconocido"}</p>
        <div className="media-meta">
          <span>
            <Clock3 size={15} />
            {formatDuration(media.duration)}
          </span>
          <span>
            <CircleGauge size={15} />
            {media.resolutions.length
              ? `Hasta ${Math.max(...media.resolutions)}p`
              : "Calidad automática"}
          </span>
        </div>
      </div>
    </article>
  );
}

interface DownloadOptionsProps {
  settings: UserSettings;
  setSettings: (patch: Partial<UserSettings>) => void;
  appStatus: AppStatus | null;
  media: MediaInfo;
  onChooseDirectory: () => void;
  onDownload: () => void;
}

function DownloadOptions({
  settings,
  setSettings,
  appStatus,
  media,
  onChooseDirectory,
  onDownload,
}: DownloadOptionsProps) {
  const qualities =
    settings.kind === "video"
      ? [
          { value: "best", label: "Máxima" },
          ...["2160", "1440", "1080", "720", "480"]
            .filter(
              (quality) =>
                !media.resolutions.length ||
                media.resolutions.some((value) => value >= Number(quality)),
            )
            .map((value) => ({ value, label: `${value}p` })),
        ]
      : ["best", "320", "256", "192", "128"].map((value) => ({
          value,
          label: value === "best" ? "Máxima" : `${value} kbps`,
        }));

  return (
    <article className="options-panel">
      <div
        className="segmented-control"
        role="group"
        aria-label="Tipo de descarga"
      >
        <button
          className={settings.kind === "video" ? "active" : ""}
          aria-pressed={settings.kind === "video"}
          onClick={() => setSettings({ kind: "video" })}
        >
          <FileVideo2 size={17} />
          Vídeo
        </button>
        <button
          className={settings.kind === "audio" ? "active" : ""}
          aria-pressed={settings.kind === "audio"}
          onClick={() => setSettings({ kind: "audio" })}
        >
          <FileAudio2 size={17} />
          Solo audio
        </button>
      </div>

      <div className="option-grid">
        <label>
          <span>Calidad</span>
          <div className="select-shell">
            <select
              aria-label="Calidad de descarga"
              value={
                settings.kind === "video"
                  ? settings.videoQuality
                  : settings.audioQuality
              }
              onChange={(event) =>
                settings.kind === "video"
                  ? setSettings({
                      videoQuality: event.target
                        .value as UserSettings["videoQuality"],
                    })
                  : setSettings({
                      audioQuality: event.target
                        .value as UserSettings["audioQuality"],
                    })
              }
            >
              {qualities.map((quality) => (
                <option key={quality.value} value={quality.value}>
                  {quality.label}
                </option>
              ))}
            </select>
            <ChevronDown size={16} />
          </div>
        </label>
        <label>
          <span>Formato</span>
          <div className="select-shell">
            <select
              aria-label="Formato de descarga"
              value={
                settings.kind === "video"
                  ? settings.videoFormat
                  : settings.audioFormat
              }
              onChange={(event) =>
                settings.kind === "video"
                  ? setSettings({
                      videoFormat: event.target
                        .value as UserSettings["videoFormat"],
                    })
                  : setSettings({
                      audioFormat: event.target
                        .value as UserSettings["audioFormat"],
                    })
              }
            >
              {(settings.kind === "video"
                ? ["mp4", "mkv", "webm"]
                : ["mp3", "m4a", "opus"]
              ).map((format) => (
                <option key={format} value={format}>
                  {format.toUpperCase()}
                </option>
              ))}
            </select>
            <ChevronDown size={16} />
          </div>
        </label>
      </div>

      <div className="toggle-list">
        {settings.kind === "video" && (
          <Toggle
            label="Subtítulos"
            description="Español o inglés, cuando existan"
            checked={settings.subtitles}
            onChange={(checked) => setSettings({ subtitles: checked })}
          />
        )}
        <Toggle
          label="Metadatos"
          description="Título, autor y capítulos"
          checked={settings.embedMetadata}
          onChange={(checked) => setSettings({ embedMetadata: checked })}
        />
        <Toggle
          label="Carátula"
          description="Miniatura incrustada en el archivo"
          checked={settings.embedThumbnail}
          onChange={(checked) => setSettings({ embedThumbnail: checked })}
        />
      </div>

      <div className="destination-row">
        <span className="folder-icon">
          <Folder size={18} />
        </span>
        <div>
          <small>Guardar en</small>
          <strong title={settings.downloadDir}>
            {settings.downloadDir || "Elige una carpeta"}
          </strong>
        </div>
        <button className="text-button" onClick={onChooseDirectory}>
          Cambiar
        </button>
      </div>

      <button
        className="download-button"
        onClick={onDownload}
        disabled={!appStatus?.ytDlpReady}
      >
        <Download size={20} />
        Descargar ahora
        <span>
          {settings.kind === "video"
            ? `${settings.videoFormat.toUpperCase()} · ${qualityLabel(
                settings.videoQuality,
                "video",
              )}`
            : `${settings.audioFormat.toUpperCase()} · ${qualityLabel(
                settings.audioQuality,
                "audio",
              )}`}
        </span>
      </button>
    </article>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}

interface DownloadsViewProps {
  downloads: DownloadItem[];
  downloadDir: string;
  onCancel: (id: string) => void;
  onRepair: (item: DownloadItem) => void;
  onReveal: (path: string) => void;
  onClear: () => void;
  onGoHome: () => void;
}

function DownloadsView({
  downloads,
  downloadDir,
  onCancel,
  onRepair,
  onReveal,
  onClear,
  onGoHome,
}: DownloadsViewProps) {
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () =>
      downloads.filter((item) => {
        const matchesQuery = item.title
          .toLowerCase()
          .includes(query.toLowerCase());
        const matchesFilter =
          filter === "all" ||
          (filter === "active" &&
            ["queued", "downloading", "retrying", "processing"].includes(
              item.status,
            )) ||
          (filter === "completed" && item.status === "completed");
        return matchesQuery && matchesFilter;
      }),
    [downloads, filter, query],
  );

  const activeCount = downloads.filter((item) =>
    ["queued", "downloading", "retrying", "processing"].includes(item.status),
  ).length;
  const completedCount = downloads.filter(
    (item) => item.status === "completed",
  ).length;

  return (
    <div className="page downloads-page">
      <header className="section-header">
        <div>
          <p className="eyebrow">TU BIBLIOTECA LOCAL</p>
          <h1>Descargas</h1>
          <p>Todo lo que guardas, ordenado y a la vista.</p>
        </div>
        {downloads.length > 0 && (
          <button className="secondary-button" onClick={onClear}>
            <Trash2 size={16} />
            Limpiar finalizadas
          </button>
        )}
      </header>

      <div className="summary-grid">
        <div>
          <span className="summary-icon lime">
            <ArrowDownToLine size={19} />
          </span>
          <p>
            <strong>{activeCount}</strong>
            <small>En curso</small>
          </p>
        </div>
        <div>
          <span className="summary-icon purple">
            <CheckCircle2 size={19} />
          </span>
          <p>
            <strong>{completedCount}</strong>
            <small>Completadas</small>
          </p>
        </div>
        <button
          className="summary-folder"
          onClick={() => downloadDir && onReveal(downloadDir)}
        >
          <span className="summary-icon neutral">
            <FolderOpen size={19} />
          </span>
          <p>
            <strong>Carpeta de descargas</strong>
            <small>{downloadDir || "Sin configurar"}</small>
          </p>
          <ExternalLink size={16} />
        </button>
      </div>

      {downloads.length > 0 ? (
        <>
          <div className="download-toolbar">
            <div className="filter-tabs">
              {[
                ["all", "Todas"],
                ["active", "En curso"],
                ["completed", "Completadas"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? "active" : ""}
                  onClick={() =>
                    setFilter(value as "all" | "active" | "completed")
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label="Buscar descargas"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar"
              />
            </label>
          </div>

          <div className="download-list">
            {visible.map((item) => (
              <DownloadRow
                key={item.id}
                item={item}
                onCancel={onCancel}
                onRepair={onRepair}
                onReveal={onReveal}
              />
            ))}
            {!visible.length && (
              <div className="no-results">
                <Search size={24} />
                <p>No hay descargas que coincidan con este filtro.</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="empty-state">
          <div className="empty-illustration">
            <div className="empty-orbit orbit-one" />
            <div className="empty-orbit orbit-two" />
            <span>
              <ArrowDownToLine size={36} />
            </span>
          </div>
          <h2>Tu cola está esperando</h2>
          <p>
            Pega un enlace, elige la calidad y JpkkenVideker se ocupa del resto.
          </p>
          <button className="primary-button" onClick={onGoHome}>
            <Link2 size={17} />
            Añadir un enlace
          </button>
        </div>
      )}
    </div>
  );
}

function DownloadRow({
  item,
  onCancel,
  onRepair,
  onReveal,
}: {
  item: DownloadItem;
  onCancel: (id: string) => void;
  onRepair: (item: DownloadItem) => void;
  onReveal: (path: string) => void;
}) {
  const active = ["queued", "downloading", "retrying", "processing"].includes(
    item.status,
  );
  return (
    <article className={`download-row status-${item.status}`}>
      <div className="download-thumb">
        {item.thumbnail ? (
          <img src={item.thumbnail} alt={`Miniatura de ${item.title}`} />
        ) : (
          <Film size={26} />
        )}
        <span>
          {item.kind === "video" ? (
            <FileVideo2 size={13} />
          ) : (
            <Music2 size={13} />
          )}
          {item.format.toUpperCase()}
        </span>
      </div>
      <div className="download-main">
        <div className="download-title-line">
          <div>
            <h3>{item.title}</h3>
            <p>
              {item.uploader} · {qualityLabel(item.quality, item.kind)}
            </p>
          </div>
          <span className={`download-status ${item.status}`}>
            {item.status === "completed" && <Check size={13} />}
            {item.status === "failed" && <AlertCircle size={13} />}
            {statusText(item.status)}
          </span>
        </div>
        {active ? (
          <div className="progress-area">
            <div className="progress-track">
              <span style={{ width: `${item.progress}%` }} />
            </div>
            <div className="progress-meta">
              <strong>{Math.round(item.progress)}%</strong>
              <span>{item.speed || "Preparando…"}</span>
              {item.eta && <span>Quedan {item.eta}</span>}
              {item.status === "retrying" && item.retryAttempt > 0 ? (
                <span>Intento {item.retryAttempt} de 3</span>
              ) : null}
            </div>
          </div>
        ) : item.error ? (
          <div className="download-diagnostic">
            <div className="diagnostic-heading">
              <AlertCircle size={16} />
              <p className="download-error">{item.error}</p>
            </div>
            {item.suggestions?.length ? (
              <ul>
                {item.suggestions.map((suggestion) => (
                  <li key={suggestion}>{suggestion}</li>
                ))}
              </ul>
            ) : null}
            {item.technicalDetails ? (
              <details>
                <summary>Diagnóstico técnico</summary>
                <pre>{item.technicalDetails}</pre>
              </details>
            ) : null}
          </div>
        ) : (
          <p className="completed-at">
            <History size={14} />
            {new Intl.DateTimeFormat("es", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(item.createdAt))}
          </p>
        )}
      </div>
      <div className="row-actions">
        {active ? (
          <button
            className="icon-button danger"
            onClick={() => onCancel(item.id)}
            aria-label="Cancelar descarga"
            title="Cancelar"
          >
            <Square size={15} fill="currentColor" />
          </button>
        ) : item.status === "completed" ? (
          <button
            className="icon-button"
            onClick={() => item.filePath && onReveal(item.filePath)}
            aria-label="Abrir archivo"
            title="Abrir archivo"
          >
            <FolderOpen size={17} />
          </button>
        ) : (
          <>
            {item.technicalDetails ? (
              <button
                className="icon-button"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    [
                      `JpkkenVideker · ${item.errorCategory || "error"}`,
                      item.error || "",
                      item.technicalDetails || "",
                    ].join("\n\n"),
                  )
                }
                aria-label="Copiar diagnóstico"
                title="Copiar diagnóstico"
              >
                <Copy size={16} />
              </button>
            ) : null}
            <button
              className="repair-button"
              onClick={() => onRepair(item)}
              aria-label="Reparar descarga"
              title="Reintentar con ajustes seguros"
            >
              <Wrench size={15} />
              Reparar
            </button>
          </>
        )}
      </div>
    </article>
  );
}

interface SettingsViewProps {
  settings: UserSettings;
  appStatus: AppStatus | null;
  setSettings: (patch: Partial<UserSettings>) => void;
  onChooseDirectory: () => void;
  onRefreshStatus: () => void;
  engineUpdate: EngineUpdateInfo | null;
  updatingEngine: boolean;
  onUpdateEngine: () => void;
}

function SettingsView({
  settings,
  appStatus,
  setSettings,
  onChooseDirectory,
  onRefreshStatus,
  engineUpdate,
  updatingEngine,
  onUpdateEngine,
}: SettingsViewProps) {
  return (
    <div className="page settings-page">
      <header className="section-header">
        <div>
          <p className="eyebrow">HAZLA TUYA</p>
          <h1>Ajustes</h1>
          <p>Preferencias simples que se recuerdan entre sesiones.</p>
        </div>
      </header>

      <section className="settings-section">
        <div className="settings-heading">
          <span>
            <Folder size={19} />
          </span>
          <div>
            <h2>Descargas</h2>
            <p>Destino y rendimiento predeterminados</p>
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-row">
            <div>
              <strong>Carpeta de destino</strong>
              <p className="path-copy">{settings.downloadDir}</p>
            </div>
            <button className="secondary-button" onClick={onChooseDirectory}>
              <FolderOpen size={16} />
              Elegir carpeta
            </button>
          </div>
          <div className="settings-divider" />
          <div className="settings-row">
            <div>
              <strong>Fragmentos simultáneos</strong>
              <p>Acelera vídeos segmentados sin saturar la conexión.</p>
            </div>
            <div className="stepper">
              <button
                onClick={() =>
                  setSettings({
                    concurrentFragments: Math.max(
                      1,
                      settings.concurrentFragments - 1,
                    ),
                  })
                }
              >
                −
              </button>
              <span>{settings.concurrentFragments}</span>
              <button
                onClick={() =>
                  setSettings({
                    concurrentFragments: Math.min(
                      8,
                      settings.concurrentFragments + 1,
                    ),
                  })
                }
              >
                +
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-heading">
          <span>
            <ShieldCheck size={19} />
          </span>
          <div>
            <h2>Compatibilidad</h2>
            <p>Para contenido al que ya tienes acceso legítimo</p>
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-toggle-list">
            <Toggle
              label="Compatibilidad automática"
              description="Detecta el tipo de fallo y prueba hasta dos ajustes conservadores."
              checked={settings.compatibilityMode}
              onChange={(checked) =>
                setSettings({ compatibilityMode: checked })
              }
            />
            <div className="settings-divider" />
            <Toggle
              label="Motor JavaScript Deno"
              description="Mejora la compatibilidad con los reproductores modernos de YouTube."
              checked={settings.useDeno}
              onChange={(checked) => setSettings({ useDeno: checked })}
            />
            <div className="settings-divider" />
            <Toggle
              label="Evitar duplicados"
              description="Registra lo descargado para no repetir el mismo contenido."
              checked={settings.avoidDuplicates}
              onChange={(checked) =>
                setSettings({ avoidDuplicates: checked })
              }
            />
          </div>
          <div className="settings-divider" />
          <label className="settings-row">
            <div>
              <strong>Usar sesión del navegador</strong>
              <p>
                Útil para vídeos privados propios o contenido con restricción de
                edad. JpkkenVideker no guarda tus cookies.
              </p>
            </div>
            <div className="select-shell settings-select">
              <select
                aria-label="Navegador para usar la sesión"
                value={settings.browserCookies}
                onChange={(event) =>
                  setSettings({
                    browserCookies: event.target
                      .value as UserSettings["browserCookies"],
                  })
                }
              >
                <option value="none">No usar</option>
                <option value="edge">Microsoft Edge</option>
                <option value="chrome">Google Chrome</option>
                <option value="firefox">Firefox</option>
                <option value="brave">Brave</option>
              </select>
              <ChevronDown size={16} />
            </div>
          </label>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-heading">
          <span>
            {settings.theme === "dark" ? (
              <Moon size={19} />
            ) : (
              <Sun size={19} />
            )}
          </span>
          <div>
            <h2>Apariencia</h2>
            <p>Una interfaz cómoda a cualquier hora</p>
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-row">
            <div>
              <strong>Tema de la aplicación</strong>
              <p>Cambia al instante, sin reiniciar.</p>
            </div>
            <div className="theme-switcher">
              <button
                className={settings.theme === "dark" ? "active" : ""}
                aria-pressed={settings.theme === "dark"}
                onClick={() => setSettings({ theme: "dark" })}
              >
                <Moon size={15} />
                Oscuro
              </button>
              <button
                className={settings.theme === "light" ? "active" : ""}
                aria-pressed={settings.theme === "light"}
                onClick={() => setSettings({ theme: "light" })}
              >
                <Sun size={15} />
                Claro
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-heading">
          <span>
            <CircleGauge size={19} />
          </span>
          <div>
            <h2>Componentes</h2>
            <p>Estado del motor multimedia local</p>
          </div>
        </div>
        <div className="settings-card engine-settings">
          <EngineRow
            name="yt-dlp"
            ready={Boolean(appStatus?.ytDlpReady)}
            version={
              appStatus?.ytDlpVersion
                ? `${appStatus.ytDlpVersion} · ${
                    appStatus.engineSource === "updated"
                      ? "actualizado"
                      : "incluido"
                  }`
                : null
            }
          />
          <div className="settings-divider" />
          <EngineRow
            name="FFmpeg"
            ready={Boolean(appStatus?.ffmpegReady)}
            version={appStatus?.ffmpegVersion}
          />
          <div className="settings-divider" />
          <EngineRow
            name="Deno"
            ready={Boolean(appStatus?.denoReady)}
            version={appStatus?.denoVersion}
          />
          <div className="engine-actions">
            <label className="auto-update-option">
              <input
                type="checkbox"
                checked={settings.autoUpdateEngine}
                onChange={(event) =>
                  setSettings({ autoUpdateEngine: event.target.checked })
                }
              />
              Buscar actualizaciones verificadas cada semana
            </label>
            {engineUpdate?.updateAvailable ? (
              <p className="update-available">
                Nueva versión disponible: {engineUpdate.latestVersion}
              </p>
            ) : null}
            <div>
              <button
                className="secondary-button"
                onClick={onUpdateEngine}
                disabled={updatingEngine}
                aria-busy={updatingEngine}
              >
                <RefreshCw
                  size={15}
                  className={updatingEngine ? "spin" : ""}
                />
                {updatingEngine
                  ? "Verificando…"
                  : engineUpdate?.updateAvailable
                    ? "Actualizar motor"
                    : "Buscar actualización"}
              </button>
              <button
                className="refresh-engine inline"
                onClick={onRefreshStatus}
                disabled={updatingEngine}
              >
                Comprobar componentes
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="about-line">
        <div className="brand compact">
          <img src={logo} alt="" />
          <div>
            <strong>JpkkenVideker 0.1.0</strong>
            <span>{runningInTauri ? "Aplicación de escritorio" : "Vista de diseño web"}</span>
          </div>
        </div>
        <p>Hecha para guardar con criterio, no para saltarse protecciones.</p>
      </div>
    </div>
  );
}

function EngineRow({
  name,
  ready,
  version,
}: {
  name: string;
  ready: boolean;
  version?: string | null;
}) {
  return (
    <div className="engine-row">
      <span className={`status-dot ${ready ? "ready" : ""}`} />
      <div>
        <strong>{name}</strong>
        <p>{version || (ready ? "Disponible" : "No encontrado")}</p>
      </div>
      <span className={`health-pill ${ready ? "ready" : ""}`}>
        {ready ? "Listo" : "Revisar"}
      </span>
    </div>
  );
}

export default App;
