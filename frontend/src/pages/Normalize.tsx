import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  getNormalizeCandidates, getSonarrNormalizeCandidates, getLibrary,
  startNormalize, stopNormalize,
  subscribeNormalizeStatus, getNormalizeConfig, updateNormalizeConfig,
  getNormalizeJobs, getNormalizeJob, retryNormalize,
  NormalizeCandidate, NormalizeConfig, NormalizeStatusEvent, NormalizeItemStatus,
  NormalizeJob, NormalizeJobItem,
} from '../api/client';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

const LUFS_PRESETS = [
  { value: -16.0, label: 'Streaming (recommended)', desc: 'Matches Netflix, Disney+, and YouTube loudness standards. Best for most home theater and headphone setups.' },
  { value: -24.0, label: 'Broadcast TV', desc: 'Follows broadcast television standards (EBU R128). Good for content intended for TV playback.' },
  { value: -27.0, label: 'Cinematic', desc: 'Preserves more dynamic range for a theater-like experience. Quieter overall but more impactful peaks.' },
];

type Phase = 'candidates' | 'running' | 'results';
type TopTab = 'normalize' | 'history';

export default function Normalize() {
  const [topTab, setTopTab] = useState<TopTab>('normalize');
  const [searchParams] = useSearchParams();
  const [phase, setPhase] = useState<Phase>('candidates');
  const [tab, setTab] = useState<'imported' | 'library'>(searchParams.get('source') === 'library' || searchParams.get('source') === 'sonarr' ? 'library' : 'imported');
  const [candidates, setCandidates] = useState<NormalizeCandidate[]>([]);
  const [libraryMovies, setLibraryMovies] = useState<NormalizeCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [config, setConfig] = useState<NormalizeConfig>({ target_lufs: -16.0, hwaccel: 'auto', audio_bitrate: '320k', backup: false, parallel: 1, video_mode: 'copy' });
  const [showSettings, setShowSettings] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customLufs, setCustomLufs] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [lufsOverrides, setLufsOverrides] = useState<Map<string, number>>(new Map());

  const [jobId, setJobId] = useState('');
  const [progress, setProgress] = useState<NormalizeStatusEvent | null>(null);
  const [items, setItems] = useState<NormalizeItemStatus[]>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    getNormalizeConfig().then(cfg => {
      setConfig(cfg);
      const isPreset = LUFS_PRESETS.some(p => p.value === cfg.target_lufs);
      setCustomLufs(!isPreset);
    }).catch(() => {});
  }, []);

  const connectToJob = useCallback((id: string) => {
    setJobId(id);
    setPhase('running');
    setProgress(null);
    setItems([]);
    esRef.current?.close();
    const es = subscribeNormalizeStatus(
      id,
      (data) => setProgress(data),
      (itemData) => setItems(itemData),
      () => { setPhase('results'); },
      (err) => { setError(err); setPhase('results'); },
    );
    esRef.current = es;
  }, []);

  useEffect(() => {
    getNormalizeJobs(1, 5).then(data => {
      const running = data.jobs.find(j => j.status === 'running');
      if (running) {
        connectToJob(running.id);
      }
    }).catch(() => {});
  }, [connectToJob]);

  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  useEffect(() => {
    const source = searchParams.get('source');
    const ids = searchParams.get('ids');
    if (source === 'library' && ids) {
      const idSet = new Set(ids.split(',').map(Number));
      setLoading(true);
      getLibrary().then(data => {
        const sel = data.movies
          .filter(m => idSet.has(m.id) && m.hasFile && m.movieFile?.path)
          .map(m => ({
            title: m.title, year: m.year, tmdb_id: m.tmdbId, radarr_id: m.id,
            file_path: m.movieFile!.path!, file_size: m.movieFile!.size,
            poster_url: m.images?.find(i => i.coverType === 'poster')?.remoteUrl || '',
            already_normalized: false,
          }));
        setLibraryMovies(sel);
        setSelected(new Set(sel.map(m => m.file_path)));
        setTab('library');
      }).catch(err => setError(err.message)).finally(() => setLoading(false));
    } else if (source === 'sonarr' && ids) {
      const idList = ids.split(',').map(Number).filter(n => !isNaN(n));
      setLoading(true);
      getSonarrNormalizeCandidates(idList).then(sonarrCandidates => {
        setLibraryMovies(sonarrCandidates);
        setSelected(new Set(sonarrCandidates.map(c => c.file_path)));
        setTab('library');
      }).catch(err => setError(err.message)).finally(() => setLoading(false));
    } else {
      setLoading(true);
      getNormalizeCandidates()
        .then(setCandidates)
        .catch(err => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [searchParams]);

  const currentList = tab === 'imported' ? candidates : libraryMovies;

  const toggleSelect = (path: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const handleStart = useCallback(async () => {
    const startItems = currentList.filter(c => selected.has(c.file_path)).map(c => {
      const override = lufsOverrides.get(c.file_path);
      return {
        radarr_id: c.radarr_id, tmdb_id: c.tmdb_id, title: c.title, file_path: c.file_path,
        target_lufs: override,
      };
    });
    if (startItems.length === 0) return;
    try {
      await updateNormalizeConfig(config);
      const { job_id } = await startNormalize(startItems, config);
      connectToJob(job_id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start');
    }
  }, [currentList, selected, config, connectToJob, lufsOverrides]);

  const handleStop = async () => {
    if (jobId) {
      await stopNormalize(jobId);
      esRef.current?.close();
    }
  };

  const handleSaveSettings = async () => {
    try {
      await updateNormalizeConfig(config);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
    } catch {
      setError('Failed to save settings');
    }
  };

  const renderRunning = () => {
    const pct = progress && progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;
    return (
      <>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-100">Normalizing Audio</h2>
          <button onClick={handleStop} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-medium">Stop</button>
        </div>
        <div className="bg-dark-800 rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-dark-300">Overall Progress</span>
            <span className="text-sm font-mono text-teal-400">{progress?.completed || 0} / {progress?.total || 0} ({Math.round(pct)}%)</span>
          </div>
          <div className="w-full h-3 bg-dark-700 rounded-full overflow-hidden">
            <div className="h-full bg-teal-500 rounded-full transition-all duration-300" style={{ width: pct + '%' }} />
          </div>
          <div className="flex gap-4 mt-3 text-xs text-dark-400">
            <span className="text-green-400">{progress?.succeeded || 0} succeeded</span>
            <span className="text-red-400">{progress?.failed || 0} failed</span>
            <span className="text-yellow-400">{progress?.skipped || 0} skipped</span>
          </div>
        </div>
        <div className="bg-dark-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-dark-700">
              <th className="p-3 text-left text-dark-400 font-medium">File</th>
              <th className="p-3 text-left text-dark-400 font-medium w-40">Progress</th>
              <th className="p-3 text-right text-dark-400 font-medium w-24">Before</th>
              <th className="p-3 text-right text-dark-400 font-medium w-24">After</th>
            </tr></thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} className="border-b border-dark-700/50">
                  <td className="p-3"><div className="text-gray-100 font-medium">{item.title}</div><div className="text-xs text-dark-400 truncate max-w-md">{item.file_path}</div></td>
                  <td className="p-3">
                    {(item.status === 'measuring' || item.status === 'normalizing') ? (
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <StatusBadge status={item.status} />
                          {item.status === 'normalizing' && (item.progress_pct ?? 0) > 0 && (
                            <span className="text-xs font-mono text-teal-400">{Math.round(item.progress_pct!)}%</span>
                          )}
                        </div>
                        {item.status === 'normalizing' && (
                          <div className="w-full h-1.5 bg-dark-700 rounded-full overflow-hidden">
                            <div className="h-full bg-teal-500/60 rounded-full transition-all duration-300" style={{ width: (item.progress_pct ?? 0) + '%' }} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <StatusBadge status={item.status} />
                    )}
                  </td>
                  <td className="p-3 text-right font-mono text-xs text-dark-400">{item.measured_lufs != null ? item.measured_lufs.toFixed(1) + ' LUFS' : '-'}</td>
                  <td className="p-3 text-right font-mono text-xs text-teal-400">{item.status === 'done' && item.target_lufs != null ? item.target_lufs.toFixed(1) + ' LUFS' : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  const renderResults = () => (
    <>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-100">Normalization Complete</h2>
        <button onClick={() => { setPhase('candidates'); setJobId(''); setProgress(null); setItems([]); }} className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-sm font-medium">Back to Candidates</button>
      </div>
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-dark-800 rounded-lg p-4 text-center"><div className="text-2xl font-bold text-green-400">{progress?.succeeded || 0}</div><div className="text-xs text-dark-400 mt-1">Succeeded</div></div>
        <div className="bg-dark-800 rounded-lg p-4 text-center"><div className="text-2xl font-bold text-red-400">{progress?.failed || 0}</div><div className="text-xs text-dark-400 mt-1">Failed</div></div>
        <div className="bg-dark-800 rounded-lg p-4 text-center"><div className="text-2xl font-bold text-yellow-400">{progress?.skipped || 0}</div><div className="text-xs text-dark-400 mt-1">Skipped</div></div>
      </div>
      <div className="bg-dark-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-dark-700">
            <th className="p-3 text-left text-dark-400 font-medium">File</th>
            <th className="p-3 text-left text-dark-400 font-medium w-32">Status</th>
            <th className="p-3 text-right text-dark-400 font-medium w-24">Before</th>
            <th className="p-3 text-right text-dark-400 font-medium w-24">After</th>
            <th className="p-3 text-left text-dark-400 font-medium w-48">Error</th>
          </tr></thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} className="border-b border-dark-700/50">
                <td className="p-3"><div className="text-gray-100 font-medium">{item.title}</div><div className="text-xs text-dark-400 truncate max-w-md">{item.file_path}</div></td>
                <td className="p-3"><StatusBadge status={item.status} /></td>
                <td className="p-3 text-right font-mono text-xs text-dark-400">{item.measured_lufs != null ? item.measured_lufs.toFixed(1) + ' LUFS' : '-'}</td>
                <td className="p-3 text-right font-mono text-xs text-teal-400">{item.status === 'done' && item.target_lufs != null ? item.target_lufs.toFixed(1) + ' LUFS' : '-'}</td>
                <td className="p-3 text-xs text-red-400 truncate max-w-xs">{item.error || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  const renderCandidates = () => (
    <>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-100">Normalize Audio</h2>
        <div className="flex gap-2">
          <button onClick={() => setShowSettings(!showSettings)} className={'px-3 py-2 rounded-lg text-sm transition-colors ' + (showSettings ? 'bg-teal-600 text-white' : 'bg-dark-800 text-dark-300 hover:text-gray-100')}>Settings</button>
          {selected.size > 0 && <button onClick={handleStart} className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-sm font-medium transition-colors">Start Normalization ({selected.size})</button>}
        </div>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400 mb-4">{error}</div>}

      {showSettings && (
        <div className="bg-dark-800 rounded-lg p-5 mb-6 space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-gray-100 mb-3">Target Loudness</h3>
            <p className="text-xs text-dark-400 mb-3">LUFS (Loudness Units Full Scale) measures perceived loudness. Lower values preserve more dynamic range but are quieter.</p>
            <div className="space-y-2">
              {LUFS_PRESETS.map(preset => (
                <label key={preset.value} className={'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ' + (!customLufs && config.target_lufs === preset.value ? 'border-teal-500 bg-teal-500/10' : 'border-dark-700 hover:border-dark-600')}>
                  <input type="radio" name="lufs_preset" checked={!customLufs && config.target_lufs === preset.value} onChange={() => { setCustomLufs(false); setConfig({ ...config, target_lufs: preset.value }); }} className="mt-0.5 text-teal-500" />
                  <div>
                    <div className="text-sm text-gray-100 font-medium">{preset.label} <span className="text-dark-400 font-normal">({preset.value} LUFS)</span></div>
                    <div className="text-xs text-dark-400 mt-0.5">{preset.desc}</div>
                  </div>
                </label>
              ))}
              <label className={'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ' + (customLufs ? 'border-teal-500 bg-teal-500/10' : 'border-dark-700 hover:border-dark-600')}>
                <input type="radio" name="lufs_preset" checked={customLufs} onChange={() => setCustomLufs(true)} className="mt-0.5 text-teal-500" />
                <div className="flex-1">
                  <div className="text-sm text-gray-100 font-medium">Custom</div>
                  {customLufs && (
                    <div className="mt-2">
                      <input type="number" step="0.5" min="-70" max="0" value={config.target_lufs} onChange={e => setConfig({ ...config, target_lufs: parseFloat(e.target.value) || -16.0 })} className="w-28 px-3 py-1.5 bg-dark-700 border border-dark-600 rounded text-sm text-gray-100" />
                      <span className="ml-2 text-xs text-dark-400">LUFS</span>
                    </div>
                  )}
                </div>
              </label>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-dark-700">
            <span className="text-xs text-dark-400">Video handling:</span>
            <span className="text-xs text-teal-400 font-medium">Audio only (video untouched)</span>
            <InfoTip text="Only the audio track is re-encoded. The video stream is copied as-is, which is fast and preserves original video quality." />
          </div>

          <div>
            <button onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-2 text-xs text-dark-400 hover:text-dark-300 transition-colors">
              <svg className={'w-3 h-3 transition-transform ' + (showAdvanced ? 'rotate-90' : '')} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
              Advanced Settings
            </button>

            {showAdvanced && (
              <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <label className="text-xs text-dark-400">HW Acceleration</label>
                    <InfoTip text="Use your GPU to speed up video re-encoding. 'Auto' detects the best available option. Only applies when video re-encoding is needed." />
                  </div>
                  <select value={config.hwaccel} onChange={e => setConfig({ ...config, hwaccel: e.target.value })} className="w-full px-3 py-1.5 bg-dark-700 border border-dark-600 rounded text-sm text-gray-100">
                    <option value="auto">Auto Detect</option><option value="vaapi">VAAPI (Intel/AMD)</option><option value="nvenc">NVENC (NVIDIA)</option><option value="cpu">CPU Only</option>
                  </select>
                </div>
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <label className="text-xs text-dark-400">Audio Bitrate</label>
                    <InfoTip text="Higher bitrate = better audio quality but larger files. 320kbps is considered transparent (CD-quality). 256kbps is a good balance." />
                  </div>
                  <select value={config.audio_bitrate} onChange={e => setConfig({ ...config, audio_bitrate: e.target.value })} className="w-full px-3 py-1.5 bg-dark-700 border border-dark-600 rounded text-sm text-gray-100">
                    <option value="192k">192 kbps (smaller files)</option><option value="256k">256 kbps (balanced)</option><option value="320k">320 kbps (best quality)</option>
                  </select>
                </div>
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <label className="text-xs text-dark-400">Video Mode</label>
                    <InfoTip text="'Copy' is fast and only changes audio. 'Re-encode' also re-compresses the video track -- much slower but useful if the video stream has issues." />
                  </div>
                  <select value={config.video_mode} onChange={e => setConfig({ ...config, video_mode: e.target.value })} className="w-full px-3 py-1.5 bg-dark-700 border border-dark-600 rounded text-sm text-gray-100">
                    <option value="copy">Copy (fast, audio only)</option><option value="reencode">Re-encode (slow)</option>
                  </select>
                </div>
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <label className="text-xs text-dark-400">Parallel Jobs</label>
                    <InfoTip text="Process multiple files simultaneously. Higher values use more CPU/GPU resources. Start with 1-2 unless you have a powerful system." />
                  </div>
                  <input type="number" min="1" max="4" value={config.parallel} onChange={e => setConfig({ ...config, parallel: parseInt(e.target.value) || 1 })} className="w-full px-3 py-1.5 bg-dark-700 border border-dark-600 rounded text-sm text-gray-100" />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm text-dark-300 cursor-pointer">
                    <input type="checkbox" checked={config.backup} onChange={() => setConfig({ ...config, backup: !config.backup })} className="rounded bg-dark-700 border-dark-600" />
                    <span>Create backup</span>
                    <InfoTip text="Keep a copy of the original file (with .backup extension) before replacing it with the normalized version." />
                  </label>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-dark-700">
            {settingsSaved && <span className="text-xs text-green-400">Saved</span>}
            <button onClick={handleSaveSettings} className="px-4 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-xs font-medium transition-colors">
              Save Settings
            </button>
          </div>
        </div>
      )}

      <div className="flex border-b border-dark-700 mb-4">
        <button onClick={() => setTab('imported')} className={'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ' + (tab === 'imported' ? 'border-teal-500 text-teal-400' : 'border-transparent text-dark-400 hover:text-gray-100')}>Imported</button>
        <button onClick={() => setTab('library')} className={'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ' + (tab === 'library' ? 'border-teal-500 text-teal-400' : 'border-transparent text-dark-400 hover:text-gray-100')}>
          {searchParams.get('source') === 'sonarr' ? 'Sonarr Selection' : 'Library Selection'}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40 text-dark-400">Loading candidates...</div>
      ) : currentList.length === 0 ? (
        <div className="text-center py-12 text-dark-400">{tab === 'imported' ? 'No imported movies found with files. Import some movies first.' : 'No library movies selected. Go to Library to select movies.'}</div>
      ) : (
        <div className="bg-dark-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-dark-700">
              <th className="p-3 text-left w-10"><input type="checkbox" checked={selected.size === currentList.length && currentList.length > 0} onChange={() => { if (selected.size === currentList.length) setSelected(new Set()); else setSelected(new Set(currentList.map(c => c.file_path))); }} className="rounded bg-dark-700 border-dark-600" /></th>
              <th className="p-3 text-left text-dark-400 font-medium">Title</th>
              <th className="p-3 text-left text-dark-400 font-medium w-16">Year</th>
              <th className="p-3 text-right text-dark-400 font-medium w-20">Size</th>
              <th className="p-3 text-center text-dark-400 font-medium w-32">Target</th>
              <th className="p-3 text-center text-dark-400 font-medium w-24">Status</th>
            </tr></thead>
            <tbody>
              {currentList.map((c, i) => {
                const override = lufsOverrides.get(c.file_path);
                const effectiveLufs = override ?? config.target_lufs;
                const hasOverride = override !== undefined;
                return (
                  <tr key={i} className="border-b border-dark-700/50 hover:bg-dark-700/30 transition-colors">
                    <td className="p-3"><input type="checkbox" checked={selected.has(c.file_path)} onChange={() => toggleSelect(c.file_path)} className="rounded bg-dark-700 border-dark-600" /></td>
                    <td className="p-3"><div className="font-medium text-gray-100">{c.title}</div><div className="text-xs text-dark-400 truncate max-w-md">{c.file_path}</div></td>
                    <td className="p-3 text-dark-300">{c.year}</td>
                    <td className="p-3 text-right text-dark-300 text-xs">{formatBytes(c.file_size)}</td>
                    <td className="p-3 text-center">
                      <LufsOverrideCell
                        filePath={c.file_path}
                        globalLufs={config.target_lufs}
                        override={override}
                        hasOverride={hasOverride}
                        effectiveLufs={effectiveLufs}
                        onOverride={(val) => {
                          setLufsOverrides(prev => {
                            const next = new Map(prev);
                            if (val === undefined) next.delete(c.file_path);
                            else next.set(c.file_path, val);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="p-3 text-center">{c.already_normalized ? <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/15 text-green-400">Normalized</span> : <span className="px-2 py-0.5 text-xs rounded-full bg-dark-600 text-dark-300">Pending</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  return (
    <div>
      <div className="flex border-b border-dark-700 mb-6">
        <button onClick={() => setTopTab('normalize')} className={'px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors ' + (topTab === 'normalize' ? 'border-teal-500 text-teal-400' : 'border-transparent text-dark-400 hover:text-gray-100')}>
          Normalize
        </button>
        <button onClick={() => setTopTab('history')} className={'px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors ' + (topTab === 'history' ? 'border-teal-500 text-teal-400' : 'border-transparent text-dark-400 hover:text-gray-100')}>
          History
        </button>
      </div>

      {topTab === 'normalize' ? (
        phase === 'running' ? renderRunning() :
        phase === 'results' ? renderResults() :
        renderCandidates()
      ) : (
        <NormalizeHistory onRetry={(newJobId) => { setTopTab('normalize'); connectToJob(newJobId); }} />
      )}
    </div>
  );
}

function NormalizeHistory({ onRetry }: { onRetry: (newJobId: string) => void }) {
  const [jobs, setJobs] = useState<NormalizeJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<NormalizeJobItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const perPage = 10;

  const loadJobs = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const data = await getNormalizeJobs(p, perPage);
      setJobs(data.jobs);
      setTotal(data.total);
      setPage(data.page);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadJobs(1); }, [loadJobs]);

  const handleExpand = async (jobId: string) => {
    if (expandedJob === jobId) {
      setExpandedJob(null);
      setExpandedItems([]);
      return;
    }
    setExpandedJob(jobId);
    setLoadingItems(true);
    try {
      const detail = await getNormalizeJob(jobId);
      setExpandedItems(detail.items);
    } catch {
      setExpandedItems([]);
    } finally {
      setLoadingItems(false);
    }
  };

  const totalPages = Math.ceil(total / perPage);

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleString();
    } catch {
      return d;
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40 text-dark-400">Loading history...</div>;
  }

  if (jobs.length === 0) {
    return <div className="text-center py-12 text-dark-400">No normalization history yet.</div>;
  }

  return (
    <div className="space-y-3">
      {jobs.map(job => (
        <div key={job.id} className="bg-dark-800 rounded-lg overflow-hidden">
          <button onClick={() => handleExpand(job.id)} className="w-full p-4 flex items-center justify-between text-left hover:bg-dark-700/50 transition-colors">
            <div className="flex items-center gap-4">
              <div>
                <div className="text-sm text-gray-100 font-medium">{formatDate(job.created_at)}</div>
                <div className="text-xs text-dark-400 mt-0.5">{job.total} file{job.total !== 1 ? 's' : ''}</div>
              </div>
              <StatusBadge status={job.status} />
            </div>
            <div className="flex items-center gap-4">
              <div className="flex gap-3 text-xs">
                <span className="text-green-400">{job.succeeded} ok</span>
                <span className="text-red-400">{job.failed} failed</span>
                <span className="text-yellow-400">{job.skipped} skipped</span>
              </div>
              <svg className={'w-4 h-4 text-dark-400 transition-transform ' + (expandedJob === job.id ? 'rotate-180' : '')} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
              </svg>
            </div>
          </button>

          {expandedJob === job.id && (
            <div className="border-t border-dark-700">
              {job.failed > 0 && (
                <div className="px-4 pt-3 flex justify-end">
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      setRetrying(true);
                      try {
                        const { job_id } = await retryNormalize(job.id);
                        await loadJobs(page);
                        onRetry(job_id);
                      } catch {
                        /* ignore */
                      } finally {
                        setRetrying(false);
                      }
                    }}
                    disabled={retrying}
                    className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    {retrying ? 'Retrying...' : `Retry Failed (${job.failed})`}
                  </button>
                </div>
              )}
              {loadingItems ? (
                <div className="p-4 text-center text-dark-400 text-sm">Loading items...</div>
              ) : expandedItems.length === 0 ? (
                <div className="p-4 text-center text-dark-400 text-sm">No items found.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-dark-700">
                    <th className="p-3 text-left text-dark-400 font-medium">File</th>
                    <th className="p-3 text-left text-dark-400 font-medium w-28">Status</th>
                    <th className="p-3 text-right text-dark-400 font-medium w-24">Before</th>
                    <th className="p-3 text-right text-dark-400 font-medium w-24">After</th>
                    <th className="p-3 text-left text-dark-400 font-medium w-44">Error</th>
                  </tr></thead>
                  <tbody>
                    {expandedItems.map((item, i) => (
                      <tr key={i} className="border-b border-dark-700/50">
                        <td className="p-3">
                          <div className="text-gray-100 font-medium">{item.title}</div>
                          <div className="text-xs text-dark-400 truncate max-w-md">{item.file_path}</div>
                        </td>
                        <td className="p-3"><StatusBadge status={item.status} /></td>
                        <td className="p-3 text-right font-mono text-xs text-dark-400">{item.measured_lufs != null ? item.measured_lufs.toFixed(1) + ' LUFS' : '-'}</td>
                        <td className="p-3 text-right font-mono text-xs text-teal-400">{item.status === 'done' && item.target_lufs != null ? item.target_lufs.toFixed(1) + ' LUFS' : '-'}</td>
                        <td className="p-3 text-xs text-red-400 truncate max-w-xs">{item.error || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      ))}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-4">
          <button onClick={() => loadJobs(page - 1)} disabled={page <= 1} className="px-3 py-1.5 bg-dark-800 border border-dark-700 rounded-lg text-sm text-dark-300 hover:text-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Previous
          </button>
          <span className="text-sm text-dark-400">Page {page} of {totalPages}</span>
          <button onClick={() => loadJobs(page + 1)} disabled={page >= totalPages} className="px-3 py-1.5 bg-dark-800 border border-dark-700 rounded-lg text-sm text-dark-300 hover:text-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-dark-600 text-dark-300',
    measuring: 'bg-blue-500/15 text-blue-400',
    normalizing: 'bg-teal-500/15 text-teal-400',
    done: 'bg-green-500/15 text-green-400',
    failed: 'bg-red-500/15 text-red-400',
    skipped: 'bg-yellow-500/15 text-yellow-400',
    retried: 'bg-violet-500/15 text-violet-400',
  };
  return <span className={'px-2 py-0.5 text-xs rounded-full ' + (styles[status] || styles.pending)}>{status}</span>;
}

const OVERRIDE_PRESETS = [
  { value: -16.0, label: 'Streaming' },
  { value: -24.0, label: 'Broadcast' },
  { value: -27.0, label: 'Cinematic' },
];

function LufsOverrideCell({ filePath, globalLufs, override, hasOverride, effectiveLufs, onOverride }: {
  filePath: string;
  globalLufs: number;
  override: number | undefined;
  hasOverride: boolean;
  effectiveLufs: number;
  onOverride: (val: number | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customVal, setCustomVal] = useState(String(effectiveLufs));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEffect(() => {
    setCustomVal(String(effectiveLufs));
  }, [effectiveLufs]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono transition-colors ${
          hasOverride
            ? 'bg-teal-500/15 text-teal-400 border border-teal-500/30'
            : 'text-dark-400 hover:text-dark-200'
        }`}
      >
        {hasOverride && <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />}
        {effectiveLufs.toFixed(1)}
        <svg className="w-3 h-3 ml-0.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-1.5 w-52 bg-dark-700 border border-dark-600 rounded-lg shadow-xl p-3 space-y-2">
          <div className="text-[10px] font-semibold text-dark-400 uppercase tracking-wider">Override LUFS</div>
          <div className="flex flex-wrap gap-1">
            {OVERRIDE_PRESETS.map(p => (
              <button
                key={p.value}
                onClick={() => { onOverride(p.value); setOpen(false); }}
                className={`px-2 py-1 text-xs rounded border transition-colors ${
                  effectiveLufs === p.value && hasOverride
                    ? 'border-teal-500 bg-teal-500/15 text-teal-400'
                    : 'border-dark-600 text-dark-300 hover:border-dark-500'
                }`}
              >
                {p.label} ({p.value})
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              step="0.5"
              min="-70"
              max="0"
              value={customVal}
              onChange={e => setCustomVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const v = parseFloat(customVal);
                  if (!isNaN(v) && v <= 0 && v >= -70) { onOverride(v); setOpen(false); }
                }
              }}
              className="w-20 px-2 py-1 bg-dark-800 border border-dark-600 rounded text-xs text-gray-100 font-mono"
            />
            <span className="text-[10px] text-dark-400">LUFS</span>
            <button
              onClick={() => {
                const v = parseFloat(customVal);
                if (!isNaN(v) && v <= 0 && v >= -70) { onOverride(v); setOpen(false); }
              }}
              className="px-2 py-1 bg-teal-600 hover:bg-teal-500 text-white rounded text-[10px] font-medium"
            >
              Set
            </button>
          </div>
          {hasOverride && (
            <button
              onClick={() => { onOverride(undefined); setOpen(false); }}
              className="text-[10px] text-dark-400 hover:text-dark-200 transition-colors"
            >
              Reset to global ({globalLufs.toFixed(1)})
            </button>
          )}
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-2 h-2 bg-dark-700 border-l border-t border-dark-600 rotate-45 mb-[-5px]" />
        </div>
      )}
    </div>
  );
}

function InfoTip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-block">
      <button type="button" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} onClick={() => setShow(!show)} className="w-4 h-4 rounded-full bg-dark-600 text-dark-400 hover:text-dark-200 text-[10px] font-bold inline-flex items-center justify-center">i</button>
      {show && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2 bg-dark-700 border border-dark-600 rounded-lg shadow-xl text-xs text-dark-200 leading-relaxed">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-dark-700 border-r border-b border-dark-600 rotate-45 -mt-1" />
        </div>
      )}
    </span>
  );
}
