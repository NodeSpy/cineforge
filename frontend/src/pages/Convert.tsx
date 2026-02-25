import { useState, useCallback, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import FileUpload from '../components/FileUpload';
import ProgressBar from '../components/ProgressBar';
import TagSelector from '../components/TagSelector';
import {
  convertTitlesStream,
  resumeConvertStream,
  importMovies,
  getConfig,
  listConversions,
  getConversion,
  updateConversionSelection,
  type ConvertMatch,
  type ImportItem,
  type Job,
  type StreamCallbacks,
} from '../api/client';

type Step = 'upload' | 'matching' | 'review' | 'importing' | 'done';

export default function Convert() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [step, setStep] = useState<Step>('upload');
  const [results, setResults] = useState<ConvertMatch[]>([]);
  const [selections, setSelections] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [checkingSession, setCheckingSession] = useState(true);
  const [tags, setTags] = useState<number[]>([]);

  // Streaming progress state
  const [totalItems, setTotalItems] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [currentStatus, setCurrentStatus] = useState('');
  const [throttleMsg, setThrottleMsg] = useState('');
  const [streamLog, setStreamLog] = useState<Array<{ title: string; year: string; status: string; matchTitle?: string; matchId?: number }>>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the log
  useEffect(() => {
    if (step === 'matching' && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [streamLog, step]);

  // Check for existing sessions on mount
  useEffect(() => {
    checkExistingSessions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function checkExistingSessions() {
    try {
      // Check URL param first
      const paramSessionId = searchParams.get('session');
      if (paramSessionId) {
        setSearchParams({}, { replace: true });
        await resumeSession(paramSessionId);
        return;
      }

      // Auto-detect the first ready or matching session
      const sessions = await listConversions();
      const resumable = sessions.find(s => s.status === 'ready' || s.status === 'matching');
      if (resumable) {
        await resumeSession(resumable.id);
        return;
      }
    } catch {
      // No sessions or error - just show upload
    } finally {
      setCheckingSession(false);
    }
  }

  async function resumeSession(sid: string) {
    try {
      const session = await getConversion(sid);
      setSessionId(sid);
      setSessionName(session.name);

      if (session.status === 'ready' && session.items && session.items.length > 0) {
        // Session is ready for review - load items
        const matches: ConvertMatch[] = session.items.map(item => ({
          original_title: item.original_title,
          original_year: item.original_year,
          matches: item.matches || [],
          best_match: item.matches?.find(m => m.id === item.selected_tmdb_id),
          status: item.status,
        }));
        setResults(matches);

        const sel = new Map<number, number>();
        session.items.forEach(item => {
          if (item.selected_tmdb_id > 0) {
            sel.set(item.item_index, item.selected_tmdb_id);
          }
        });
        setSelections(sel);
        setStep('review');
      } else if (session.status === 'matching') {
        // Session is still matching - try to resume the SSE stream
        setCheckingSession(false);
        await resumeMatchingSession(sid, session.matched);
        return;
      } else {
        setStep('upload');
      }
    } catch {
      setError('Failed to resume session');
      setStep('upload');
    } finally {
      setCheckingSession(false);
    }
  }

  async function resumeMatchingSession(sid: string, priorMatched: number) {
    setStep('matching');
    setLoading(true);
    setCurrentStatus('Resuming...');

    const accumulated: ConvertMatch[] = [];
    const sel = new Map<number, number>();

    try {
      await resumeConvertStream(sid, {
        onProgress(total, _sessionId) {
          setTotalItems(total);
          setCurrentStatus(`Resuming: processing remaining items of ${total}...`);
        },

        onResult(index, match) {
          accumulated.push(match);
          setResults(prev => [...prev, match]);
          setProcessedCount(prev => prev + 1);
          setThrottleMsg('');

          const logEntry = {
            title: match.original_title,
            year: match.original_year,
            status: match.status,
            matchTitle: match.best_match?.title,
            matchId: match.best_match?.id,
          };
          setStreamLog(prev => [...prev, logEntry]);

          if (match.best_match) {
            sel.set(index, match.best_match.id);
          }
        },

        onThrottle(waitSeconds, reason) {
          setThrottleMsg(`Backing off for ${waitSeconds.toFixed(0)}s — ${reason}`);
        },

        onDone(_total, matched, _sessionId) {
          // Load the full session to get all items including previously matched ones
          getConversion(sid).then(fullSession => {
            if (fullSession.items && fullSession.items.length > 0) {
              const allMatches: ConvertMatch[] = fullSession.items.map(item => ({
                original_title: item.original_title,
                original_year: item.original_year,
                matches: item.matches || [],
                best_match: item.matches?.find(m => m.id === item.selected_tmdb_id),
                status: item.status,
              }));
              setResults(allMatches);

              const allSel = new Map<number, number>();
              fullSession.items.forEach(item => {
                if (item.selected_tmdb_id > 0) {
                  allSel.set(item.item_index, item.selected_tmdb_id);
                }
              });
              setSelections(allSel);
            }
            setStep('review');
          }).catch(() => {
            setSelections(new Map(sel));
            setStep('review');
          });
        },

        onError(errMsg) {
          setError(errMsg);
          setStep('upload');
        },
      } as StreamCallbacks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resume failed');
      setStep('upload');
    } finally {
      setLoading(false);
    }
  }

  async function handleFileLoaded(data: unknown[], fileName: string) {
    setError('');
    setStep('matching');
    setLoading(true);
    setResults([]);
    setStreamLog([]);
    setProcessedCount(0);
    setTotalItems(0);
    setCurrentStatus('Starting...');
    setThrottleMsg('');
    setSessionName(fileName);

    const accumulated: ConvertMatch[] = [];
    const sel = new Map<number, number>();

    try {
      await convertTitlesStream(data as Record<string, unknown>[], {
        onProgress(total, sid) {
          setTotalItems(total);
          setSessionId(sid);
          setCurrentStatus(`Processing 0 of ${total}...`);
        },

        onResult(index, match) {
          accumulated.push(match);
          setResults([...accumulated]);
          setProcessedCount(accumulated.length);
          setThrottleMsg('');

          const logEntry = {
            title: match.original_title,
            year: match.original_year,
            status: match.status,
            matchTitle: match.best_match?.title,
            matchId: match.best_match?.id,
          };
          setStreamLog(prev => [...prev, logEntry]);

          setCurrentStatus(`Processing ${accumulated.length} of ${data.length}...`);

          if (match.best_match) {
            sel.set(index, match.best_match.id);
          }
        },

        onThrottle(waitSeconds, reason) {
          setThrottleMsg(`Backing off for ${waitSeconds.toFixed(0)}s — ${reason}`);
          setCurrentStatus(`Rate limited, waiting ${waitSeconds.toFixed(0)}s...`);
        },

        onDone(_total, _matched, sid) {
          setSessionId(sid);
          setSelections(new Map(sel));
          setResults([...accumulated]);
          setStep('review');
        },

        onError(errMsg) {
          setError(errMsg);
          setStep('upload');
        },
      } as StreamCallbacks, fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed');
      setStep('upload');
    } finally {
      setLoading(false);
    }
  }

  function selectMatch(index: number, tmdbId: number) {
    setSelections(prev => {
      const next = new Map(prev);
      if (next.get(index) === tmdbId) {
        next.delete(index);
      } else {
        next.set(index, tmdbId);
      }
      return next;
    });

    // Persist to DB
    if (sessionId) {
      updateConversionSelection(sessionId, index, tmdbId).catch(() => {});
    }
  }

  function exportJSON() {
    const exportItems = Array.from(selections.entries()).map(([i, tmdbId]) => {
      const match = results[i]?.matches?.find(m => m.id === tmdbId);
      return {
        tmdb_id: tmdbId,
        title: match?.title || results[i]?.original_title,
        year: match?.release_date?.substring(0, 4) || results[i]?.original_year,
      };
    });

    const blob = new Blob([JSON.stringify(exportItems, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'radarr-import.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport() {
    const items: ImportItem[] = Array.from(selections.entries()).map(([i, tmdbId]) => {
      const match = results[i]?.matches?.find(m => m.id === tmdbId);
      return {
        tmdb_id: tmdbId,
        imdb_id: '',
        title: match?.title || results[i]?.original_title,
      };
    });

    if (items.length === 0) {
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
      const res = await importMovies(items, sessionId || undefined, tags.length > 0 ? tags : undefined);
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
    setResults([]);
    setSelections(new Map());
    setError('');
    setJobId('');
    setSessionId('');
    setSessionName('');
    setStreamLog([]);
    setProcessedCount(0);
    setTotalItems(0);
    setCurrentStatus('');
    setThrottleMsg('');
    setTags([]);
  }

  const selectedCount = selections.size;
  const pct = totalItems > 0 ? Math.round((processedCount / totalItems) * 100) : 0;

  if (checkingSession) {
    return (
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Convert & Import</h2>
          <p className="text-dark-400 mt-1">Checking for active sessions...</p>
        </div>
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-radarr-500 border-t-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-100">Convert & Import</h2>
        <p className="text-dark-400 mt-1">
          Upload any JSON file with movie titles -- we'll look them up on TMDb and let you import to Radarr
        </p>
      </div>

      <div className="bg-dark-800/60 border border-dark-700 rounded-lg px-5 py-3">
        <p className="text-xs text-dark-400 leading-relaxed">
          This tool is designed for bulk importing large collections of individual titles (e.g., classic Disney shorts, Looney Tunes episodes) into Radarr using JSON files with TMDb or IMDb IDs. For day-to-day use, the <a href="/library" className="text-violet-400 hover:underline">Library</a> and <a href="/normalize" className="text-teal-400 hover:underline">Normalize</a> pages are your primary tools.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {['Upload', 'Match', 'Review', 'Import'].map((label, i) => {
          const stepMap: Record<Step, number> = { upload: 0, matching: 1, review: 2, importing: 3, done: 3 };
          const isActive = i <= stepMap[step];
          return (
            <div key={label} className="flex items-center gap-2">
              {i > 0 && <div className={`w-10 h-px ${isActive ? 'bg-radarr-500' : 'bg-dark-700'}`} />}
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                isActive ? 'bg-radarr-500/15 text-radarr-400' : 'bg-dark-800 text-dark-500'
              }`}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {step === 'upload' && (
        <FileUpload
          onFileLoaded={handleFileLoaded}
          description="Any JSON array with objects containing title, year, season, air_date, or similar fields"
        />
      )}

      {step === 'matching' && (
        <div className="space-y-4">
          {/* Progress header */}
          <div className="bg-dark-900 border border-dark-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-gray-200">{currentStatus}</h3>
                {throttleMsg && (
                  <p className="text-xs text-yellow-400 mt-1 flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                    </svg>
                    {throttleMsg}
                  </p>
                )}
              </div>
              <span className="text-2xl font-bold text-radarr-400">{pct}%</span>
            </div>

            <div className="w-full bg-dark-800 rounded-full h-2.5 overflow-hidden">
              <div
                className="h-full rounded-full bg-radarr-500 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>

            <div className="flex items-center gap-4 text-xs text-dark-400">
              <span>{processedCount} of {totalItems} processed</span>
              {streamLog.filter(l => l.status === 'matched').length > 0 && (
                <span className="text-green-400">
                  {streamLog.filter(l => l.status === 'matched').length} matched
                </span>
              )}
              {streamLog.filter(l => l.status === 'not_found').length > 0 && (
                <span className="text-red-400">
                  {streamLog.filter(l => l.status === 'not_found').length} not found
                </span>
              )}
              {streamLog.filter(l => l.status === 'multiple').length > 0 && (
                <span className="text-yellow-400">
                  {streamLog.filter(l => l.status === 'multiple').length} multiple
                </span>
              )}
            </div>
          </div>

          {/* Scrollable result log */}
          <div className="bg-dark-900 border border-dark-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-dark-800 flex items-center justify-between">
              <h4 className="text-xs font-medium text-dark-400 uppercase tracking-wider">Live Results</h4>
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            </div>
            <div className="max-h-80 overflow-auto divide-y divide-dark-800/50">
              {streamLog.map((entry, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-2 text-sm">
                  <span className="text-dark-600 text-xs font-mono w-8 text-right flex-shrink-0">
                    {i + 1}
                  </span>
                  <StatusDot status={entry.status} />
                  <span className="text-gray-300 truncate min-w-0">
                    {entry.title}
                    {entry.year && <span className="text-dark-500 ml-1">({entry.year})</span>}
                  </span>
                  {entry.matchTitle ? (
                    <span className="text-dark-400 text-xs truncate ml-auto flex-shrink-0 max-w-[200px]">
                      {entry.matchTitle} #{entry.matchId}
                    </span>
                  ) : (
                    <span className="text-red-400/60 text-xs ml-auto flex-shrink-0">no match</span>
                  )}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          {sessionName && (
            <p className="text-sm text-dark-500">Session: {sessionName}</p>
          )}

          <div className="flex items-center justify-between">
            <p className="text-sm text-dark-400">
              {selectedCount} of {results.length} titles selected
            </p>
            <div className="flex gap-3">
              <button onClick={reset} className="px-4 py-2 bg-dark-800 hover:bg-dark-700 border border-dark-600 rounded-lg text-sm font-medium text-gray-300 transition-colors">
                Start Over
              </button>
              <button onClick={exportJSON} disabled={selectedCount === 0} className="px-4 py-2 bg-dark-800 hover:bg-dark-700 border border-dark-600 rounded-lg text-sm font-medium text-gray-300 transition-colors disabled:opacity-40">
                Export JSON
              </button>
              <button onClick={handleImport} disabled={selectedCount === 0 || loading} className="px-5 py-2 bg-radarr-500 hover:bg-radarr-600 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-40">
                {loading ? 'Starting...' : `Import ${selectedCount} Movies`}
              </button>
            </div>
          </div>

          <TagSelector selectedTags={tags} onChange={setTags} />

          <div className="space-y-3">
            {results.map((result, i) => (
              <ConvertResultRow
                key={i}
                result={result}
                selectedTmdbId={selections.get(i)}
                onSelect={(tmdbId) => selectMatch(i, tmdbId)}
              />
            ))}
          </div>
        </div>
      )}

      {(step === 'importing' || step === 'done') && jobId && (
        <div className="space-y-4">
          <ProgressBar jobId={jobId} onComplete={handleJobComplete} />
          {step === 'done' && (
            <div className="flex justify-center pt-4">
              <button onClick={reset} className="px-6 py-2.5 bg-radarr-500 hover:bg-radarr-600 rounded-lg text-sm font-semibold text-white transition-colors">
                Convert More
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    matched: 'bg-green-500',
    multiple: 'bg-yellow-500',
    not_found: 'bg-red-500',
  };
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${colors[status] || 'bg-dark-600'}`} />;
}

interface ConvertResultRowProps {
  result: ConvertMatch;
  selectedTmdbId?: number;
  onSelect: (tmdbId: number) => void;
}

function ConvertResultRow({ result, selectedTmdbId, onSelect }: ConvertResultRowProps) {
  const [expanded, setExpanded] = useState(result.status === 'multiple');

  const statusColors: Record<string, string> = {
    matched: 'border-green-500/30',
    multiple: 'border-yellow-500/30',
    not_found: 'border-red-500/30',
  };

  return (
    <div className={`bg-dark-900 border rounded-xl overflow-hidden ${statusColors[result.status] || 'border-dark-800'}`}>
      <div
        className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-dark-800/50 transition-colors"
        onClick={() => result.matches.length > 1 && setExpanded(!expanded)}
      >
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex-shrink-0">
            {selectedTmdbId ? (
              <div className="w-8 h-8 bg-green-500/15 border border-green-500/30 rounded-full flex items-center justify-center">
                <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </div>
            ) : (
              <div className="w-8 h-8 bg-dark-800 border border-dark-700 rounded-full flex items-center justify-center">
                <svg className="w-4 h-4 text-dark-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-200 truncate">
              {result.original_title}
              {result.original_year && <span className="text-dark-400 ml-2">({result.original_year})</span>}
            </p>
            {result.best_match && (
              <p className="text-xs text-dark-400 truncate">
                Matched: {result.best_match.title} ({result.best_match.release_date?.substring(0, 4) || '?'})
                — TMDb #{result.best_match.id}
              </p>
            )}
            {result.status === 'not_found' && (
              <p className="text-xs text-red-400">No matches found on TMDb</p>
            )}
          </div>
        </div>

        {result.matches.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-dark-500">{result.matches.length} matches</span>
            <svg className={`w-4 h-4 text-dark-500 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </div>
        )}
      </div>

      {expanded && result.matches.length > 0 && (
        <div className="border-t border-dark-800 divide-y divide-dark-800">
          {result.matches.map(match => (
            <div
              key={match.id}
              onClick={() => onSelect(match.id)}
              className={`flex items-center gap-4 px-5 py-3 cursor-pointer transition-colors ${
                selectedTmdbId === match.id
                  ? 'bg-radarr-500/10'
                  : 'hover:bg-dark-800/50'
              }`}
            >
              <input
                type="radio"
                checked={selectedTmdbId === match.id}
                onChange={() => onSelect(match.id)}
                className="text-radarr-500 focus:ring-radarr-500 focus:ring-offset-0 bg-dark-800 border-dark-600"
              />
              {match.poster_path ? (
                <img
                  src={`https://image.tmdb.org/t/p/w92${match.poster_path}`}
                  alt={match.title}
                  className="w-10 h-14 object-cover rounded"
                />
              ) : (
                <div className="w-10 h-14 bg-dark-800 rounded" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-200">
                  {match.title}
                  <span className="text-dark-400 ml-2">
                    ({match.release_date?.substring(0, 4) || '?'})
                  </span>
                </p>
                <p className="text-xs text-dark-500 line-clamp-2">{match.overview}</p>
              </div>
              <span className="text-xs text-dark-500 flex-shrink-0">#{match.id}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
