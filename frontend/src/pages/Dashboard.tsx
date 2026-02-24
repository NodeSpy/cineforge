import { useState, useEffect } from 'react';
import { getRecentJobs, getConfig, listConversions, listAllConversions, deleteConversion, type Job, type AppConfig, type ConversionSession } from '../api/client';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [activeSessions, setActiveSessions] = useState<ConversionSession[]>([]);
  const [allSessions, setAllSessions] = useState<ConversionSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [j, c, active, all] = await Promise.all([
          getRecentJobs().catch(() => []),
          getConfig().catch(() => null),
          listConversions().catch(() => []),
          listAllConversions().catch(() => []),
        ]);
        setJobs(j);
        setConfig(c);
        setActiveSessions(active);
        setAllSessions(all);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const isConfigured = config && config.radarr_url && config.radarr_api_key;

  const historySessions = allSessions.filter(s => s.status === 'done' || s.status === 'importing');

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-100">Dashboard</h2>
        <p className="text-dark-400 mt-1">Welcome to CineForge</p>
      </div>

      {!loading && !isConfigured && (
        <div className="bg-radarr-500/10 border border-radarr-500/30 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-radarr-400 mb-2">Get Started</h3>
          <p className="text-sm text-gray-300 mb-4">
            Configure your Radarr connection and TMDb API key to start importing movies.
          </p>
          <Link
            to="/settings"
            className="inline-flex px-5 py-2.5 bg-radarr-500 hover:bg-radarr-600 rounded-lg text-sm font-semibold text-white transition-colors"
          >
            Go to Settings
          </Link>
        </div>
      )}

      {isConfigured && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link to="/library" className="group bg-dark-900 border border-dark-800 hover:border-violet-500/30 rounded-xl p-6 transition-all">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-violet-500/15 rounded-xl flex items-center justify-center group-hover:bg-violet-500/25 transition-colors">
                <svg className="w-6 h-6 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-200">Library</h3>
                <p className="text-sm text-dark-400 mt-0.5">Browse and filter your Radarr library</p>
              </div>
            </div>
          </Link>

          <Link to="/import" className="group bg-dark-900 border border-dark-800 hover:border-radarr-500/30 rounded-xl p-6 transition-all">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-radarr-500/15 rounded-xl flex items-center justify-center group-hover:bg-radarr-500/25 transition-colors">
                <svg className="w-6 h-6 text-radarr-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-200">Import by ID</h3>
                <p className="text-sm text-dark-400 mt-0.5">Upload JSON with TMDb/IMDb IDs</p>
              </div>
            </div>
          </Link>

          <Link to="/convert" className="group bg-dark-900 border border-dark-800 hover:border-blue-500/30 rounded-xl p-6 transition-all">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-500/15 rounded-xl flex items-center justify-center group-hover:bg-blue-500/25 transition-colors">
                <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M2.985 19.644l3.181-3.183" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-200">Convert & Import</h3>
                <p className="text-sm text-dark-400 mt-0.5">Look up titles on TMDb, then import</p>
              </div>
            </div>
          </Link>

          <Link to="/normalize" className="group bg-dark-900 border border-dark-800 hover:border-teal-500/30 rounded-xl p-6 transition-all">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-teal-500/15 rounded-xl flex items-center justify-center group-hover:bg-teal-500/25 transition-colors">
                <svg className="w-6 h-6 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-200">Normalize Audio</h3>
                <p className="text-sm text-dark-400 mt-0.5">Adjust loudness of media files</p>
              </div>
            </div>
          </Link>
        </div>
      )}

      {!loading && activeSessions.length > 0 && (
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-200">Active Conversions</h3>
          <div className="space-y-2">
            {activeSessions.map(session => (
              <div
                key={session.id}
                className="flex items-center justify-between bg-dark-900 border border-blue-500/20 hover:border-blue-500/40 rounded-xl px-5 py-4 transition-colors group"
              >
                <Link
                  to={`/convert?session=${session.id}`}
                  className="flex items-center gap-4 flex-1 min-w-0"
                >
                  <div className="w-10 h-10 bg-blue-500/15 rounded-lg flex items-center justify-center group-hover:bg-blue-500/25 transition-colors shrink-0">
                    <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M2.985 19.644l3.181-3.183" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-200 truncate">
                      {session.name || 'Untitled conversion'}
                    </p>
                    <p className="text-xs text-dark-400 mt-0.5">
                      {session.matched} of {session.total} matched
                      <span className="mx-1.5 text-dark-600">&bull;</span>
                      <span className={
                        session.status === 'ready' ? 'text-green-400' :
                        session.status === 'matching' ? 'text-yellow-400' : 'text-dark-400'
                      }>
                        {session.status}
                      </span>
                    </p>
                  </div>
                </Link>
                <div className="flex items-center gap-3 shrink-0 ml-4">
                  <Link
                    to={`/convert?session=${session.id}`}
                    className="flex items-center gap-1.5 text-dark-500 hover:text-blue-400 transition-colors"
                  >
                    <span className="text-xs font-medium">Resume</span>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                  </Link>
                  <button
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!confirm(`Delete session "${session.name || 'Untitled'}"? This cannot be undone.`)) return;
                      try {
                        await deleteConversion(session.id);
                        setActiveSessions(prev => prev.filter(s => s.id !== session.id));
                      } catch {
                        alert('Failed to delete session');
                      }
                    }}
                    className="p-1.5 rounded-lg text-dark-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Delete session"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-200">History</h3>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse bg-dark-900 border border-dark-800 rounded-xl h-16" />
            ))}
          </div>
        ) : jobs.length === 0 && historySessions.length === 0 ? (
          <div className="bg-dark-900 border border-dark-800 rounded-xl p-8 text-center">
            <p className="text-dark-500 text-sm">No import jobs yet. Get started by importing some movies!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {historySessions.map(session => {
              const content = (
                <>
                  <div className="flex items-center gap-4">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-400">
                      completed
                    </span>
                    <div>
                      <p className="text-sm font-medium text-gray-200">
                        Conversion &mdash; {session.name || 'Untitled'}
                      </p>
                      <p className="text-xs text-dark-500">{getTimeAgo(new Date(session.created_at))}</p>
                    </div>
                  </div>
                  <div className="text-right text-sm text-dark-400">
                    {session.matched} of {session.total} matched
                  </div>
                </>
              );
              const baseClass = "flex items-center justify-between bg-dark-900 border border-dark-800 rounded-xl px-5 py-4 transition-colors";
              return session.job_id ? (
                <Link key={'s-' + session.id} to={`/jobs/${session.job_id}`} className={baseClass + ' hover:border-dark-700'}>
                  {content}
                </Link>
              ) : (
                <div key={'s-' + session.id} className={baseClass}>
                  {content}
                </div>
              );
            })}
            {jobs.map(job => (
              <Link
                key={job.id}
                to={`/jobs/${job.id}`}
                className="flex items-center justify-between bg-dark-900 border border-dark-800 hover:border-dark-700 rounded-xl px-5 py-4 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <StatusBadge status={job.status} />
                  <div>
                    <p className="text-sm font-medium text-gray-200">
                      {job.type === 'import' ? 'Movie Import' : 'Conversion'} &mdash; {job.total} movies
                    </p>
                    <p className="text-xs text-dark-500">{getTimeAgo(new Date(job.created_at))}</p>
                  </div>
                </div>
                <div className="text-right text-sm">
                  {job.succeeded > 0 && <span className="text-green-400">{job.succeeded} added</span>}
                  {job.succeeded > 0 && job.failed > 0 && <span className="text-dark-600 mx-1">/</span>}
                  {job.failed > 0 && <span className="text-red-400">{job.failed} failed</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-dark-700 text-dark-400',
    running: 'bg-radarr-500/15 text-radarr-400',
    completed: 'bg-green-500/15 text-green-400',
    failed: 'bg-red-500/15 text-red-400',
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.pending}`}>
      {status}
    </span>
  );
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
