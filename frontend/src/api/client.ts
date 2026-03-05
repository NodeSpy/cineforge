const BASE = '/api';

export interface AppConfig {
  radarr_url: string;
  radarr_api_key: string;
  sonarr_url: string;
  sonarr_api_key: string;
  tmdb_api_key: string;
  quality_profile_id: number;
  root_folder_path: string;
  min_availability: string;
  search_on_add: boolean;
  monitored: boolean;
}

export interface QualityProfile {
  id: number;
  name: string;
}

export interface RootFolder {
  id: number;
  path: string;
  freeSpace: number;
}

export interface RadarrTag {
  id: number;
  label: string;
}

export interface PreviewItem {
  tmdb_id: number;
  imdb_id: string;
  title: string;
  year: number;
  overview: string;
  poster_url: string;
  status: string;
  error?: string;
}

export interface PreviewResponse {
  items: PreviewItem[];
  total: number;
  ready: number;
}

export interface ImportItem {
  tmdb_id: number;
  imdb_id: string;
  title: string;
}

export interface ImportResponse {
  job_id: string;
}

export interface JobResult {
  title: string;
  tmdb_id?: number;
  imdb_id?: string;
  status: string;
  error?: string;
}

export interface Job {
  id: string;
  type: string;
  status: string;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  results: JobResult[];
  created_at: string;
  updated_at: string;
  reconciled_results?: ReconcileResponse;
  reconciled_at?: string;
}

export interface ReconciledResult extends JobResult {
  current_status: 'in_radarr' | 'missing';
}

export interface ReconcileResponse {
  results: ReconciledResult[];
  summary: { in_radarr: number; missing: number };
}

export interface ConvertMatch {
  original_title: string;
  original_year: string;
  matches: TmdbMovie[];
  best_match?: TmdbMovie;
  status: string;
}

export interface TmdbMovie {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  release_date: string;
  poster_path: string;
  vote_average: number;
}

export interface ConversionSession {
  id: string;
  name: string;
  status: string;
  total: number;
  matched: number;
  job_id?: string;
  created_at: string;
  updated_at: string;
  items?: ConversionItem[];
}

export interface ConversionItem {
  id: number;
  session_id: string;
  item_index: number;
  original_title: string;
  original_year: string;
  status: string;
  matches: TmdbMovie[];
  selected_tmdb_id: number;
  imported: boolean;
}

export interface StreamCallbacks {
  onProgress?: (total: number, sessionId: string) => void;
  onResult?: (index: number, match: ConvertMatch) => void;
  onThrottle?: (waitSeconds: number, reason: string) => void;
  onDone?: (total: number, matched: number, sessionId: string) => void;
  onError?: (error: string) => void;
}

export interface ValidationResult {
  service: string;
  status: string;
  message: string;
}

// Library types
export interface MovieFile {
  id: number;
  movieId: number;
  relativePath?: string;
  path?: string;
  size: number;
  dateAdded?: string;
  quality?: { quality: { id: number; name: string; source: string; resolution: number }; revision?: { version: number; real: number; isRepack: boolean } };
  mediaInfo?: MediaInfo;
  languages?: { id: number; name: string }[];
  qualityCutoffNotMet?: boolean;
}

export interface MediaInfo {
  audioBitrate: number;
  audioChannels: number;
  audioCodec: string;
  audioLanguages: string;
  audioStreamCount: number;
  videoBitDepth: number;
  videoBitrate: number;
  videoCodec: string;
  videoFps: number;
  videoDynamicRange: string;
  videoDynamicRangeType: string;
  resolution: string;
  runTime: string;
  scanType: string;
  subtitles: string;
}

export interface LibraryMovie {
  id: number;
  title: string;
  originalTitle?: string;
  sortTitle?: string;
  year: number;
  tmdbId: number;
  imdbId?: string;
  overview?: string;
  status?: string;
  studio?: string;
  certification?: string;
  runtime?: number;
  genres?: string[];
  images?: { coverType: string; remoteUrl?: string; url?: string }[];
  monitored: boolean;
  hasFile?: boolean;
  sizeOnDisk?: number;
  movieFileId?: number;
  qualityProfileId: number;
  rootFolderPath?: string;
  path?: string;
  minimumAvailability: string;
  added?: string;
  tags?: number[];
  movieFile?: MovieFile;
}

export interface FilterOptions {
  video_codecs: string[];
  audio_codecs: string[];
  resolutions: number[];
  genres: string[];
  root_folders: string[];
  years: { min: number; max: number };
}

export interface LibraryResponse {
  movies: LibraryMovie[];
  tags: RadarrTag[];
  quality_profiles: QualityProfile[];
  filter_options: FilterOptions;
  normalized_ids?: number[];
  cached_at?: string;
}

// Normalize types
export interface NormalizeCandidate {
  title: string;
  year: number;
  tmdb_id: number;
  radarr_id: number;
  file_path: string;
  file_size: number;
  poster_url: string;
  already_normalized: boolean;
}

export interface NormalizeConfig {
  target_lufs: number;
  hwaccel: string;
  audio_bitrate: string;
  backup: boolean;
  parallel: number;
  video_mode: string;
  measure_mode: string;
}

export interface NormalizeJob {
  id: string;
  status: string;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  created_at: string;
  updated_at: string;
}

export interface NormalizeJobItem {
  file_path: string;
  title: string;
  status: string;
  measured_lufs?: number;
  target_lufs?: number;
  error?: string;
}

export interface NormalizeJobDetail extends NormalizeJob {
  items: NormalizeJobItem[];
}

export interface PaginatedNormalizeJobs {
  jobs: NormalizeJob[];
  total: number;
  page: number;
  per_page: number;
}

export interface NormalizeStatusEvent {
  status: string;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

export interface NormalizeItemStatus {
  file_path: string;
  title: string;
  status: string;
  measured_lufs?: number;
  target_lufs?: number;
  error?: string;
  progress_pct?: number;
}

export interface ValidateConfigResponse {
  results: ValidationResult[];
}

// Config
export async function getConfig(): Promise<AppConfig> {
  const res = await fetch(`${BASE}/config`);
  if (!res.ok) throw new Error('Failed to fetch config');
  return res.json();
}

export async function updateConfig(config: Partial<AppConfig>): Promise<AppConfig> {
  const res = await fetch(`${BASE}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Failed to update config');
  return res.json();
}

export async function validateConfig(): Promise<ValidateConfigResponse> {
  const res = await fetch(`${BASE}/config/validate`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to validate config');
  return res.json();
}

// Radarr proxy
export async function testRadarrConnection(url: string, apiKey: string): Promise<{ success: boolean; version?: string; appName?: string; error?: string }> {
  const res = await fetch(`${BASE}/radarr/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ radarr_url: url, radarr_api_key: apiKey }),
  });
  if (!res.ok) throw new Error('Test request failed');
  return res.json();
}

export async function testTmdbConnection(apiKey: string): Promise<{ success: boolean; total_results?: number; error?: string }> {
  const res = await fetch(`${BASE}/tmdb/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!res.ok) throw new Error('Test request failed');
  return res.json();
}

export async function getQualityProfiles(): Promise<QualityProfile[]> {
  const res = await fetch(`${BASE}/radarr/profiles`);
  if (!res.ok) throw new Error('Failed to fetch profiles');
  return res.json();
}

export async function getRootFolders(): Promise<RootFolder[]> {
  const res = await fetch(`${BASE}/radarr/rootfolders`);
  if (!res.ok) throw new Error('Failed to fetch root folders');
  return res.json();
}

export async function getTags(): Promise<RadarrTag[]> {
  const res = await fetch(`${BASE}/radarr/tags`);
  if (!res.ok) throw new Error('Failed to fetch tags');
  return res.json();
}

export async function createTag(label: string): Promise<RadarrTag> {
  const res = await fetch(`${BASE}/radarr/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) throw new Error('Failed to create tag');
  return res.json();
}

// Import
export async function previewImport(items: ImportItem[]): Promise<PreviewResponse> {
  const res = await fetch(`${BASE}/import/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error('Preview request failed');
  return res.json();
}

export async function importMovies(items: ImportItem[], sessionId?: string, tags?: number[]): Promise<ImportResponse> {
  const res = await fetch(`${BASE}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, session_id: sessionId, tags }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Import failed' }));
    throw new Error(data.error || 'Import failed');
  }
  return res.json();
}

// Jobs
export async function getRecentJobs(): Promise<Job[]> {
  const res = await fetch(`${BASE}/jobs`);
  if (!res.ok) throw new Error('Failed to fetch jobs');
  return res.json();
}

export async function getJob(id: string): Promise<Job> {
  const res = await fetch(`${BASE}/jobs/${id}`);
  if (!res.ok) throw new Error('Failed to fetch job');
  return res.json();
}

export async function reconcileJob(id: string): Promise<ReconcileResponse> {
  const res = await fetch(`${BASE}/jobs/${id}/reconcile`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to reconcile job with Radarr');
  return res.json();
}

// Conversions
export async function listConversions(): Promise<ConversionSession[]> {
  const res = await fetch(`${BASE}/conversions`);
  if (!res.ok) throw new Error('Failed to list conversions');
  return res.json();
}

export async function listAllConversions(): Promise<ConversionSession[]> {
  const res = await fetch(`${BASE}/conversions/all`);
  if (!res.ok) throw new Error('Failed to list conversions');
  return res.json();
}

export async function getConversion(id: string): Promise<ConversionSession> {
  const res = await fetch(`${BASE}/conversions/${id}`);
  if (!res.ok) throw new Error('Failed to fetch conversion');
  return res.json();
}

export async function updateConversionSelection(sessionId: string, itemIndex: number, tmdbId: number): Promise<void> {
  const res = await fetch(`${BASE}/conversions/${sessionId}/selection`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_index: itemIndex, tmdb_id: tmdbId }),
  });
  if (!res.ok) throw new Error('Failed to update selection');
}

export async function deleteConversion(id: string): Promise<void> {
  const res = await fetch(`${BASE}/conversions/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete conversion');
}

// SSE stream helpers
function parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: StreamCallbacks,
) {
  const decoder = new TextDecoder();
  let buffer = '';

  function processLines() {
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    let currentEvent = '';
    let currentData = '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        currentData = line.slice(6);
      } else if (line === '' && currentEvent && currentData) {
        try {
          const parsed = JSON.parse(currentData);
          switch (currentEvent) {
            case 'progress':
              callbacks.onProgress?.(parsed.total, parsed.session_id);
              break;
            case 'result':
              callbacks.onResult?.(parsed.index, parsed.match);
              break;
            case 'throttle':
              callbacks.onThrottle?.(parsed.wait_seconds, parsed.reason);
              break;
            case 'done':
              callbacks.onDone?.(parsed.total, parsed.matched, parsed.session_id);
              break;
            case 'error':
              callbacks.onError?.(parsed.error || 'Unknown error');
              break;
          }
        } catch {
          // skip malformed JSON
        }
        currentEvent = '';
        currentData = '';
      }
    }
  }

  async function pump(): Promise<void> {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    processLines();
    return pump();
  }

  return pump();
}

export async function convertTitlesStream(
  items: Record<string, unknown>[],
  callbacks: StreamCallbacks,
  fileName?: string,
): Promise<void> {
  const res = await fetch(`${BASE}/convert/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, file_name: fileName || '' }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Stream request failed' }));
    callbacks.onError?.(data.error || 'Stream request failed');
    return;
  }

  if (!res.body) {
    callbacks.onError?.('No response body');
    return;
  }

  const reader = res.body.getReader();
  await parseSSEStream(reader, callbacks);
}

export async function resumeConvertStream(
  sessionId: string,
  callbacks: StreamCallbacks,
): Promise<void> {
  const res = await fetch(`${BASE}/convert/resume/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Resume request failed' }));
    callbacks.onError?.(data.error || 'Resume request failed');
    return;
  }

  if (!res.body) {
    callbacks.onError?.('No response body');
    return;
  }

  const reader = res.body.getReader();
  await parseSSEStream(reader, callbacks);
}

// Library
export async function getLibrary(): Promise<LibraryResponse> {
  const res = await fetch(`${BASE}/library`);
  if (!res.ok) throw new Error('Failed to fetch library');
  return res.json();
}

export async function refreshLibrary(): Promise<LibraryResponse> {
  const res = await fetch(`${BASE}/library/refresh`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to refresh library');
  return res.json();
}

// Normalize
export async function getNormalizeCandidates(): Promise<NormalizeCandidate[]> {
  const res = await fetch(`${BASE}/normalize/candidates`);
  if (!res.ok) throw new Error('Failed to fetch candidates');
  return res.json();
}

export async function startNormalize(items: { radarr_id: number; tmdb_id: number; title: string; file_path: string; target_lufs?: number }[], config?: NormalizeConfig): Promise<{ job_id: string }> {
  const res = await fetch(`${BASE}/normalize/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, config }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Start failed' }));
    throw new Error(data.error || 'Start failed');
  }
  return res.json();
}

export async function stopNormalize(jobId: string): Promise<void> {
  await fetch(`${BASE}/normalize/stop/${jobId}`, { method: 'POST' });
}

export async function retryNormalize(jobId: string): Promise<{ job_id: string }> {
  const res = await fetch(`${BASE}/normalize/retry/${jobId}`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to retry normalize job');
  return res.json();
}

export function subscribeNormalizeStatus(
  jobId: string,
  onProgress: (data: NormalizeStatusEvent) => void,
  onItems: (items: NormalizeItemStatus[]) => void,
  onDone: (status: string) => void,
  onError: (err: string) => void,
): EventSource {
  const es = new EventSource(`${BASE}/normalize/status/${jobId}`);
  es.addEventListener('progress', (e) => {
    try { onProgress(JSON.parse((e as MessageEvent).data)); } catch { /* skip */ }
  });
  es.addEventListener('items', (e) => {
    try { onItems(JSON.parse((e as MessageEvent).data)); } catch { /* skip */ }
  });
  es.addEventListener('done', (e) => {
    try { onDone(JSON.parse((e as MessageEvent).data).status); } catch { /* skip */ }
    es.close();
  });
  es.addEventListener('error', () => { es.close(); });
  return es;
}

export async function getNormalizeJobs(page = 1, perPage = 10): Promise<PaginatedNormalizeJobs> {
  const res = await fetch(`${BASE}/normalize/jobs?page=${page}&per_page=${perPage}`);
  if (!res.ok) throw new Error('Failed to fetch normalize jobs');
  return res.json();
}

export async function getNormalizeJob(id: string): Promise<NormalizeJobDetail> {
  const res = await fetch(`${BASE}/normalize/jobs/${id}`);
  if (!res.ok) throw new Error('Failed to fetch normalize job');
  return res.json();
}

export async function clearNormalizeHistory(): Promise<void> {
  const res = await fetch(`${BASE}/normalize/history`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to clear normalize history');
}

export async function getNormalizeConfig(): Promise<NormalizeConfig> {
  const res = await fetch(`${BASE}/normalize/config`);
  if (!res.ok) throw new Error('Failed to fetch normalize config');
  return res.json();
}

export async function updateNormalizeConfig(config: NormalizeConfig): Promise<NormalizeConfig> {
  const res = await fetch(`${BASE}/normalize/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Failed to update normalize config');
  return res.json();
}

// Sonarr types

export interface SonarrSeason {
  seasonNumber: number;
  monitored: boolean;
  statistics?: SonarrStats;
}

export interface SonarrStats {
  episodeFileCount: number;
  episodeCount: number;
  totalEpisodeCount: number;
  sizeOnDisk: number;
  percentOfEpisodes: number;
  seasonCount?: number;
}

export interface SonarrSeries {
  id: number;
  title: string;
  sortTitle?: string;
  year: number;
  tvdbId?: number;
  imdbId?: string;
  overview?: string;
  status?: string;
  network?: string;
  runtime?: number;
  genres?: string[];
  images?: { coverType: string; remoteUrl?: string; url?: string }[];
  seasons?: SonarrSeason[];
  monitored: boolean;
  seriesType?: string;
  path?: string;
  qualityProfileId: number;
  rootFolderPath?: string;
  added?: string;
  tags?: number[];
  certification?: string;
  statistics?: SonarrStats;
}

export interface SonarrEpisodeFile {
  id: number;
  seriesId: number;
  seasonNumber: number;
  relativePath?: string;
  path?: string;
  size: number;
  dateAdded?: string;
  quality?: { quality: { id: number; name: string; source: string; resolution: number }; revision?: { version: number; real: number; isRepack: boolean } };
  mediaInfo?: MediaInfo;
  languages?: { id: number; name: string }[];
}

export interface SonarrFilterOptions {
  genres: string[];
  networks: string[];
  series_types: string[];
  years: { min: number; max: number };
}

export interface SonarrLibraryResponse {
  series: SonarrSeries[];
  tags: RadarrTag[];
  quality_profiles: QualityProfile[];
  filter_options: SonarrFilterOptions;
  cached_at?: string;
}


export interface SonarrEpisode {
  id: number;
  seriesId: number;
  tvdbId?: number;
  episodeFileId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  overview?: string;
  hasFile: boolean;
  monitored: boolean;
  airDate?: string;
}

export interface SonarrSeriesDetail {
  series: SonarrSeries;
  episodes: SonarrEpisode[];
  files: SonarrEpisodeFile[];
}

// Sonarr API functions

export async function testSonarrConnection(url: string, apiKey: string): Promise<{ success: boolean; version?: string; appName?: string; error?: string }> {
  const res = await fetch(`${BASE}/sonarr/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sonarr_url: url, sonarr_api_key: apiKey }),
  });
  if (!res.ok) throw new Error('Test request failed');
  return res.json();
}

export async function getSonarrLibrary(): Promise<SonarrLibraryResponse> {
  const res = await fetch(`${BASE}/sonarr/library`);
  if (!res.ok) throw new Error('Failed to fetch Sonarr library');
  return res.json();
}

export async function refreshSonarrLibrary(): Promise<SonarrLibraryResponse> {
  const res = await fetch(`${BASE}/sonarr/library/refresh`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to refresh Sonarr library');
  return res.json();
}

export async function getSonarrTags(): Promise<RadarrTag[]> {
  const res = await fetch(`${BASE}/sonarr/tags`);
  if (!res.ok) throw new Error('Failed to fetch Sonarr tags');
  return res.json();
}

export async function getSonarrNormalizeCandidates(ids?: number[]): Promise<NormalizeCandidate[]> {
  const params = ids && ids.length > 0 ? `?ids=${ids.join(',')}` : '';
  const res = await fetch(`${BASE}/normalize/sonarr-candidates${params}`);
  if (!res.ok) throw new Error('Failed to fetch Sonarr normalize candidates');
  return res.json();
}

export async function getSonarrSeriesDetail(seriesId: number): Promise<SonarrSeriesDetail> {
  const res = await fetch(`${BASE}/sonarr/series/${seriesId}/episodes`);
  if (!res.ok) throw new Error('Failed to fetch series detail');
  return res.json();
}
