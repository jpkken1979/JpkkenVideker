import {
  AlertCircle,
  ArrowDownToLine,
  BellRing,
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
  checkAppUpdate,
  checkEngineUpdate,
  chooseDirectory,
  createRingtone,
  getAppStatus,
  notifyUser,
  openExternal,
  revealDirectory,
  runningInTauri,
  searchMedia,
  updateEngine,
} from "./lib/bridge";
import { dictionaries, isRtl, languageNames, type Lang, type Messages } from "./i18n";
import {
  formatDuration,
  formatViewCount,
  matchesDurationFilter,
  parseTimeInput,
  previewEmbedUrl,
  qualityLabel,
  sourceLabel,
  type DurationFilter,
} from "./lib/format";
import type {
  AppStatus,
  AppUpdateInfo,
  DownloadEvent,
  DownloadItem,
  DownloadRequest,
  EngineUpdateInfo,
  MediaInfo,
  RingtonePreset,
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
  language: "es",
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

function statusText(status: DownloadItem["status"], t: Messages): string {
  const labels = {
    queued: t.downloads.statusQueued,
    downloading: t.downloads.statusDownloading,
    retrying: t.downloads.statusRetrying,
    processing: t.downloads.statusProcessing,
    completed: t.downloads.statusCompleted,
    failed: t.downloads.statusFailed,
    cancelled: t.downloads.statusCancelled,
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
  const [ringtoneItem, setRingtoneItem] = useState<DownloadItem | null>(null);
  const [notice, setNotice] = useState<{
    tone: "success" | "error" | "neutral";
    message: string;
  } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [engineUpdate, setEngineUpdate] =
    useState<EngineUpdateInfo | null>(null);
  const [updatingEngine, setUpdatingEngine] = useState(false);
  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | null>(null);
  const [checkingAppUpdate, setCheckingAppUpdate] = useState(false);
  const noticeTimer = useRef<number | null>(null);

  const t = dictionaries[settings.language];

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
    document.documentElement.lang = settings.language;
    document.documentElement.dir = isRtl(settings.language) ? "rtl" : "ltr";
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
          t.notices.engineUpdatedTo(updated.latestVersion),
        );
      })
      .catch((error) => {
        showNotice("neutral", t.notices.autoUpdatePending(String(error)));
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
      showNotice("neutral", t.notices.pasteHint);
    }
  }

  async function handleSearch(rawQuery?: string, source?: SearchSource) {
    const cleanQuery = (rawQuery ?? searchQuery).trim();
    if (!cleanQuery) {
      showNotice("error", t.notices.typeSomething);
      return;
    }
    if (appStatus && !appStatus.ytDlpReady) {
      showNotice("error", t.notices.engineMissing);
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
        showNotice("neutral", t.notices.notALink);
        void handleSearch(cleanUrl);
        return;
      }
      showNotice("error", t.notices.invalidLink);
      return;
    }
    if (appStatus && !appStatus.ytDlpReady) {
      showNotice("error", t.notices.engineMissing);
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
      showNotice("success", t.notices.linkReady);
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
            if (!document.hasFocus()) {
              queueMicrotask(() =>
                void notifyUser(
                  t.notifications.completedTitle,
                  t.notifications.completedBody(item.title),
                ),
              );
            }
            return {
              ...item,
              status: "completed",
              progress: 100,
              speed: "",
              eta: "",
              filePath: event.data.filePath,
            };
          case "failed":
            if (!document.hasFocus()) {
              queueMicrotask(() =>
                void notifyUser(
                  t.notifications.failedTitle,
                  t.notifications.failedBody(item.title),
                ),
              );
            }
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
    noticeMessage = t.notices.queueAdded,
  ) {
    if (!settings.downloadDir) {
      showNotice("error", t.notices.chooseFolderFirst);
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
      uploader: info.uploader || t.home.unknownUploader,
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
          message: t.notices.downloadStartFailed,
          category: "startup",
          suggestions: [t.notices.startupSuggestion1, t.notices.startupSuggestion2],
          technicalDetails: String(error),
        },
      });
      showNotice("error", t.notices.downloadEndedWithError);
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
      showNotice("error", t.notices.chooseFolderSettings);
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
      t.notices.quickAdded(
        format.toUpperCase(),
        qualityLabel(quality, settings.kind),
      ),
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
      showNotice("error", t.notices.chooseFolderRepair);
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
    showNotice("neutral", t.notices.repairStarted);
    try {
      await beginDownload(request, applyDownloadEvent);
    } catch (error) {
      applyDownloadEvent({
        event: "failed",
        data: {
          jobId: id,
          message: t.notices.repairStartFailed,
          category: "startup",
          suggestions: [t.notices.startupSuggestion1],
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
        showNotice("success", t.notices.engineUpToDate(available.latestVersion));
        return;
      }
      const updated = await updateEngine();
      setEngineUpdate(updated);
      setAppStatus(await getAppStatus());
      window.localStorage.setItem(ENGINE_CHECK_KEY, String(Date.now()));
      showNotice("success", t.notices.engineUpdatedTo(updated.latestVersion));
    } catch (error) {
      showNotice("error", String(error));
    } finally {
      setUpdatingEngine(false);
    }
  }

  async function handleAppUpdateCheck() {
    setCheckingAppUpdate(true);
    try {
      const info = await checkAppUpdate();
      setAppUpdate(info);
      showNotice(
        info.updateAvailable ? "neutral" : "success",
        info.updateAvailable
          ? t.notices.appUpdateFound(info.latestVersion)
          : t.notices.appUpToDate,
      );
    } catch (error) {
      showNotice("error", String(error));
    } finally {
      setCheckingAppUpdate(false);
    }
  }

  function openRingtoneModal(item: DownloadItem) {
    if (appStatus && !appStatus.ffmpegReady) {
      showNotice("error", t.notices.ffmpegMissing);
      return;
    }
    if (!settings.downloadDir) {
      showNotice("error", t.notices.chooseFolderSettings);
      setView("settings");
      return;
    }
    setRingtoneItem(item);
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
    { id: "home" as const, label: t.nav.home, icon: Home },
    { id: "search" as const, label: t.nav.search, icon: Search },
    {
      id: "downloads" as const,
      label: t.nav.downloads,
      icon: ArrowDownToLine,
      badge: activeDownloads || undefined,
    },
    { id: "settings" as const, label: t.nav.settings, icon: Settings },
  ];

  return (
    <div className="app-shell">
      <button
        className="mobile-menu"
        onClick={() => setSidebarOpen((value) => !value)}
        aria-label={sidebarOpen ? t.nav.closeNav : t.nav.openNav}
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
            <span>{t.nav.tagline}</span>
          </div>
        </div>

        <nav aria-label={t.nav.mainNavigation}>
          <p className="eyebrow nav-label">{t.nav.yourSpace}</p>
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
            <strong>{t.nav.engineTitle}</strong>
          </div>
          <p>
            {appStatus
              ? appStatus.ytDlpReady && appStatus.ffmpegReady
                ? t.nav.engineReady
                : t.nav.engineAttention
              : t.nav.engineChecking}
          </p>
          {appStatus?.ytDlpVersion ? (
            <span className="engine-version">yt-dlp {appStatus.ytDlpVersion}</span>
          ) : null}
        </div>

        <div className="legal-note">
          <ShieldCheck size={16} />
          <p>{t.nav.legalNote}</p>
        </div>
      </aside>

      <main className="main-content">
        {view === "home" && (
          <HomeView
            t={t}
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
            t={t}
            lang={settings.language}
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
            t={t}
            lang={settings.language}
            downloads={downloads}
            downloadDir={settings.downloadDir}
            onCancel={handleCancel}
            onRepair={(item) => void repairDownload(item)}
            onReveal={(path) => void revealDirectory(path)}
            onCreateRingtone={openRingtoneModal}
            onClear={clearFinished}
            onGoHome={() => setView("home")}
          />
        )}
        {view === "settings" && (
          <SettingsView
            t={t}
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
            appUpdate={appUpdate}
            checkingAppUpdate={checkingAppUpdate}
            onCheckAppUpdate={() => void handleAppUpdateCheck()}
            onOpenUrl={(url: string) => void openExternal(url)}
          />
        )}
      </main>

      {ringtoneItem && (
        <RingtoneModal
          t={t}
          item={ringtoneItem}
          outputDir={settings.downloadDir}
          onClose={() => setRingtoneItem(null)}
          onNotice={showNotice}
          onReveal={(path) => void revealDirectory(path)}
        />
      )}

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
          <button onClick={() => setNotice(null)} aria-label={t.ringtone.close}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

interface HomeViewProps {
  t: Messages;
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
  t,
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
          <p className="eyebrow">{t.home.eyebrow}</p>
          <h1>
            {t.home.titleStart} <span>{t.home.titleAccent}</span>
          </h1>
          <p className="header-copy">{t.home.headerCopy}</p>
        </div>
        <div className="header-stats">
          <div>
            <span className="stat-icon">
              <Check size={16} />
            </span>
            <p>
              <strong>{completedDownloads}</strong>
              <span>{t.home.statSaved}</span>
            </p>
          </div>
          <div>
            <span className="stat-icon purple">
              <Zap size={16} />
            </span>
            <p>
              <strong>1000+</strong>
              <span>{t.home.statSites}</span>
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
              <h2>{t.home.pasteTitle}</h2>
              <p>{t.home.pasteSubtitle}</p>
            </div>
          </div>
          <span className="privacy-pill">
            <ShieldCheck size={14} />
            {t.home.privacyPill}
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
            placeholder={t.home.urlPlaceholder}
            aria-label={t.home.urlAria}
            spellCheck={false}
          />
          {url ? (
            <button
              className="icon-button subtle"
              onClick={() => setUrl("")}
              aria-label={t.home.clearLink}
            >
              <X size={17} />
            </button>
          ) : (
            <button className="paste-button" onClick={onPaste}>
              {t.home.paste}
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
            {analyzing ? t.home.analyzing : t.home.analyze}
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
          {t.home.includePlaylist}
        </label>
      </section>

      {analyzing && <AnalysisSkeleton t={t} />}

      {media && !analyzing ? (
        <section className="download-workspace">
          <MediaPreview t={t} media={media} />
          <DownloadOptions
            t={t}
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
        <section className="feature-strip" aria-label={t.home.eyebrow}>
          <div>
            <span>
              <Film size={19} />
            </span>
            <p>
              <strong>{t.home.featureQualityTitle}</strong>
              <small>{t.home.featureQualityCopy}</small>
            </p>
          </div>
          <div>
            <span>
              <Headphones size={19} />
            </span>
            <p>
              <strong>{t.home.featureAudioTitle}</strong>
              <small>{t.home.featureAudioCopy}</small>
            </p>
          </div>
          <div>
            <span>
              <Gauge size={19} />
            </span>
            <p>
              <strong>{t.home.featureSpeedTitle}</strong>
              <small>{t.home.featureSpeedCopy}</small>
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}

interface RingtoneModalProps {
  t: Messages;
  item: DownloadItem;
  outputDir: string;
  onClose: () => void;
  onNotice: (tone: "success" | "error" | "neutral", message: string) => void;
  onReveal: (path: string) => void;
}

const ringtoneDurations = [15, 20, 30, 40];

function RingtoneModal({
  t,
  item,
  outputDir,
  onClose,
  onNotice,
  onReveal,
}: RingtoneModalProps) {
  const [preset, setPreset] = useState<RingtonePreset>("iphone");
  const [startText, setStartText] = useState("0:00");
  const [duration, setDuration] = useState(30);
  const [fade, setFade] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createdPath, setCreatedPath] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleCreate() {
    if (!item.filePath) return;
    const startSeconds = startText.trim() ? parseTimeInput(startText) : 0;
    if (startSeconds == null) {
      onNotice("error", t.notices.invalidStart);
      return;
    }
    setCreating(true);
    try {
      const path = await createRingtone({
        inputPath: item.filePath,
        outputDir,
        startSeconds,
        durationSeconds: duration,
        preset,
        fade,
      });
      setCreatedPath(path);
      onNotice("success", t.notices.ringtoneCreated);
    } catch (error) {
      onNotice("error", String(error));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      className="preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t.downloads.ringtoneAria(item.title)}
      onClick={onClose}
    >
      <div
        className="preview-modal ringtone-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="preview-header">
          <div>
            <p className="eyebrow">{t.ringtone.eyebrow}</p>
            <h3>{item.title}</h3>
          </div>
          <button
            className="icon-button subtle"
            onClick={onClose}
            aria-label={t.ringtone.closeAria}
          >
            <X size={18} />
          </button>
        </header>

        {createdPath ? (
          <div className="ringtone-done">
            <CheckCircle2 size={22} />
            <p className="ringtone-path" title={createdPath}>
              {createdPath}
            </p>
            <div className="ringtone-instructions">
              {preset === "iphone" ? (
                <p>
                  <strong>{t.ringtone.iphoneInstructionsTitle}</strong>{" "}
                  {t.ringtone.iphoneInstructions}
                </p>
              ) : (
                <p>
                  <strong>{t.ringtone.androidInstructionsTitle}</strong>{" "}
                  {t.ringtone.androidInstructions}
                </p>
              )}
            </div>
            <footer className="preview-footer">
              <button
                className="primary-button"
                onClick={() => onReveal(createdPath)}
              >
                <FolderOpen size={16} />
                {t.ringtone.openTonesFolder}
              </button>
              <button className="secondary-button" onClick={onClose}>
                {t.ringtone.close}
              </button>
            </footer>
          </div>
        ) : (
          <>
            <div
              className="segmented-control"
              role="group"
              aria-label={t.ringtone.phoneTypeAria}
            >
              <button
                className={preset === "iphone" ? "active" : ""}
                aria-pressed={preset === "iphone"}
                onClick={() => setPreset("iphone")}
              >
                iPhone (.m4r)
              </button>
              <button
                className={preset === "android" ? "active" : ""}
                aria-pressed={preset === "android"}
                onClick={() => setPreset("android")}
              >
                Android (.mp3)
              </button>
            </div>

            <div className="option-grid">
              <label>
                <span>{t.ringtone.startsAt}</span>
                <div className="select-shell">
                  <input
                    className="ringtone-start"
                    value={startText}
                    onChange={(event) => setStartText(event.target.value)}
                    placeholder={t.ringtone.startPlaceholder}
                    aria-label={t.ringtone.startAria}
                    spellCheck={false}
                  />
                </div>
              </label>
              <label>
                <span>{t.ringtone.duration}</span>
                <div className="select-shell">
                  <select
                    aria-label={t.ringtone.durationAria}
                    value={duration}
                    onChange={(event) => setDuration(Number(event.target.value))}
                  >
                    {ringtoneDurations.map((value) => (
                      <option key={value} value={value}>
                        {t.ringtone.seconds(value)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} />
                </div>
              </label>
            </div>

            <div className="toggle-list">
              <Toggle
                label={t.ringtone.fadeLabel}
                description={t.ringtone.fadeDesc}
                checked={fade}
                onChange={setFade}
              />
            </div>

            <p className="ringtone-hint">
              <Info size={14} />
              {t.ringtone.hint}
            </p>

            <footer className="preview-footer">
              <button
                className="primary-button"
                onClick={() => void handleCreate()}
                disabled={creating}
              >
                {creating ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <BellRing size={16} />
                )}
                {creating ? t.ringtone.creating : t.ringtone.create}
              </button>
              <button className="secondary-button" onClick={onClose}>
                {t.ringtone.cancel}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

interface SearchViewProps {
  t: Messages;
  lang: Lang;
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

const searchSources: { id: SearchSource; label: string }[] = [
  { id: "youtube", label: "YouTube" },
  { id: "soundcloud", label: "SoundCloud" },
  { id: "dailymotion", label: "Dailymotion" },
];

function SearchView({
  t,
  lang,
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

  const durationFilters: { id: DurationFilter; label: string }[] = [
    { id: "all", label: t.search.filterAll },
    { id: "short", label: t.search.filterShort },
    { id: "medium", label: t.search.filterMedium },
    { id: "long", label: t.search.filterLong },
  ];

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
          <p className="eyebrow">{t.search.eyebrow}</p>
          <h1>{t.search.title}</h1>
          <p>{t.search.subtitle}</p>
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
            placeholder={t.search.placeholder}
            aria-label={t.search.inputAria}
            spellCheck={false}
          />
          {query ? (
            <button
              className="icon-button subtle"
              onClick={() => setQuery("")}
              aria-label={t.search.clearSearch}
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
            {searching ? t.search.searching : t.search.searchButton}
          </button>
        </div>

        <div
          className="segmented-control search-sources"
          role="group"
          aria-label={t.search.sourceAria}
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

      {searching && <SearchSkeleton t={t} />}

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
              <p className="filter-hint">{t.search.hiddenByFilter(hiddenCount)}</p>
            )}
          </div>
          <div className="download-list search-results">
          {visibleResults.map((result) => (
            <article className="download-row result-row" key={result.id}>
              <div className="download-thumb">
                {result.thumbnail ? (
                  <img
                    src={result.thumbnail}
                    alt={t.home.thumbnailAlt(result.title)}
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
                    <p>{result.uploader || t.home.unknownUploader}</p>
                  </div>
                </div>
                <div className="result-meta">
                  <span>
                    <Clock3 size={14} />
                    {formatDuration(result.duration)}
                  </span>
                  {formatViewCount(result.viewCount, lang, t.search.views) ? (
                    <span>
                      {formatViewCount(result.viewCount, lang, t.search.views)}
                    </span>
                  ) : null}
                  <span>{sourceLabel(result.source)}</span>
                </div>
              </div>
              <div className="row-actions">
                <button
                  className="icon-button preview-trigger"
                  onClick={() => setPreview(result)}
                  aria-label={t.search.previewAria(result.title)}
                  title={t.search.previewTitle}
                >
                  <Play size={17} />
                </button>
                <button
                  className="primary-button result-download"
                  onClick={() => onSelectResult(result.url)}
                >
                  <Download size={16} />
                  {t.search.download}
                </button>
                <button
                  className="icon-button quick-download"
                  onClick={() => onQuickDownload(result)}
                  aria-label={t.search.quickDownloadAria(result.title)}
                  title={t.search.quickDownloadTitle}
                >
                  <Zap size={17} />
                </button>
                <button
                  className="icon-button"
                  onClick={() => onOpenExternal(result.url)}
                  aria-label={t.search.openInBrowserAria(result.title)}
                  title={t.search.openInBrowserTitle}
                >
                  <ExternalLink size={17} />
                </button>
              </div>
            </article>
          ))}
          {!visibleResults.length && (
            <div className="no-results">
              <Search size={24} />
              <p>{t.search.filterHidAll}</p>
              <button
                className="text-button"
                onClick={() => setDurationFilter("all")}
              >
                {t.search.showAll}
              </button>
            </div>
          )}
          </div>
        </>
      )}

      {!searching && searchPerformed && !results.length && (
        <div className="no-results">
          <Search size={24} />
          <p>{t.search.noResults}</p>
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
          <h2>{t.search.emptyTitle}</h2>
          <p>{t.search.emptyCopy}</p>
          {history.length > 0 && (
            <div className="search-history">
              <p className="eyebrow">{t.search.recentSearches}</p>
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
                {t.search.clearHistory}
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
          aria-label={t.search.previewAria(preview.title)}
          onClick={() => setPreview(null)}
        >
          <div
            className="preview-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="preview-header">
              <div>
                <p className="eyebrow">{t.search.previewEyebrow}</p>
                <h3>{preview.title}</h3>
              </div>
              <button
                className="icon-button subtle"
                onClick={() => setPreview(null)}
                aria-label={t.search.closePreview}
              >
                <X size={18} />
              </button>
            </header>
            {previewSrc ? (
              <div className="preview-frame">
                <iframe
                  src={previewSrc}
                  title={t.search.playerTitle(preview.title)}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className="preview-unavailable">
                <Info size={20} />
                <p>{t.search.previewUnavailable}</p>
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
                {t.search.yesDownloadThis}
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
                {t.search.quickDownload}
              </button>
              <button
                className="secondary-button"
                onClick={() => onOpenExternal(preview.url)}
              >
                <ExternalLink size={16} />
                {t.search.openInBrowserTitle}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

function SearchSkeleton({ t }: { t: Messages }) {
  return (
    <div className="download-list search-results" aria-label={t.search.searching}>
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

function AnalysisSkeleton({ t }: { t: Messages }) {
  return (
    <section className="analysis-skeleton" aria-label={t.home.skeletonLabel}>
      <div className="skeleton thumbnail-skeleton" />
      <div className="skeleton-copy">
        <div className="skeleton line short" />
        <div className="skeleton line" />
        <div className="skeleton line medium" />
        <p>
          <LoaderCircle className="spin" size={16} />
          {t.home.skeletonCopy}
        </p>
      </div>
    </section>
  );
}

function MediaPreview({ t, media }: { t: Messages; media: MediaInfo }) {
  return (
    <article className="media-preview">
      <div className="media-art">
        {media.thumbnail ? (
          <img src={media.thumbnail} alt={t.home.thumbnailAlt(media.title)} />
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
            ? t.home.pieces(String(media.playlistCount ?? t.home.several))
            : t.home.linkReady}
        </p>
        <h2>{media.title}</h2>
        <p className="media-uploader">{media.uploader || t.home.unknownUploader}</p>
        <div className="media-meta">
          <span>
            <Clock3 size={15} />
            {formatDuration(media.duration)}
          </span>
          <span>
            <CircleGauge size={15} />
            {media.resolutions.length
              ? t.home.upTo(Math.max(...media.resolutions))
              : t.home.autoQuality}
          </span>
        </div>
      </div>
    </article>
  );
}

interface DownloadOptionsProps {
  t: Messages;
  settings: UserSettings;
  setSettings: (patch: Partial<UserSettings>) => void;
  appStatus: AppStatus | null;
  media: MediaInfo;
  onChooseDirectory: () => void;
  onDownload: () => void;
}

function DownloadOptions({
  t,
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
          { value: "best", label: qualityLabel("best", "video") },
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
          label: qualityLabel(value, "audio"),
        }));

  return (
    <article className="options-panel">
      <div
        className="segmented-control"
        role="group"
        aria-label={t.home.downloadKindAria}
      >
        <button
          className={settings.kind === "video" ? "active" : ""}
          aria-pressed={settings.kind === "video"}
          onClick={() => setSettings({ kind: "video" })}
        >
          <FileVideo2 size={17} />
          {t.home.video}
        </button>
        <button
          className={settings.kind === "audio" ? "active" : ""}
          aria-pressed={settings.kind === "audio"}
          onClick={() => setSettings({ kind: "audio" })}
        >
          <FileAudio2 size={17} />
          {t.home.audioOnly}
        </button>
      </div>

      <div className="option-grid">
        <label>
          <span>{t.home.quality}</span>
          <div className="select-shell">
            <select
              aria-label={t.home.qualityAria}
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
          <span>{t.home.format}</span>
          <div className="select-shell">
            <select
              aria-label={t.home.formatAria}
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
            label={t.home.subtitles}
            description={t.home.subtitlesDesc}
            checked={settings.subtitles}
            onChange={(checked) => setSettings({ subtitles: checked })}
          />
        )}
        <Toggle
          label={t.home.metadata}
          description={t.home.metadataDesc}
          checked={settings.embedMetadata}
          onChange={(checked) => setSettings({ embedMetadata: checked })}
        />
        <Toggle
          label={t.home.coverArt}
          description={t.home.coverArtDesc}
          checked={settings.embedThumbnail}
          onChange={(checked) => setSettings({ embedThumbnail: checked })}
        />
      </div>

      <div className="destination-row">
        <span className="folder-icon">
          <Folder size={18} />
        </span>
        <div>
          <small>{t.home.saveTo}</small>
          <strong title={settings.downloadDir}>
            {settings.downloadDir || t.home.chooseFolder}
          </strong>
        </div>
        <button className="text-button" onClick={onChooseDirectory}>
          {t.home.change}
        </button>
      </div>

      <button
        className="download-button"
        onClick={onDownload}
        disabled={!appStatus?.ytDlpReady}
      >
        <Download size={20} />
        {t.home.downloadNow}
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
  t: Messages;
  lang: Lang;
  downloads: DownloadItem[];
  downloadDir: string;
  onCancel: (id: string) => void;
  onRepair: (item: DownloadItem) => void;
  onReveal: (path: string) => void;
  onCreateRingtone: (item: DownloadItem) => void;
  onClear: () => void;
  onGoHome: () => void;
}

function DownloadsView({
  t,
  lang,
  downloads,
  downloadDir,
  onCancel,
  onRepair,
  onReveal,
  onCreateRingtone,
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
          <p className="eyebrow">{t.downloads.eyebrow}</p>
          <h1>{t.downloads.title}</h1>
          <p>{t.downloads.subtitle}</p>
        </div>
        {downloads.length > 0 && (
          <button className="secondary-button" onClick={onClear}>
            <Trash2 size={16} />
            {t.downloads.clearFinished}
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
            <small>{t.downloads.active}</small>
          </p>
        </div>
        <div>
          <span className="summary-icon purple">
            <CheckCircle2 size={19} />
          </span>
          <p>
            <strong>{completedCount}</strong>
            <small>{t.downloads.completed}</small>
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
            <strong>{t.downloads.downloadsFolder}</strong>
            <small>{downloadDir || t.downloads.notConfigured}</small>
          </p>
          <ExternalLink size={16} />
        </button>
      </div>

      {downloads.length > 0 ? (
        <>
          <div className="download-toolbar">
            <div className="filter-tabs">
              {[
                ["all", t.downloads.filterAll],
                ["active", t.downloads.active],
                ["completed", t.downloads.completed],
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
                aria-label={t.downloads.searchAria}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.downloads.searchPlaceholder}
              />
            </label>
          </div>

          <div className="download-list">
            {visible.map((item) => (
              <DownloadRow
                key={item.id}
                t={t}
                lang={lang}
                item={item}
                onCancel={onCancel}
                onRepair={onRepair}
                onReveal={onReveal}
                onCreateRingtone={onCreateRingtone}
              />
            ))}
            {!visible.length && (
              <div className="no-results">
                <Search size={24} />
                <p>{t.downloads.noMatches}</p>
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
          <h2>{t.downloads.emptyTitle}</h2>
          <p>{t.downloads.emptyCopy}</p>
          <button className="primary-button" onClick={onGoHome}>
            <Link2 size={17} />
            {t.downloads.addLink}
          </button>
        </div>
      )}
    </div>
  );
}

function DownloadRow({
  t,
  lang,
  item,
  onCancel,
  onRepair,
  onReveal,
  onCreateRingtone,
}: {
  t: Messages;
  lang: Lang;
  item: DownloadItem;
  onCancel: (id: string) => void;
  onRepair: (item: DownloadItem) => void;
  onReveal: (path: string) => void;
  onCreateRingtone: (item: DownloadItem) => void;
}) {
  const active = ["queued", "downloading", "retrying", "processing"].includes(
    item.status,
  );
  return (
    <article className={`download-row status-${item.status}`}>
      <div className="download-thumb">
        {item.thumbnail ? (
          <img src={item.thumbnail} alt={t.home.thumbnailAlt(item.title)} />
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
            {statusText(item.status, t)}
          </span>
        </div>
        {active ? (
          <div className="progress-area">
            <div className="progress-track">
              <span style={{ width: `${item.progress}%` }} />
            </div>
            <div className="progress-meta">
              <strong>{Math.round(item.progress)}%</strong>
              <span>{item.speed || t.downloads.preparing}</span>
              {item.eta && <span>{t.downloads.etaLeft(item.eta)}</span>}
              {item.status === "retrying" && item.retryAttempt > 0 ? (
                <span>{t.downloads.retryAttempt(item.retryAttempt, 3)}</span>
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
                <summary>{t.downloads.technicalDetails}</summary>
                <pre>{item.technicalDetails}</pre>
              </details>
            ) : null}
          </div>
        ) : (
          <p className="completed-at">
            <History size={14} />
            {new Intl.DateTimeFormat(lang, {
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
            aria-label={t.downloads.cancelAria}
            title={t.downloads.cancel}
          >
            <Square size={15} fill="currentColor" />
          </button>
        ) : item.status === "completed" ? (
          <>
            {item.filePath ? (
              <button
                className="icon-button ringtone-trigger"
                onClick={() => onCreateRingtone(item)}
                aria-label={t.downloads.ringtoneAria(item.title)}
                title={t.downloads.ringtoneTitle}
              >
                <BellRing size={17} />
              </button>
            ) : null}
            <button
              className="icon-button"
              onClick={() => item.filePath && onReveal(item.filePath)}
              aria-label={t.downloads.openFile}
              title={t.downloads.openFile}
            >
              <FolderOpen size={17} />
            </button>
          </>
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
                aria-label={t.downloads.copyDiagnostic}
                title={t.downloads.copyDiagnostic}
              >
                <Copy size={16} />
              </button>
            ) : null}
            <button
              className="repair-button"
              onClick={() => onRepair(item)}
              aria-label={t.downloads.repair}
              title={t.downloads.repairTitle}
            >
              <Wrench size={15} />
              {t.downloads.repair}
            </button>
          </>
        )}
      </div>
    </article>
  );
}

interface SettingsViewProps {
  t: Messages;
  settings: UserSettings;
  appStatus: AppStatus | null;
  setSettings: (patch: Partial<UserSettings>) => void;
  onChooseDirectory: () => void;
  onRefreshStatus: () => void;
  engineUpdate: EngineUpdateInfo | null;
  updatingEngine: boolean;
  onUpdateEngine: () => void;
  appUpdate: AppUpdateInfo | null;
  checkingAppUpdate: boolean;
  onCheckAppUpdate: () => void;
  onOpenUrl: (url: string) => void;
}

function SettingsView({
  t,
  settings,
  appStatus,
  setSettings,
  onChooseDirectory,
  onRefreshStatus,
  engineUpdate,
  updatingEngine,
  onUpdateEngine,
  appUpdate,
  checkingAppUpdate,
  onCheckAppUpdate,
  onOpenUrl,
}: SettingsViewProps) {
  return (
    <div className="page settings-page">
      <header className="section-header">
        <div>
          <p className="eyebrow">{t.settings.eyebrow}</p>
          <h1>{t.settings.title}</h1>
          <p>{t.settings.subtitle}</p>
        </div>
      </header>

      <section className="settings-section">
        <div className="settings-heading">
          <span>
            <Folder size={19} />
          </span>
          <div>
            <h2>{t.settings.downloadsSection}</h2>
            <p>{t.settings.downloadsSectionSub}</p>
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-row">
            <div>
              <strong>{t.settings.destinationFolder}</strong>
              <p className="path-copy">{settings.downloadDir}</p>
            </div>
            <button className="secondary-button" onClick={onChooseDirectory}>
              <FolderOpen size={16} />
              {t.settings.pickFolder}
            </button>
          </div>
          <div className="settings-divider" />
          <div className="settings-row">
            <div>
              <strong>{t.settings.fragments}</strong>
              <p>{t.settings.fragmentsDesc}</p>
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
            <h2>{t.settings.compatSection}</h2>
            <p>{t.settings.compatSectionSub}</p>
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-toggle-list">
            <Toggle
              label={t.settings.autoCompat}
              description={t.settings.autoCompatDesc}
              checked={settings.compatibilityMode}
              onChange={(checked) =>
                setSettings({ compatibilityMode: checked })
              }
            />
            <div className="settings-divider" />
            <Toggle
              label={t.settings.denoEngine}
              description={t.settings.denoEngineDesc}
              checked={settings.useDeno}
              onChange={(checked) => setSettings({ useDeno: checked })}
            />
            <div className="settings-divider" />
            <Toggle
              label={t.settings.avoidDuplicates}
              description={t.settings.avoidDuplicatesDesc}
              checked={settings.avoidDuplicates}
              onChange={(checked) =>
                setSettings({ avoidDuplicates: checked })
              }
            />
          </div>
          <div className="settings-divider" />
          <label className="settings-row">
            <div>
              <strong>{t.settings.browserSession}</strong>
              <p>{t.settings.browserSessionDesc}</p>
            </div>
            <div className="select-shell settings-select">
              <select
                aria-label={t.settings.browserAria}
                value={settings.browserCookies}
                onChange={(event) =>
                  setSettings({
                    browserCookies: event.target
                      .value as UserSettings["browserCookies"],
                  })
                }
              >
                <option value="none">{t.settings.browserNone}</option>
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
            <h2>{t.settings.appearanceSection}</h2>
            <p>{t.settings.appearanceSectionSub}</p>
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-row">
            <div>
              <strong>{t.settings.theme}</strong>
              <p>{t.settings.themeDesc}</p>
            </div>
            <div className="theme-switcher">
              <button
                className={settings.theme === "dark" ? "active" : ""}
                aria-pressed={settings.theme === "dark"}
                onClick={() => setSettings({ theme: "dark" })}
              >
                <Moon size={15} />
                {t.settings.dark}
              </button>
              <button
                className={settings.theme === "light" ? "active" : ""}
                aria-pressed={settings.theme === "light"}
                onClick={() => setSettings({ theme: "light" })}
              >
                <Sun size={15} />
                {t.settings.light}
              </button>
            </div>
          </div>
          <div className="settings-divider" />
          <div className="settings-row">
            <div>
              <strong>{t.settings.language}</strong>
              <p>{t.settings.languageDesc}</p>
            </div>
            <div className="select-shell settings-select">
              <select
                aria-label={t.settings.languageAria}
                value={settings.language}
                onChange={(event) =>
                  setSettings({ language: event.target.value as Lang })
                }
              >
                {Object.entries(languageNames).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} />
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
            <h2>{t.settings.componentsSection}</h2>
            <p>{t.settings.componentsSectionSub}</p>
          </div>
        </div>
        <div className="settings-card engine-settings">
          <EngineRow
            t={t}
            name="yt-dlp"
            ready={Boolean(appStatus?.ytDlpReady)}
            version={
              appStatus?.ytDlpVersion
                ? `${appStatus.ytDlpVersion} · ${
                    appStatus.engineSource === "updated"
                      ? t.settings.engineUpdated
                      : t.settings.engineBundled
                  }`
                : null
            }
          />
          <div className="settings-divider" />
          <EngineRow
            t={t}
            name="FFmpeg"
            ready={Boolean(appStatus?.ffmpegReady)}
            version={appStatus?.ffmpegVersion}
          />
          <div className="settings-divider" />
          <EngineRow
            t={t}
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
              {t.settings.weeklyUpdates}
            </label>
            {engineUpdate?.updateAvailable ? (
              <p className="update-available">
                {t.settings.newEngineVersion(engineUpdate.latestVersion)}
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
                  ? t.settings.verifying
                  : engineUpdate?.updateAvailable
                    ? t.settings.updateEngine
                    : t.settings.checkUpdate}
              </button>
              <button
                className="refresh-engine inline"
                onClick={onRefreshStatus}
                disabled={updatingEngine}
              >
                {t.settings.checkComponents}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-heading">
          <span>
            <Download size={19} />
          </span>
          <div>
            <h2>{t.settings.appVersionSection}</h2>
            <p>{t.settings.appVersionSub}</p>
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-row">
            <div>
              <strong>JpkkenVideker 0.1.0</strong>
              <p>
                {appUpdate?.updateAvailable
                  ? t.settings.appUpdateAvailable(appUpdate.latestVersion)
                  : t.settings.appUpToDate}
              </p>
            </div>
            <div>
              <button
                className="secondary-button"
                onClick={onCheckAppUpdate}
                disabled={checkingAppUpdate}
                aria-busy={checkingAppUpdate}
              >
                <RefreshCw
                  size={15}
                  className={checkingAppUpdate ? "spin" : ""}
                />
                {checkingAppUpdate ? t.settings.verifying : t.settings.checkUpdate}
              </button>
              {appUpdate?.updateAvailable ? (
                <button
                  className="primary-button"
                  onClick={() => onOpenUrl(appUpdate.downloadUrl)}
                >
                  <Download size={15} />
                  {t.settings.downloadUpdate}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <div className="about-line">
        <div className="brand compact">
          <img src={logo} alt="" />
          <div>
            <strong>JpkkenVideker 0.1.0</strong>
            <span>{runningInTauri ? t.settings.desktopApp : t.settings.designView}</span>
          </div>
        </div>
        <p>{t.settings.aboutTagline}</p>
      </div>
    </div>
  );
}

function EngineRow({
  t,
  name,
  ready,
  version,
}: {
  t: Messages;
  name: string;
  ready: boolean;
  version?: string | null;
}) {
  return (
    <div className="engine-row">
      <span className={`status-dot ${ready ? "ready" : ""}`} />
      <div>
        <strong>{name}</strong>
        <p>{version || (ready ? t.settings.available : t.settings.notFound)}</p>
      </div>
      <span className={`health-pill ${ready ? "ready" : ""}`}>
        {ready ? t.settings.ready : t.settings.review}
      </span>
    </div>
  );
}

export default App;
