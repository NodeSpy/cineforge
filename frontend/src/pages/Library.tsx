import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  getLibrary, refreshLibrary, LibraryMovie, RadarrTag, FilterOptions,
  getSonarrLibrary, refreshSonarrLibrary, SonarrSeries, SonarrFilterOptions,
  getSonarrSeriesDetail,
  type SonarrLibraryResponse, type SonarrEpisode, type SonarrEpisodeFile,
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

const PAGE_SIZE = 60;

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

// ---- Shared: Pagination ----

function Pagination({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  const pages: (number | '...')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }
  return (
    <div className="flex items-center justify-center gap-1.5 pt-6 pb-2">
      <button onClick={() => onPageChange(page - 1)} disabled={page <= 1} className="px-3 py-1.5 bg-dark-800 border border-dark-700 rounded-lg text-sm text-dark-300 hover:text-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">Prev</button>
      {pages.map((p, i) =>
        p === '...' ? <span key={'e' + i} className="px-2 text-dark-500">...</span> : (
          <button key={p} onClick={() => onPageChange(p)} className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${p === page ? 'bg-violet-600 text-white' : 'bg-dark-800 text-dark-300 hover:text-gray-100 border border-dark-700'}`}>{p}</button>
        )
      )}
      <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className="px-3 py-1.5 bg-dark-800 border border-dark-700 rounded-lg text-sm text-dark-300 hover:text-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">Next</button>
    </div>
  );
}

// ---- Shared: Filter Drawer ----

function FilterDrawer({ open, onClose, children, activeCount }: { open: boolean; onClose: () => void; children: React.ReactNode; activeCount: number }) {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  return (
    <>
      {open && <div className="fixed inset-0 bg-dark-950/60 z-30 transition-opacity" onClick={onClose} />}
      <div
        ref={drawerRef}
        className={`fixed top-0 left-0 bottom-0 w-72 bg-dark-900 border-r border-dark-700 z-40 overflow-y-auto transition-transform duration-300 ease-in-out ${open ? 'translate-x-64' : '-translate-x-full pointer-events-none'}`}
      >
        <div className="p-4 border-b border-dark-700 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
            Filters
            {activeCount > 0 && <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-violet-500 text-white">{activeCount}</span>}
          </h3>
          <button onClick={onClose} className="p-1 rounded text-dark-400 hover:text-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-4 space-y-4">
          {children}
        </div>
      </div>
    </>
  );
}

function FilterToggleButton({ onClick, activeCount }: { onClick: () => void; activeCount: number }) {
  return (
    <button onClick={onClick} className="relative p-2 rounded-lg bg-dark-800 text-dark-300 hover:text-gray-100 transition-colors" title="Filters">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
      {activeCount > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-violet-500 text-[10px] text-white flex items-center justify-center">{activeCount}</span>}
    </button>
  );
}

// ---- Movies Tab ----

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
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [page, setPage] = useState(1);

  const activeFilterCount = useMemo(() => {
    let c = 0;
    if (!hasFileOnly) c++;
    if (monitoredOnly) c++;
    if (!hideNormalized) c++;
    c += selectedCodecs.length + selectedAudioCodecs.length + selectedGenres.length + selectedTags.length;
    if (search) c++;
    return c;
  }, [hasFileOnly, monitoredOnly, hideNormalized, selectedCodecs, selectedAudioCodecs, selectedGenres, selectedTags, search]);

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

  useEffect(() => { setPage(1); }, [search, hasFileOnly, monitoredOnly, hideNormalized, selectedCodecs, selectedAudioCodecs, selectedGenres, selectedTags, sortBy, sortDir]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSelect = (id: number) => {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
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
      <FilterDrawer open={showFilters} onClose={() => setShowFilters(false)} activeCount={activeFilterCount}>
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
      </FilterDrawer>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          {cachedAt && <span className="text-xs text-dark-400">Updated {timeAgo(cachedAt)}</span>}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleRefresh} disabled={refreshing} className="p-2 rounded-lg bg-dark-800 text-dark-300 hover:text-gray-100 transition-colors disabled:opacity-50" title="Refresh from Radarr">
            <svg className={'w-4 h-4' + (refreshing ? ' animate-spin' : '')} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
          <FilterToggleButton onClick={() => setShowFilters(!showFilters)} activeCount={activeFilterCount} />
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
          {paged.map(m => <MovieCard key={m.id} movie={m} isSelected={selected.has(m.id)} onToggle={() => toggleSelect(m.id)} />)}
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
              {paged.map(m => {
                const poster = getPosterUrl(m.images);
                return (<tr key={m.id} className="border-b border-dark-700/50 hover:bg-dark-700/30 transition-colors">
                  <td className="p-3"><input type="checkbox" checked={selected.has(m.id)} onChange={() => toggleSelect(m.id)} className="rounded bg-dark-700 border-dark-600" /></td>
                  <td className="p-2">{poster ? <img src={poster} alt="" className="w-8 h-12 object-cover rounded" loading="lazy" /> : <div className="w-8 h-12 bg-dark-700 rounded" />}</td>
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
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}

// ---- Series Tab ----

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
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [page, setPage] = useState(1);

  const [detailSeriesId, setDetailSeriesId] = useState<number | null>(null);

  const activeFilterCount = useMemo(() => {
    let c = 0;
    if (monitoredOnly) c++;
    c += selectedGenres.length + selectedNetworks.length + selectedTags.length;
    if (search) c++;
    return c;
  }, [monitoredOnly, selectedGenres, selectedNetworks, selectedTags, search]);

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

  useEffect(() => { setPage(1); }, [search, monitoredOnly, selectedGenres, selectedNetworks, selectedTags, sortBy, sortDir]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSelect = (id: number) => {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
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
    return (
      <div className="text-center py-12">
        <p className="text-dark-400 mb-3">Sonarr is not configured yet.</p>
        <a href="/settings" className="text-violet-400 hover:text-violet-300 text-sm font-medium">Go to Settings to connect Sonarr</a>
      </div>
    );
  }

  if (detailSeriesId !== null) {
    const s = series.find(s => s.id === detailSeriesId);
    if (s) return <SeriesDetailView series={s} onBack={() => setDetailSeriesId(null)} />;
  }

  const tagMap = new Map(tags.map(t => [t.id, t.label]));

  return (
    <div>
      <FilterDrawer open={showFilters} onClose={() => setShowFilters(false)} activeCount={activeFilterCount}>
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
      </FilterDrawer>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          {cachedAt && <span className="text-xs text-dark-400">Updated {timeAgo(cachedAt)}</span>}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleRefresh} disabled={refreshing} className="p-2 rounded-lg bg-dark-800 text-dark-300 hover:text-gray-100 transition-colors disabled:opacity-50" title="Refresh from Sonarr">
            <svg className={'w-4 h-4' + (refreshing ? ' animate-spin' : '')} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
          <FilterToggleButton onClick={() => setShowFilters(!showFilters)} activeCount={activeFilterCount} />
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
          {paged.map(s => <SeriesCard key={s.id} series={s} isSelected={selected.has(s.id)} onToggleSelect={() => toggleSelect(s.id)} onOpen={() => setDetailSeriesId(s.id)} />)}
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
              {paged.map(s => {
                const poster = getPosterUrl(s.images);
                const stats = s.statistics;
                return (<tr key={s.id} className="border-b border-dark-700/50 hover:bg-dark-700/30 transition-colors cursor-pointer" onClick={() => setDetailSeriesId(s.id)}>
                  <td className="p-3" onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} className="rounded bg-dark-700 border-dark-600" /></td>
                  <td className="p-2">{poster ? <img src={poster} alt="" className="w-8 h-12 object-cover rounded" loading="lazy" /> : <div className="w-8 h-12 bg-dark-700 rounded" />}</td>
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
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}

// ---- Series Detail View (drill-down) ----

function SeriesDetailView({ series, onBack }: { series: SonarrSeries; onBack: () => void }) {
  const navigate = useNavigate();
  const [episodes, setEpisodes] = useState<SonarrEpisode[]>([]);
  const [files, setFiles] = useState<SonarrEpisodeFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [expandedSeasons, setExpandedSeasons] = useState<Set<number>>(new Set());

  useEffect(() => {
    setLoading(true);
    getSonarrSeriesDetail(series.id)
      .then(data => {
        setEpisodes(data.episodes || []);
        setFiles(data.files || []);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [series.id]);

  const fileMap = useMemo(() => {
    const m = new Map<number, SonarrEpisodeFile>();
    for (const f of files) m.set(f.id, f);
    return m;
  }, [files]);

  const seasonGroups = useMemo(() => {
    const groups = new Map<number, { episodes: SonarrEpisode[]; totalSize: number; fileCount: number }>();
    for (const ep of episodes) {
      if (!groups.has(ep.seasonNumber)) groups.set(ep.seasonNumber, { episodes: [], totalSize: 0, fileCount: 0 });
      const g = groups.get(ep.seasonNumber)!;
      g.episodes.push(ep);
      if (ep.hasFile && ep.episodeFileId) {
        const f = fileMap.get(ep.episodeFileId);
        if (f) { g.totalSize += f.size; g.fileCount++; }
      }
    }
    return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
  }, [episodes, fileMap]);

  const toggleSeason = (sn: number) => {
    setExpandedSeasons(prev => { const n = new Set(prev); if (n.has(sn)) n.delete(sn); else n.add(sn); return n; });
  };

  const getFilePath = (ep: SonarrEpisode): string | null => {
    if (!ep.hasFile || !ep.episodeFileId) return null;
    const f = fileMap.get(ep.episodeFileId);
    return f?.path || null;
  };

  const toggleFile = (path: string) => {
    setSelectedFiles(prev => { const n = new Set(prev); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  };

  const toggleSeasonFiles = (sn: number) => {
    const g = seasonGroups.find(([s]) => s === sn);
    if (!g) return;
    const paths = g[1].episodes.map(ep => getFilePath(ep)).filter((p): p is string => p !== null);
    const allSelected = paths.every(p => selectedFiles.has(p));
    setSelectedFiles(prev => {
      const n = new Set(prev);
      if (allSelected) paths.forEach(p => n.delete(p));
      else paths.forEach(p => n.add(p));
      return n;
    });
  };

  const selectAllFiles = () => {
    const allPaths = files.filter(f => f.path).map(f => f.path!);
    const allSelected = allPaths.every(p => selectedFiles.has(p));
    setSelectedFiles(allSelected ? new Set() : new Set(allPaths));
  };

  const handleNormalize = () => {
    const items = files
      .filter(f => f.path && selectedFiles.has(f.path))
      .map(f => {
        const ep = episodes.find(e => e.episodeFileId === f.id);
        const title = ep
          ? `${series.title} - S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')} - ${ep.title}`
          : `${series.title} - ${f.relativePath || f.path}`;
        return { title, file_path: f.path!, file_size: f.size, radarr_id: series.id, tmdb_id: 0 };
      });
    sessionStorage.setItem('cineforge:sonarr-detail', JSON.stringify(items));
    navigate('/normalize?source=sonarr-detail');
  };

  const poster = getPosterUrl(series.images);
  const banner = series.images?.find(i => i.coverType === 'fanart');
  const bannerUrl = banner?.remoteUrl || banner?.url || null;

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-dark-400 hover:text-gray-100 transition-colors mb-4">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        Back to series
      </button>

      <div className="relative bg-dark-800 rounded-xl overflow-hidden mb-6">
        {bannerUrl && <div className="absolute inset-0 opacity-20"><img src={bannerUrl} alt="" className="w-full h-full object-cover" /></div>}
        <div className="relative flex gap-6 p-6">
          {poster && <img src={poster} alt={series.title} className="w-32 h-48 object-cover rounded-lg shadow-lg shrink-0" />}
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-bold text-gray-100">{series.title}</h2>
            <div className="flex items-center gap-3 mt-2 text-sm text-dark-300">
              <span>{series.year}</span>
              {series.network && <><span className="text-dark-600">&middot;</span><span>{series.network}</span></>}
              {series.statistics && <><span className="text-dark-600">&middot;</span><span>{series.statistics.seasonCount} seasons</span><span className="text-dark-600">&middot;</span><span>{series.statistics.episodeFileCount} episodes on disk</span></>}
              {series.statistics?.sizeOnDisk ? <><span className="text-dark-600">&middot;</span><span>{formatBytes(series.statistics.sizeOnDisk)}</span></> : null}
            </div>
            {series.overview && <p className="text-sm text-dark-400 mt-3 line-clamp-3">{series.overview}</p>}
            <div className="flex items-center gap-3 mt-4">
              <button onClick={selectAllFiles} className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 border border-dark-600 rounded-lg text-sm text-gray-200 transition-colors">
                {selectedFiles.size > 0 && selectedFiles.size === files.filter(f => f.path).length ? 'Deselect All' : 'Select All Episodes'}
              </button>
              {selectedFiles.size > 0 && (
                <button onClick={handleNormalize} className="px-4 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-sm font-medium transition-colors">
                  Normalize Selected ({selectedFiles.size})
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40 text-dark-400">Loading episodes...</div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">{error}</div>
      ) : (
        <div className="space-y-2">
          {seasonGroups.map(([seasonNum, group]) => {
            const isExpanded = expandedSeasons.has(seasonNum);
            const seasonPaths = group.episodes.map(ep => getFilePath(ep)).filter((p): p is string => p !== null);
            const allSeasonSelected = seasonPaths.length > 0 && seasonPaths.every(p => selectedFiles.has(p));
            const someSeasonSelected = seasonPaths.some(p => selectedFiles.has(p));
            return (
              <div key={seasonNum} className="bg-dark-800 rounded-lg overflow-hidden">
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-dark-700/50 transition-colors"
                  onClick={() => toggleSeason(seasonNum)}
                >
                  <div onClick={e => { e.stopPropagation(); toggleSeasonFiles(seasonNum); }} className="cursor-pointer">
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${allSeasonSelected ? 'bg-violet-500 border-violet-500' : someSeasonSelected ? 'border-violet-400 bg-violet-500/30' : 'border-dark-500 bg-dark-700'}`}>
                      {allSeasonSelected && <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                      {someSeasonSelected && !allSeasonSelected && <div className="w-2 h-2 rounded-sm bg-violet-400" />}
                    </div>
                  </div>
                  <svg className={`w-4 h-4 text-dark-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                  <span className="font-medium text-gray-200">{seasonNum === 0 ? 'Specials' : `Season ${seasonNum}`}</span>
                  <span className="text-xs text-dark-400">{group.fileCount} files</span>
                  {group.totalSize > 0 && <span className="text-xs text-dark-500">{formatBytes(group.totalSize)}</span>}
                </div>
                {isExpanded && (
                  <div className="border-t border-dark-700">
                    {group.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber).map(ep => {
                      const filePath = getFilePath(ep);
                      const file = ep.episodeFileId ? fileMap.get(ep.episodeFileId) : null;
                      const isChecked = filePath ? selectedFiles.has(filePath) : false;
                      return (
                        <div key={ep.id} className={`flex items-center gap-3 px-4 py-2.5 text-sm border-b border-dark-700/40 last:border-b-0 transition-colors ${filePath ? 'hover:bg-dark-700/30' : 'opacity-40'}`}>
                          <div onClick={e => { e.stopPropagation(); if (filePath) toggleFile(filePath); }}>
                            <div className={`w-4 h-4 rounded border flex items-center justify-center ${isChecked ? 'bg-violet-500 border-violet-500' : filePath ? 'border-dark-500 bg-dark-700 cursor-pointer' : 'border-dark-600 bg-dark-800'}`}>
                              {isChecked && <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                            </div>
                          </div>
                          <span className="text-dark-400 w-16 shrink-0 font-mono text-xs">S{String(ep.seasonNumber).padStart(2, '0')}E{String(ep.episodeNumber).padStart(2, '0')}</span>
                          <span className="text-gray-200 flex-1 min-w-0 truncate">{ep.title}</span>
                          {file && file.quality?.quality.name && <span className="px-1.5 py-0.5 text-[10px] rounded bg-violet-500/15 text-violet-300 shrink-0">{file.quality.quality.name}</span>}
                          {file?.mediaInfo?.videoCodec && <span className="text-xs text-dark-500 shrink-0">{file.mediaInfo.videoCodec}</span>}
                          {file ? <span className="text-xs text-dark-400 w-16 text-right shrink-0">{formatBytes(file.size)}</span> : <span className="text-xs text-dark-600 shrink-0">No file</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- Shared card components ----

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
        <div className="text-xs text-dark-400 mt-1">{movie.year}{movie.runtime ? <> &middot; {movie.runtime}m</> : null}</div>
        {(videoCodec || audioCodec || movie.sizeOnDisk) && (
          <div className="text-[11px] text-dark-500 mt-0.5 truncate">
            {videoCodec}{audioCodec ? <>{videoCodec ? ' \u00b7 ' : ''}{audioCodec}{audioChannels ? ' ' + audioChannels : ''}</> : null}{movie.sizeOnDisk ? <>{(videoCodec || audioCodec) ? ' \u00b7 ' : ''}{formatBytes(movie.sizeOnDisk)}</> : null}
          </div>
        )}
      </div>
    </div>
  );
}

function SeriesCard({ series, isSelected, onToggleSelect, onOpen }: { series: SonarrSeries; isSelected: boolean; onToggleSelect: () => void; onOpen: () => void }) {
  const poster = getPosterUrl(series.images);
  const stats = series.statistics;
  const seasonCount = stats?.seasonCount ?? series.seasons?.length;

  return (
    <div className={'group rounded-lg overflow-hidden bg-dark-800 border-2 transition-all cursor-pointer ' + (isSelected ? 'border-violet-500 ring-1 ring-violet-500/30' : 'border-transparent hover:border-dark-600')} onClick={onOpen}>
      <div className="aspect-[2/3] relative bg-dark-700">
        {poster ? <img src={poster} alt={series.title} className="w-full h-full object-cover" loading="lazy" /> : (
          <div className="w-full h-full flex items-center justify-center"><svg className="w-12 h-12 text-dark-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" /></svg></div>
        )}
        <div
          className={'absolute top-2 left-2 transition-opacity z-10 ' + (isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
          onClick={e => { e.stopPropagation(); onToggleSelect(); }}
        >
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
        <div className="text-xs text-dark-400 mt-1">{series.year}{series.network ? <> &middot; {series.network}</> : null}</div>
        {stats?.sizeOnDisk ? <div className="text-[11px] text-dark-500 mt-0.5">{formatBytes(stats.sizeOnDisk)}</div> : null}
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
