import { useState, useEffect } from 'react';
import { getRecentJobs, getConfig, listConversions, listAllConversions, deleteConversion, type Job, type AppConfig, type ConversionSession } from '../api/client';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [activeSessions, setActiveSessions] = useState<ConversionSession[]>([]);
  const [allSessions, setAllSessions] = useState<ConversionSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [importActivityOpen, setImportActivityOpen] = useState(false);

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
        if (active.length > 0 || j.length > 0 || all.some(s => s.status === 'done' || s.status === 'importing')) {
          setImportActivityOpen(true);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const isConfigured = config && config.radarr_url && config.radarr_api_key;

  const historySessions = allSessions.filter(s => s.status === 'done' || s.status === 'importing');
  const hasImportActivity = activeSessions.length > 0 || jobs.length > 0 || historySessions.length > 0;

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
            Configure your Radarr connection and TMDb API key to get started.
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
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link to="/library" className="group bg-dark-900 border border-dark-800 hover:border-violet-500/30 rounded-xl p-6 transition-all">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-violet-500/15 rounded-xl flex items-center justify-center group-hover:bg-violet-500/25 transition-colors">
                  <svg className="w-6 h-6 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-200">Library</h3>
                  <p className="text-sm text-dark-400 mt-0.5">Browse movies and series</p>
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

            <Link to="/settings" className="group bg-dark-900 border border-dark-800 hover:border-dark-600 rounded-xl p-6 transition-all">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-dark-700 rounded-xl flex items-center justify-center group-hover:bg-dark-600 transition-colors">
                  <svg className="w-6 h-6 text-dark-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-200">Settings</h3>
                  <p className="text-sm text-dark-400 mt-0.5">Radarr, Sonarr, and TMDb config</p>
                </div>
              </div>
            </Link>
          </div>

          <div className="bg-dark-900/60 border border-dark-800 rounded-lg px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg className="w-4 h-4 text-dark-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375" />
              </svg>
              <span className="text-xs text-dark-400">Import Tools for bulk operations:</span>
              <Link to="/import" className="text-xs text-dark-300 hover:text-radarr-400 transition-colors font-medium">Import by ID</Link>
              <span className="text-dark-600">&middot;</span>
              <Link to="/convert" className="text-xs text-dark-300 hover:text-blue-400 transition-colors font-medium">Convert & Import</Link>
            </div>
          </div>
        </>
      )}

      {!loading && hasImportActivity && (
        <section>
          <button
            onClick={() => setImportActivityOpen(!importActivityOpen)}
            className="flex items-center gap-2 text-sm font-semibold text-dark-400 hover:text-dark-300 transition-colors mb-3"
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform ${importActivityOpen ? 'rotate-90' : ''}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            Import Activity
          </button>

          {importActivityOpen && (
            <div className="space-y-4">
              {activeSessions.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-dark-500 uppercase tracking-wider">Active Conversions</h4>
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
              )}

              {(historySessions.length > 0 || jobs.length > 0) && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-dark-500 uppercase tracking-wider">History</h4>
                  {loading ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="animate-pulse bg-dark-900 border border-dark-800 rounded-xl h-16" />
                      ))}
                    </div>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}
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
