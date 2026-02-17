const BASE = '/api';

export interface AppConfig {
  radarr_url: string;
  radarr_api_key: string;
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

export async function getSecrets(): Promise<{ radarr_api_key: string; tmdb_api_key: string }> {
  const res = await fetch(`${BASE}/config/secrets`);
  if (!res.ok) throw new Error('Failed to fetch secrets');
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

// Conversions
export async function listConversions(): Promise<ConversionSession[]> {
  const res = await fetch(`${BASE}/conversions`);
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
