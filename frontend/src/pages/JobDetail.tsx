import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getJob, importMovies, reconcileJob, type Job, type JobResult, type ReconciledResult, type ReconcileResponse } from '../api/client';

type Filter = 'all' | 'success' | 'failed' | 'skipped' | 'in_radarr' | 'missing';

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [retrying, setRetrying] = useState(false);
  const [reconciled, setReconciled] = useState<ReconcileResponse | null>(null);
  const [reconciling, setReconciling] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getJob(id)
      .then(setJob)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (job?.reconciled_results && !reconciled) {
      setReconciled(job.reconciled_results);
    }
  }, [job, reconciled]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse bg-dark-900 border border-dark-800 rounded-xl h-24" />
        <div className="animate-pulse bg-dark-900 border border-dark-800 rounded-xl h-64" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="space-y-4">
        <Link to="/" className="text-sm text-dark-400 hover:text-gray-100 transition-colors">&larr; Back to Dashboard</Link>
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          {error || 'Job not found'}
        </div>
      </div>
    );
  }

  const results: (JobResult & { current_status?: string })[] = reconciled
    ? reconciled.results
    : job.results;

  const filtered = filter === 'all'
    ? results
    : filter === 'in_radarr'
    ? results.filter(r => (r as ReconciledResult).current_status === 'in_radarr')
    : filter === 'missing'
    ? results.filter(r => (r as ReconciledResult).current_status === 'missing')
    : results.filter(r => r.status === filter);

  const failedItems = job.results.filter(r => r.status === 'failed');
  const missingItems = reconciled
    ? reconciled.results.filter(r => r.current_status === 'missing' && r.status === 'failed')
    : [];

  const retryItems = reconciled ? missingItems : failedItems;
  const retryLabel = reconciled ? 'Retry Missing' : 'Retry Failed';

  const handleRetry = async () => {
    if (retryItems.length === 0) return;
    setRetrying(true);
    try {
      const items = retryItems
        .filter(r => r.tmdb_id || r.imdb_id)
        .map(r => ({
          tmdb_id: r.tmdb_id || 0,
          imdb_id: r.imdb_id || '',
          title: r.title,
        }));
      if (items.length === 0) {
        setError('No retryable items (missing TMDb/IMDb IDs)');
        return;
      }
      const { job_id } = await importMovies(items, undefined, []);
      navigate(`/jobs/${job_id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  };

  const handleReconcile = async () => {
    if (!id) return;
    setReconciling(true);
    setError('');
    try {
      const data = await reconcileJob(id);
      setReconciled(data);
      if (data.summary.missing > 0) {
        setFilter('missing');
      } else {
        setFilter('all');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Reconcile failed');
    } finally {
      setReconciling(false);
    }
  };

  const statusStyles: Record<string, string> = {
    pending: 'bg-dark-700 text-dark-400',
    running: 'bg-radarr-500/15 text-radarr-400',
    completed: 'bg-green-500/15 text-green-400',
    failed: 'bg-red-500/15 text-red-400',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/" className="text-sm text-dark-400 hover:text-gray-100 transition-colors">&larr; Dashboard</Link>
      </div>

      <div className="bg-dark-900 border border-dark-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-gray-100">
              {job.type === 'import' ? 'Movie Import' : 'Conversion'}
            </h2>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyles[job.status] || statusStyles.pending}`}>
              {job.status}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {job.status === 'completed' && (
              <button
                onClick={handleReconcile}
                disabled={reconciling}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 ${
                  reconciled
                    ? 'bg-dark-800 hover:bg-dark-700 border border-dark-600 text-dark-300'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {reconciling ? 'Checking Radarr...' : reconciled ? 'Re-check Radarr' : 'Reconcile with Radarr'}
              </button>
            )}
            {retryItems.length > 0 && (
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="px-4 py-2 bg-radarr-500 hover:bg-radarr-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
              >
                {retrying ? 'Retrying...' : `${retryLabel} (${retryItems.length})`}
              </button>
            )}
          </div>
        </div>

        <div className={`grid gap-4 ${reconciled ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6' : 'grid-cols-2 sm:grid-cols-4'}`}>
          <div className="bg-dark-800 rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-gray-200">{job.total}</div>
            <div className="text-xs text-dark-400">Total</div>
          </div>
          <div className="bg-dark-800 rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-green-400">{job.succeeded}</div>
            <div className="text-xs text-dark-400">Added</div>
          </div>
          <div className="bg-dark-800 rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-red-400">{job.failed}</div>
            <div className="text-xs text-dark-400">Failed</div>
          </div>
          <div className="bg-dark-800 rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-yellow-400">{job.results.filter(r => r.status === 'skipped').length}</div>
            <div className="text-xs text-dark-400">Skipped</div>
          </div>
          {reconciled && (
            <>
              <div className="bg-dark-800 rounded-lg p-3 text-center border border-green-500/20">
                <div className="text-lg font-bold text-green-400">{reconciled.summary.in_radarr}</div>
                <div className="text-xs text-green-400/70">In Radarr</div>
              </div>
              <div className="bg-dark-800 rounded-lg p-3 text-center border border-orange-500/20">
                <div className="text-lg font-bold text-orange-400">{reconciled.summary.missing}</div>
                <div className="text-xs text-orange-400/70">Still Missing</div>
              </div>
            </>
          )}
        </div>

        <div className="text-xs text-dark-500 mt-3">
          Created {new Date(job.created_at).toLocaleString()}
        </div>
      </div>

      {reconciled && (
        reconciled.summary.missing === 0 ? (
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3 flex items-center gap-3">
            <svg className="w-5 h-5 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <span className="text-sm text-green-400">
              All {reconciled.summary.in_radarr} items are in Radarr. The original import failures were resolved through other means.
            </span>
          </div>
        ) : (
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg px-4 py-3 flex items-center gap-3">
            <svg className="w-5 h-5 text-orange-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <span className="text-sm text-orange-400">
              {reconciled.summary.in_radarr} in Radarr, {reconciled.summary.missing} still missing.
            </span>
          </div>
        )
      )}

      {error && <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">{error}</div>}

      <div className="flex items-center gap-2 border-b border-dark-700 pb-0 flex-wrap">
        {(['all', 'success', 'failed', 'skipped'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ' + (filter === f ? 'border-radarr-500 text-radarr-400' : 'border-transparent text-dark-400 hover:text-gray-100')}
          >
            {f === 'all' ? `All (${results.length})` :
             f === 'success' ? `Added (${job.results.filter(r => r.status === 'success').length})` :
             f === 'failed' ? `Failed (${failedItems.length})` :
             `Skipped (${job.results.filter(r => r.status === 'skipped').length})`}
          </button>
        ))}
        {reconciled && (
          <>
            <button
              onClick={() => setFilter('in_radarr')}
              className={'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ' + (filter === 'in_radarr' ? 'border-green-500 text-green-400' : 'border-transparent text-dark-400 hover:text-gray-100')}
            >
              In Radarr ({reconciled.summary.in_radarr})
            </button>
            <button
              onClick={() => setFilter('missing')}
              className={'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ' + (filter === 'missing' ? 'border-orange-500 text-orange-400' : 'border-transparent text-dark-400 hover:text-gray-100')}
            >
              Missing ({reconciled.summary.missing})
            </button>
          </>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-dark-900 border border-dark-800 rounded-xl p-8 text-center text-dark-500 text-sm">
          No items match this filter.
        </div>
      ) : (
        <div className="bg-dark-900 border border-dark-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col className="w-[40%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
              <col className="w-[15%]" />
              <col className="w-[23%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-dark-700">
                <th className="p-3 text-left text-dark-400 font-medium">Title</th>
                <th className="p-3 text-left text-dark-400 font-medium">TMDb</th>
                <th className="p-3 text-left text-dark-400 font-medium">IMDb</th>
                <th className="p-3 text-left text-dark-400 font-medium">Status</th>
                <th className="p-3 text-left text-dark-400 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((result, i) => (
                <ResultRow key={i} result={result} isReconciled={!!reconciled} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ResultRow({ result, isReconciled }: { result: JobResult & { current_status?: string }; isReconciled: boolean }) {
  const statusStyles: Record<string, string> = {
    success: 'bg-green-500/15 text-green-400',
    failed: 'bg-red-500/15 text-red-400',
    skipped: 'bg-yellow-500/15 text-yellow-400',
  };

  const [showError, setShowError] = useState(false);
  const inRadarr = isReconciled && result.current_status === 'in_radarr';
  const isMissing = isReconciled && result.current_status === 'missing';

  return (
    <>
      <tr className="border-b border-dark-700/50 hover:bg-dark-800/50 transition-colors">
        <td className="p-3 text-gray-100 font-medium truncate">{result.title}</td>
        <td className="p-3 text-dark-300 text-xs font-mono">
          {result.tmdb_id ? (
            <a href={`https://www.themoviedb.org/movie/${result.tmdb_id}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition-colors">
              {result.tmdb_id}
            </a>
          ) : '-'}
        </td>
        <td className="p-3 text-dark-300 text-xs font-mono">
          {result.imdb_id ? (
            <a href={`https://www.imdb.com/title/${result.imdb_id}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition-colors">
              {result.imdb_id}
            </a>
          ) : '-'}
        </td>
        <td className="p-3">
          {inRadarr ? (
            <div className="flex items-center gap-1.5">
              <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/15 text-green-400">in Radarr</span>
              <span className="text-[10px] text-dark-500">{result.status}</span>
            </div>
          ) : isMissing ? (
            <div className="flex items-center gap-1.5">
              <span className="px-2 py-0.5 text-xs rounded-full bg-orange-500/15 text-orange-400">missing</span>
              <span className={`px-2 py-0.5 text-xs rounded-full ${statusStyles[result.status] || 'bg-dark-600 text-dark-300'}`}>
                {result.status}
              </span>
            </div>
          ) : (
            <span className={`px-2 py-0.5 text-xs rounded-full ${statusStyles[result.status] || 'bg-dark-600 text-dark-300'}`}>
              {result.status}
            </span>
          )}
        </td>
        <td className="p-3 text-xs">
          {inRadarr && result.error ? (
            <button
              onClick={() => setShowError(!showError)}
              className="inline-flex items-center gap-1 text-dark-500 hover:text-dark-300 transition-colors cursor-pointer"
            >
              <span>resolved</span>
              <svg className={`w-3 h-3 transition-transform ${showError ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
          ) : (
            <span className={result.error ? 'text-red-400' : 'text-dark-500'}>{result.error ? <span className="truncate block">{result.error}</span> : ''}</span>
          )}
        </td>
      </tr>
      {showError && inRadarr && result.error && (
        <tr>
          <td colSpan={5} className="px-6 py-3 bg-dark-800/80 text-xs text-dark-400 border-l-2 border-dark-600 border-b border-dark-700/50 break-words whitespace-normal">
            <span className="font-medium text-dark-300">Original error: </span>{result.error}
          </td>
        </tr>
      )}
    </>
  );
}
