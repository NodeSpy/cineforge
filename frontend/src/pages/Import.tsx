import { useState, useCallback } from 'react';
import FileUpload from '../components/FileUpload';
import MovieTable from '../components/MovieTable';
import ProgressBar from '../components/ProgressBar';
import TagSelector from '../components/TagSelector';
import {
  previewImport,
  importMovies,
  getConfig,
  type PreviewItem,
  type ImportItem,
  type Job,
} from '../api/client';

type Step = 'upload' | 'preview' | 'importing' | 'done';

export default function Import() {
  const [step, setStep] = useState<Step>('upload');
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState('');
  const [tags, setTags] = useState<number[]>([]);

  async function handleFileLoaded(data: unknown[]) {
    setError('');
    setLoading(true);

    const importItems: ImportItem[] = [];
    for (const item of data as Record<string, unknown>[]) {
      const tmdbId = (item.tmdb_id || item.tmdbId || 0) as number;
      const imdbId = (item.imdb_id || item.imdbId || '') as string;
      if (tmdbId || imdbId) {
        importItems.push({
          tmdb_id: tmdbId,
          imdb_id: imdbId,
          title: (item.title || item.name || '') as string,
        });
      }
    }

    if (importItems.length === 0) {
      setError('No valid TMDb or IMDb IDs found in the file. Use the Convert page for title-based lookup.');
      setLoading(false);
      return;
    }

    try {
      const preview = await previewImport(importItems);
      setItems(preview.items);

      const readyIds = new Set(
        preview.items.filter(i => i.status === 'ready').map(i => i.tmdb_id)
      );
      setSelected(readyIds);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setLoading(false);
    }
  }

  function toggleItem(tmdbId: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(tmdbId)) {
        next.delete(tmdbId);
      } else {
        next.add(tmdbId);
      }
      return next;
    });
  }

  function exportJSON() {
    const exportItems = items
      .filter(i => selected.has(i.tmdb_id))
      .map(i => ({
        tmdb_id: i.tmdb_id,
        imdb_id: i.imdb_id,
        title: i.title,
        year: i.year,
      }));

    const blob = new Blob([JSON.stringify(exportItems, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'radarr-import.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport() {
    const importItems: ImportItem[] = items
      .filter(i => selected.has(i.tmdb_id))
      .map(i => ({
        tmdb_id: i.tmdb_id,
        imdb_id: i.imdb_id,
        title: i.title,
      }));

    if (importItems.length === 0) {
      setError('No movies selected');
      return;
    }

    // Pre-flight config check
    try {
      const cfg = await getConfig();
      if (!cfg.quality_profile_id) {
        setError('Quality Profile is not configured. Please select one in Settings.');
        return;
      }
      if (!cfg.root_folder_path) {
        setError('Root Folder is not configured. Please select one in Settings.');
        return;
      }
    } catch {
      setError('Failed to verify settings. Please check Settings page.');
      return;
    }

    setLoading(true);
    try {
      const res = await importMovies(importItems, undefined, tags.length > 0 ? tags : undefined);
      setJobId(res.job_id);
      setStep('importing');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  }

  const handleJobComplete = useCallback((_job: Job) => {
    setStep('done');
  }, []);

  function reset() {
    setStep('upload');
    setItems([]);
    setSelected(new Set());
    setError('');
    setJobId('');
    setTags([]);
  }

  const readyCount = items.filter(i => i.status === 'ready').length;
  const existsCount = items.filter(i => i.status === 'exists').length;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-100">Import Movies</h2>
        <p className="text-dark-400 mt-1">
          Upload a JSON file containing TMDb or IMDb IDs to add movies to Radarr
        </p>
      </div>

      <div className="bg-dark-800/60 border border-dark-700 rounded-lg px-5 py-3">
        <p className="text-xs text-dark-400 leading-relaxed">
          This tool is designed for bulk importing large collections of individual titles (e.g., classic Disney shorts, Looney Tunes episodes) into Radarr using JSON files with TMDb or IMDb IDs. For day-to-day use, the <a href="/library" className="text-violet-400 hover:underline">Library</a> and <a href="/normalize" className="text-teal-400 hover:underline">Normalize</a> pages are your primary tools.
        </p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {step === 'upload' && (
        <FileUpload
          onFileLoaded={handleFileLoaded}
          description='JSON array with objects containing "tmdb_id" or "imdb_id" fields'
        />
      )}

      {loading && step === 'upload' && (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-radarr-500 border-t-transparent" />
          <p className="text-sm text-dark-400 mt-3">Looking up movies...</p>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-dark-400">
                {readyCount} ready to import
                {existsCount > 0 && <span className="text-blue-400 ml-2">({existsCount} already in Radarr)</span>}
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={reset} className="px-4 py-2 bg-dark-800 hover:bg-dark-700 border border-dark-600 rounded-lg text-sm font-medium text-gray-300 transition-colors">
                Start Over
              </button>
              <button onClick={exportJSON} disabled={selected.size === 0} className="px-4 py-2 bg-dark-800 hover:bg-dark-700 border border-dark-600 rounded-lg text-sm font-medium text-gray-300 transition-colors disabled:opacity-40">
                Export JSON
              </button>
              <button onClick={handleImport} disabled={selected.size === 0 || loading} className="px-5 py-2 bg-radarr-500 hover:bg-radarr-600 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-40">
                {loading ? 'Starting...' : `Import ${selected.size} Movies`}
              </button>
            </div>
          </div>

          <TagSelector selectedTags={tags} onChange={setTags} />

          <MovieTable
            items={items}
            selectable
            selected={selected}
            onToggle={toggleItem}
          />
        </div>
      )}

      {(step === 'importing' || step === 'done') && jobId && (
        <div className="space-y-4">
          <ProgressBar jobId={jobId} onComplete={handleJobComplete} />
          {step === 'done' && (
            <div className="flex justify-center pt-4">
              <button onClick={reset} className="px-6 py-2.5 bg-radarr-500 hover:bg-radarr-600 rounded-lg text-sm font-semibold text-white transition-colors">
                Import More
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
