import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  getLibrary, refreshLibrary, LibraryMovie, RadarrTag, FilterOptions,
  getSonarrLibrary, refreshSonarrLibrary, SonarrSeries, SonarrFilterOptions,
  type SonarrLibraryResponse,
} from '../api/client';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

function getPosterUrl(images?: { coverType: string; remoteUrl?: string; url?: string }[]): string | null {
  const poster = images?.find(i => i.coverType === 'poster');
  return poster?.remoteUrl || poster?.url || null;
}

type LibraryTab = 'movies' | 'series';
type ViewMode = 'grid' | 'list';
type SortField = 'title' | 'year' | 'size' | 'added';
type SortDirection = 'asc' | 'desc';

export default function Library() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'series' ? 'series' : 'movies';
  const [activeTab, setActiveTab] = useState<LibraryTab>(initialTab);

  const switchTab = (tab: LibraryTab) => {
    setActiveTab(tab);
    setSearchParams(tab === 'movies' ? {} : { tab });
  };

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-2xl font-bold text-gray-100">Library</h2>
        <div className="flex rounded-lg overflow-hidden border border-dark-700">
          <button
            onClick={() => switchTab('movies')}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${
              activeTab === 'movies' ? 'bg-violet-600 text-white' : 'bg-dark-800 text-dark-300 hover:text-gray-100'
            }`}
          >
            Movies
          </button>
          <button
            onClick={() => switchTab('series')}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${
              activeTab === 'series' ? 'bg-violet-600 text-white' : 'bg-dark-800 text-dark-300 hover:text-gray-100'
            }`}
          >
            Series
          </button>
        </div>
      </div>

      {activeTab === 'movies' ? <MoviesTab /> : <SeriesTab />}
    </div>
  );
}

// ---- Movies Tab (existing Radarr library) ----

function MoviesTab() {
  const navigate = useNavigate();
  const [movies, setMovies] = useState<LibraryMovie[]>([]);
  const [tags, setTags] = useState<RadarrTag[]>([]);
  const [filterOpts, setFilterOpts] = useState<FilterOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [cachedAt, setCachedAt] = useState('');

  const [search, setSearch] = useState('');
  const [hasFileOnly, setHasFileOnly] = useState(true);
  const [monitoredOnly, setMonitoredOnly] = useState(false);
  const [selectedCodecs, setSelectedCodecs] = useState<string[]>([]);
  const [selectedAudioCodecs, setSelectedAudioCodecs] = useState<string[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [sortBy, setSortBy] = useState<SortField>('title');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  const [hideNormalized, setHideNormalized] = useState(true);
  const [normalizedIds, setNormalizedIds] = useState<Set<number>>(new Set());

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showFilters, setShowFilters] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  const loadData = useCallback((data: Awaited<ReturnType<typeof getLibrary>>) => {
    setMovies(data.movies || []);
    setTags(data.tags || []);
    setFilterOpts(data.filter_options);
    setNormalizedIds(new Set(data.normalized_ids || []));
    if (data.cached_at) setCachedAt(data.cached_at);
  }, []);

  useEffect(() => {
    getLibrary()
      .then(loadData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError('');
    try {
      const data = await refreshLibrary();
      loadData(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const filtered = useMemo(() => {
    let list = [...movies];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(m => m.title.toLowerCase().includes(q) || (m.originalTitle || '').toLowerCase().includes(q));
    }
    if (hasFileOnly) list = list.filter(m => m.hasFile);
    if (monitoredOnly) list = list.filter(m => m.monitored);
    if (hideNormalized) list = list.filter(m => !normalizedIds.has(m.id));
    if (selectedCodecs.length > 0) list = list.filter(m => m.movieFile?.mediaInfo && selectedCodecs.includes(m.movieFile.mediaInfo.videoCodec));
    if (selectedAudioCodecs.length > 0) list = list.filter(m => m.movieFile?.mediaInfo && selectedAudioCodecs.includes(m.movieFile.mediaInfo.audioCodec));
    if (selectedGenres.length > 0) list = list.filter(m => m.genres?.some(g => selectedGenres.includes(g)));
    if (selectedTags.length > 0) list = list.filter(m => m.tags?.some(t => selectedTags.includes(t)));
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'title': cmp = a.title.localeCompare(b.title); break;
        case 'year': cmp = a.year - b.year; break;
        case 'size': cmp = (a.sizeOnDisk || 0) - (b.sizeOnDisk || 0); break;
        case 'added': cmp = (a.added || '').localeCompare(b.added || ''); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [movies, search, hasFileOnly, monitoredOnly, hideNormalized, normalizedIds, selectedCodecs, selectedAudioCodecs, selectedGenres, selectedTags, sortBy, sortDir]);

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(m => m.id)));
  };

  const handleNormalize = () => {
    navigate('/normalize?source=library&ids=' + Array.from(selected).join(','));
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="text-dark-400">Loading library...</div></div>;
  if (error && movies.length === 0) return <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">{error}</div>;

  const tagMap = new Map(tags.map(t => [t.id, t.label]));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          {cachedAt && <span className="text-xs text-dark-400">Updated {timeAgo(cachedAt)}</span>}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleRefresh} disabled={refreshing} className="p-2 rounded-lg bg-dark-800 text-dark-300 hover:text-gray-100 transition-colors disabled:opacity-50" title="Refresh from Radarr">
            <svg className={'w-4 h-4' + (refreshing ? ' animate-spin' : '')} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
          <button onClick={() => setShowFilters(!showFilters)} className="px-3 py-1.5 text-sm rounded-lg bg-dark-800 text-dark-300 hover:text-gray-100">{showFilters ? 'Hide Filters' : 'Show Filters'}</button>
          <div className="flex rounded-lg overflow-hidden border border-dark-700">
            <button onClick={() => setViewMode('grid')} className={'p-1.5 ' + (viewMode === 'grid' ? 'bg-violet-600 text-white' : 'bg-dark-800 text-dark-300 hover:text-gray-100')} title="Grid view">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
            </button>
            <button onClick={() => setViewMode('list')} className={'p-1.5 ' + (viewMode === 'list' ? 'bg-violet-600 text-white' : 'bg-dark-800 text-dark-300 hover:text-gray-100')} title="List view">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" /></svg>
            </button>
          </div>
          {selected.size > 0 && <button onClick={handleNormalize} className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-sm font-medium transition-colors">Normalize Selected ({selected.size})</button>}
        </div>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm mb-4">{error}</div>}

      <div className="flex gap-6">
        {showFilters && (
          <div className="w-64 shrink-0 space-y-4">
            <input type="text" placeholder="Search titles..." value={search} onChange={e => setSearch(e.target.value)} className="w-full px-3 py-2 bg-dark-800 border border-dark-700 rounded-lg text-sm text-gray-100 placeholder-dark-400 focus:border-violet-500 focus:outline-none" />
            <div className="bg-dark-800 rounded-lg p-3 space-y-3">
              <label className="flex items-center gap-2 text-sm text-dark-300 cursor-pointer"><input type="checkbox" checked={hasFileOnly} onChange={() => setHasFileOnly(!hasFileOnly)} className="rounded bg-dark-700 border-dark-600" />Has file only</label>
              <label className="flex items-center gap-2 text-sm text-dark-300 cursor-pointer"><input type="checkbox" checked={monitoredOnly} onChange={() => setMonitoredOnly(!monitoredOnly)} className="rounded bg-dark-700 border-dark-600" />Monitored only</label>
              <label className="flex items-center gap-2 text-sm text-dark-300 cursor-pointer"><input type="checkbox" checked={hideNormalized} onChange={() => setHideNormalized(!hideNormalized)} className="rounded bg-dark-700 border-dark-600" />Hide normalized</label>
            </div>
            {filterOpts && filterOpts.video_codecs.length > 0 && <FilterGroup title="Video Codec" options={filterOpts.video_codecs} selected={selectedCodecs} onChange={setSelectedCodecs} />}
            {filterOpts && filterOpts.audio_codecs.length > 0 && <FilterGroup title="Audio Codec" options={filterOpts.audio_codecs} selected={selectedAudioCodecs} onChange={setSelectedAudioCodecs} />}
            {filterOpts && filterOpts.genres.length > 0 && <FilterGroup title="Genre" options={filterOpts.genres.sort()} selected={selectedGenres} onChange={setSelectedGenres} />}
            {tags.length > 0 && (
              <div className="bg-dark-800 rounded-lg p-3">
                <h4 className="text-xs font-semibold text-dark-400 uppercase mb-2">Tags</h4>
                <div className="flex flex-wrap gap-1">
                  {tags.map(t => <button key={t.id} onClick={() => setSelectedTags(prev => prev.includes(t.id) ? prev.filter(x => x !== t.id) : [...prev, t.id])} className={'px-2 py-0.5 text-xs rounded-full border transition-colors ' + (selectedTags.includes(t.id) ? 'bg-violet-500/20 border-violet-500 text-violet-300' : 'bg-dark-700 border-dark-600 text-dark-300 hover:border-dark-500')}>{t.label}</button>)}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-sm text-dark-400">{filtered.length} movies</span>
              {filtered.length > 0 && <button onClick={selectAll} className="text-xs text-violet-400 hover:text-violet-300">{selected.size === filtered.length ? 'Deselect all' : 'Select all'}</button>}
            </div>
            <div className="flex items-center gap-2">
              <select value={sortBy} onChange={e => setSortBy(e.target.value as SortField)} className="bg-dark-800 border border-dark-700 rounded-lg px-2 py-1 text-sm text-gray-100">
                <option value="title">Title</option><option value="year">Year</option><option value="size">Size</option><option value="added">Date Added</option>
              </select>
              <button onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')} className="px-2 py-1 bg-dark-800 border border-dark-700 rounded-lg text-sm text-dark-300">{sortDir === 'asc' ? '\u2191' : '\u2193'}</button>
            </div>
          </div>

          {viewMode === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4">
              {filtered.slice(0, 300).map(m => <MovieCard key={m.id} movie={m} isSelected={selected.has(m.id)} onToggle={() => toggleSelect(m.id)} />)}
            </div>
          ) : (
            <div className="bg-dark-800 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-dark-700">
                  <th className="p-3 text-left w-10"><input type="checkbox" onChange={selectAll} checked={selected.size > 0 && selected.size === filtered.length} className="rounded bg-dark-700 border-dark-600" /></th>
                  <th className="p-3 text-left w-12"></th>
                  <th className="p-3 text-left text-dark-400 font-medium">Title</th>
                  <th className="p-3 text-left text-dark-400 font-medium w-16">Year</th>
                  <th className="p-3 text-left text-dark-400 font-medium w-24">Quality</th>
                  <th className="p-3 text-left text-dark-400 font-medium w-24">Video</th>
                  <th className="p-3 text-left text-dark-400 font-medium w-24">Audio</th>
                  <th className="p-3 text-right text-dark-400 font-medium w-20">Size</th>
                </tr></thead>
                <tbody>
                  {filtered.slice(0, 300).map(m => {
                    const poster = getPosterUrl(m.images);
                    return (<tr key={m.id} className="border-b border-dark-700/50 hover:bg-dark-700/30 transition-colors">
                      <td className="p-3"><input type="checkbox" checked={selected.has(m.id)} onChange={() => toggleSelect(m.id)} className="rounded bg-dark-700 border-dark-600" /></td>
                      <td className="p-2">{poster ? <img src={poster} alt="" className="w-8 h-12 object-cover rounded" loading="lazy" /> : <div className="w-8 h-12 bg-dark-700 rounded flex items-center justify-center"><svg className="w-4 h-4 text-dark-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" /></svg></div>}</td>
                      <td className="p-3"><div className="font-medium text-gray-100">{m.title}</div><div className="text-xs text-dark-400 mt-0.5">{m.tags?.map(t => tagMap.get(t)).filter(Boolean).join(', ')}</div></td>
                      <td className="p-3 text-dark-300">{m.year}</td>
                      <td className="p-3">{m.movieFile?.quality?.quality.name ? <span className="px-2 py-0.5 text-xs rounded-full bg-violet-500/15 text-violet-300">{m.movieFile.quality.quality.name}</span> : <span className="text-dark-500">-</span>}</td>
                      <td className="p-3 text-dark-300 text-xs">{m.movieFile?.mediaInfo?.videoCodec || '-'}</td>
                      <td className="p-3 text-dark-300 text-xs">{m.movieFile?.mediaInfo ? m.movieFile.mediaInfo.audioCodec + ' ' + m.movieFile.mediaInfo.audioChannels : '-'}</td>
                      <td className="p-3 text-right text-dark-300 text-xs">{m.sizeOnDisk ? formatBytes(m.sizeOnDisk) : '-'}</td>
                    </tr>);
                  })}
                </tbody>
              </table>
            </div>
          )}
          {filtered.length > 300 && <div className="p-3 text-center text-dark-400 text-sm mt-2">Showing first 300 of {filtered.length}</div>}
        </div>
      </div>
    </div>
  );
}

// ---- Series Tab (Sonarr library) ----

function SeriesTab() {
  const navigate = useNavigate();
  const [series, setSeries] = useState<SonarrSeries[]>([]);
  const [tags, setTags] = useState<{ id: number; label: string }[]>([]);
  const [filterOpts, setFilterOpts] = useState<SonarrFilterOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [cachedAt, setCachedAt] = useState('');

  const [search, setSearch] = useState('');
  const [monitoredOnly, setMonitoredOnly] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedNetworks, setSelectedNetworks] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [sortBy, setSortBy] = useState<SortField>('title');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showFilters, setShowFilters] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  const loadData = useCallback((data: SonarrLibraryResponse) => {
    setSeries(data.series || []);
    setTags(data.tags || []);
    setFilterOpts(data.filter_options);
    if (data.cached_at) setCachedAt(data.cached_at);
  }, []);

  useEffect(() => {
    getSonarrLibrary()
      .then(loadData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError('');
    try {
      const data = await refreshSonarrLibrary();
      loadData(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const filtered = useMemo(() => {
    let list = [...series];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s => s.title.toLowerCase().includes(q));
    }
    if (monitoredOnly) list = list.filter(s => s.monitored);
    if (selectedGenres.length > 0) list = list.filter(s => s.genres?.some(g => selectedGenres.includes(g)));
    if (selectedNetworks.length > 0) list = list.filter(s => s.network && selectedNetworks.includes(s.network));
    if (selectedTags.length > 0) list = list.filter(s => s.tags?.some(t => selectedTags.includes(t)));
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'title': cmp = a.title.localeCompare(b.title); break;
        case 'year': cmp = a.year - b.year; break;
        case 'size': cmp = (a.statistics?.sizeOnDisk || 0) - (b.statistics?.sizeOnDisk || 0); break;
        case 'added': cmp = (a.added || '').localeCompare(b.added || ''); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [series, search, monitoredOnly, selectedGenres, selectedNetworks, selectedTags, sortBy, sortDir]);

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(s => s.id)));
  };

  const handleNormalize = () => {
    navigate('/normalize?source=sonarr&ids=' + Array.from(selected).join(','));
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="text-dark-400">Loading series...</div></div>;

  if (error && series.length === 0) {
    if (error.includes('not configured') || error.includes('Sonarr') || series.length === 0) {
      return (
        <div className="text-center py-12">
          <p className="text-dark-400 mb-3">Sonarr is not configured yet.</p>
          <a href="/settings" className="text-violet-400 hover:text-violet-300 text-sm font-medium">Go to Settings to connect Sonarr</a>
        </div>
      );
    }
    return <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">{error}</div>;
  }

  const tagMap = new Map(tags.map(t => [t.id, t.label]));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          {cachedAt && <span className="text-xs text-dark-400">Updated {timeAgo(cachedAt)}</span>}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleRefresh} disabled={refreshing} className="p-2 rounded-lg bg-dark-800 text-dark-300 hover:text-gray-100 transition-colors disabled:opacity-50" title="Refresh from Sonarr">
            <svg className={'w-4 h-4' + (refreshing ? ' animate-spin' : '')} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
          <button onClick={() => setShowFilters(!showFilters)} className="px-3 py-1.5 text-sm rounded-lg bg-dark-800 text-dark-300 hover:text-gray-100">{showFilters ? 'Hide Filters' : 'Show Filters'}</button>
          <div className="flex rounded-lg overflow-hidden border border-dark-700">
            <button onClick={() => setViewMode('grid')} className={'p-1.5 ' + (viewMode === 'grid' ? 'bg-violet-600 text-white' : 'bg-dark-800 text-dark-300 hover:text-gray-100')} title="Grid view">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
            </button>
            <button onClick={() => setViewMode('list')} className={'p-1.5 ' + (viewMode === 'list' ? 'bg-violet-600 text-white' : 'bg-dark-800 text-dark-300 hover:text-gray-100')} title="List view">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" /></svg>
            </button>
          </div>
          {selected.size > 0 && <button onClick={handleNormalize} className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-sm font-medium transition-colors">Normalize Selected ({selected.size})</button>}
        </div>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm mb-4">{error}</div>}

      <div className="flex gap-6">
        {showFilters && (
          <div className="w-64 shrink-0 space-y-4">
            <input type="text" placeholder="Search series..." value={search} onChange={e => setSearch(e.target.value)} className="w-full px-3 py-2 bg-dark-800 border border-dark-700 rounded-lg text-sm text-gray-100 placeholder-dark-400 focus:border-violet-500 focus:outline-none" />
            <div className="bg-dark-800 rounded-lg p-3 space-y-3">
              <label className="flex items-center gap-2 text-sm text-dark-300 cursor-pointer"><input type="checkbox" checked={monitoredOnly} onChange={() => setMonitoredOnly(!monitoredOnly)} className="rounded bg-dark-700 border-dark-600" />Monitored only</label>
            </div>
            {filterOpts && filterOpts.networks.length > 0 && <FilterGroup title="Network" options={filterOpts.networks.sort()} selected={selectedNetworks} onChange={setSelectedNetworks} />}
            {filterOpts && filterOpts.genres.length > 0 && <FilterGroup title="Genre" options={filterOpts.genres.sort()} selected={selectedGenres} onChange={setSelectedGenres} />}
            {tags.length > 0 && (
              <div className="bg-dark-800 rounded-lg p-3">
                <h4 className="text-xs font-semibold text-dark-400 uppercase mb-2">Tags</h4>
                <div className="flex flex-wrap gap-1">
                  {tags.map(t => <button key={t.id} onClick={() => setSelectedTags(prev => prev.includes(t.id) ? prev.filter(x => x !== t.id) : [...prev, t.id])} className={'px-2 py-0.5 text-xs rounded-full border transition-colors ' + (selectedTags.includes(t.id) ? 'bg-violet-500/20 border-violet-500 text-violet-300' : 'bg-dark-700 border-dark-600 text-dark-300 hover:border-dark-500')}>{t.label}</button>)}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-sm text-dark-400">{filtered.length} series</span>
              {filtered.length > 0 && <button onClick={selectAll} className="text-xs text-violet-400 hover:text-violet-300">{selected.size === filtered.length ? 'Deselect all' : 'Select all'}</button>}
            </div>
            <div className="flex items-center gap-2">
              <select value={sortBy} onChange={e => setSortBy(e.target.value as SortField)} className="bg-dark-800 border border-dark-700 rounded-lg px-2 py-1 text-sm text-gray-100">
                <option value="title">Title</option><option value="year">Year</option><option value="size">Size</option><option value="added">Date Added</option>
              </select>
              <button onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')} className="px-2 py-1 bg-dark-800 border border-dark-700 rounded-lg text-sm text-dark-300">{sortDir === 'asc' ? '\u2191' : '\u2193'}</button>
            </div>
          </div>

          {viewMode === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4">
              {filtered.slice(0, 300).map(s => <SeriesCard key={s.id} series={s} isSelected={selected.has(s.id)} onToggle={() => toggleSelect(s.id)} />)}
            </div>
          ) : (
            <div className="bg-dark-800 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-dark-700">
                  <th className="p-3 text-left w-10"><input type="checkbox" onChange={selectAll} checked={selected.size > 0 && selected.size === filtered.length} className="rounded bg-dark-700 border-dark-600" /></th>
                  <th className="p-3 text-left w-12"></th>
                  <th className="p-3 text-left text-dark-400 font-medium">Title</th>
                  <th className="p-3 text-left text-dark-400 font-medium w-16">Year</th>
                  <th className="p-3 text-left text-dark-400 font-medium w-24">Network</th>
                  <th className="p-3 text-center text-dark-400 font-medium w-24">Seasons</th>
                  <th className="p-3 text-center text-dark-400 font-medium w-24">Episodes</th>
                  <th className="p-3 text-right text-dark-400 font-medium w-20">Size</th>
                </tr></thead>
                <tbody>
                  {filtered.slice(0, 300).map(s => {
                    const poster = getPosterUrl(s.images);
                    const stats = s.statistics;
                    return (<tr key={s.id} className="border-b border-dark-700/50 hover:bg-dark-700/30 transition-colors">
                      <td className="p-3"><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} className="rounded bg-dark-700 border-dark-600" /></td>
                      <td className="p-2">{poster ? <img src={poster} alt="" className="w-8 h-12 object-cover rounded" loading="lazy" /> : <div className="w-8 h-12 bg-dark-700 rounded flex items-center justify-center"><svg className="w-4 h-4 text-dark-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" /></svg></div>}</td>
                      <td className="p-3"><div className="font-medium text-gray-100">{s.title}</div><div className="text-xs text-dark-400 mt-0.5">{s.tags?.map(t => tagMap.get(t)).filter(Boolean).join(', ')}</div></td>
                      <td className="p-3 text-dark-300">{s.year}</td>
                      <td className="p-3 text-dark-300 text-xs">{s.network || '-'}</td>
                      <td className="p-3 text-center text-dark-300 text-xs">{stats?.seasonCount ?? s.seasons?.length ?? '-'}</td>
                      <td className="p-3 text-center text-dark-300 text-xs">{stats ? `${stats.episodeFileCount}/${stats.totalEpisodeCount}` : '-'}</td>
                      <td className="p-3 text-right text-dark-300 text-xs">{stats?.sizeOnDisk ? formatBytes(stats.sizeOnDisk) : '-'}</td>
                    </tr>);
                  })}
                </tbody>
              </table>
            </div>
          )}
          {filtered.length > 300 && <div className="p-3 text-center text-dark-400 text-sm mt-2">Showing first 300 of {filtered.length}</div>}
        </div>
      </div>
    </div>
  );
}

// ---- Shared components ----

function MovieCard({ movie, isSelected, onToggle }: { movie: LibraryMovie; isSelected: boolean; onToggle: () => void }) {
  const poster = getPosterUrl(movie.images);
  const resolution = movie.movieFile?.quality?.quality.resolution;
  const hdr = movie.movieFile?.mediaInfo?.videoDynamicRange;
  const videoCodec = movie.movieFile?.mediaInfo?.videoCodec;
  const audioCodec = movie.movieFile?.mediaInfo?.audioCodec;
  const audioChannels = movie.movieFile?.mediaInfo?.audioChannels;
  const resLabel = resolution === 2160 ? '4K' : resolution ? resolution + 'p' : null;

  return (
    <div className={'group rounded-lg overflow-hidden bg-dark-800 border-2 transition-all cursor-pointer ' + (isSelected ? 'border-violet-500 ring-1 ring-violet-500/30' : 'border-transparent hover:border-dark-600')} onClick={onToggle}>
      <div className="aspect-[2/3] relative bg-dark-700">
        {poster ? <img src={poster} alt={movie.title} className="w-full h-full object-cover" loading="lazy" /> : (
          <div className="w-full h-full flex items-center justify-center"><svg className="w-12 h-12 text-dark-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" /></svg></div>
        )}
        <div className={'absolute top-2 left-2 transition-opacity ' + (isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
          <div className={'w-5 h-5 rounded border-2 flex items-center justify-center ' + (isSelected ? 'bg-violet-500 border-violet-500' : 'bg-dark-900/70 border-dark-400')}>
            {isSelected && <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
          </div>
        </div>
        <div className="absolute top-2 right-2 flex flex-col gap-1">
          {resLabel && <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-violet-600/90 text-white backdrop-blur-sm">{resLabel}</span>}
          {hdr && hdr !== 'SDR' && hdr !== '' && <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-500/90 text-white backdrop-blur-sm">{hdr}</span>}
        </div>
      </div>
      <div className="px-2 pt-2 pb-2">
        <div className="text-[13px] font-medium text-gray-100 leading-tight line-clamp-2">{movie.title}</div>
        <div className="text-xs text-dark-400 mt-1">
          {movie.year}{movie.runtime ? <> &middot; {movie.runtime}m</> : null}
        </div>
        {(videoCodec || audioCodec || movie.sizeOnDisk) && (
          <div className="text-[11px] text-dark-500 mt-0.5 truncate">
            {videoCodec}{audioCodec ? <>{videoCodec ? ' \u00b7 ' : ''}{audioCodec}{audioChannels ? ' ' + audioChannels : ''}</> : null}{movie.sizeOnDisk ? <>{(videoCodec || audioCodec) ? ' \u00b7 ' : ''}{formatBytes(movie.sizeOnDisk)}</> : null}
          </div>
        )}
      </div>
    </div>
  );
}

function SeriesCard({ series, isSelected, onToggle }: { series: SonarrSeries; isSelected: boolean; onToggle: () => void }) {
  const poster = getPosterUrl(series.images);
  const stats = series.statistics;
  const seasonCount = stats?.seasonCount ?? series.seasons?.length;

  return (
    <div className={'group rounded-lg overflow-hidden bg-dark-800 border-2 transition-all cursor-pointer ' + (isSelected ? 'border-violet-500 ring-1 ring-violet-500/30' : 'border-transparent hover:border-dark-600')} onClick={onToggle}>
      <div className="aspect-[2/3] relative bg-dark-700">
        {poster ? <img src={poster} alt={series.title} className="w-full h-full object-cover" loading="lazy" /> : (
          <div className="w-full h-full flex items-center justify-center"><svg className="w-12 h-12 text-dark-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" /></svg></div>
        )}
        <div className={'absolute top-2 left-2 transition-opacity ' + (isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
          <div className={'w-5 h-5 rounded border-2 flex items-center justify-center ' + (isSelected ? 'bg-violet-500 border-violet-500' : 'bg-dark-900/70 border-dark-400')}>
            {isSelected && <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
          </div>
        </div>
        <div className="absolute top-2 right-2 flex flex-col gap-1">
          {seasonCount != null && <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-violet-600/90 text-white backdrop-blur-sm">S{seasonCount}</span>}
          {stats && <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-dark-900/80 text-dark-200 backdrop-blur-sm">{stats.episodeFileCount} eps</span>}
        </div>
      </div>
      <div className="px-2 pt-2 pb-2">
        <div className="text-[13px] font-medium text-gray-100 leading-tight line-clamp-2">{series.title}</div>
        <div className="text-xs text-dark-400 mt-1">
          {series.year}{series.network ? <> &middot; {series.network}</> : null}
        </div>
        {stats?.sizeOnDisk ? (
          <div className="text-[11px] text-dark-500 mt-0.5">{formatBytes(stats.sizeOnDisk)}</div>
        ) : null}
      </div>
    </div>
  );
}

function FilterGroup({ title, options, selected, onChange }: { title: string; options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="bg-dark-800 rounded-lg p-3">
      <h4 className="text-xs font-semibold text-dark-400 uppercase mb-2">{title}</h4>
      <div className="flex flex-wrap gap-1">
        {options.map(opt => <button key={opt} onClick={() => onChange(selected.includes(opt) ? selected.filter(x => x !== opt) : [...selected, opt])} className={'px-2 py-0.5 text-xs rounded-full border transition-colors ' + (selected.includes(opt) ? 'bg-violet-500/20 border-violet-500 text-violet-300' : 'bg-dark-700 border-dark-600 text-dark-300 hover:border-dark-500')}>{opt}</button>)}
      </div>
    </div>
  );
}
