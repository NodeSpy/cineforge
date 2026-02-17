import { useEffect, useState } from 'react';
import { getJob, type Job } from '../api/client';

interface ProgressBarProps {
  jobId: string;
  onComplete?: (job: Job) => void;
}

export default function ProgressBar({ jobId, onComplete }: ProgressBarProps) {
  const [job, setJob] = useState<Job | null>(null);

  useEffect(() => {
    let active = true;

    async function poll() {
      if (!active) return;
      try {
        const j = await getJob(jobId);
        if (active) {
          setJob(j);
          if (j.status === 'completed' || j.status === 'failed') {
            onComplete?.(j);
            return;
          }
        }
      } catch {
        // ignore poll errors
      }
      if (active) {
        setTimeout(poll, 1000);
      }
    }

    poll();
    return () => { active = false; };
  }, [jobId, onComplete]);

  if (!job) {
    return (
      <div className="animate-pulse bg-dark-800 rounded-lg h-20" />
    );
  }

  const pct = job.total > 0 ? Math.round((job.completed / job.total) * 100) : 0;

  return (
    <div className="bg-dark-900 border border-dark-800 rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-200">
            {job.status === 'running' ? 'Importing movies...' :
             job.status === 'completed' ? 'Import complete' :
             job.status === 'failed' ? 'Import failed' : 'Preparing...'}
          </h3>
          <p className="text-xs text-dark-400 mt-1">
            {job.completed} of {job.total} processed
            {job.succeeded > 0 && <span className="text-green-400 ml-2">{job.succeeded} added</span>}
            {(job.completed - job.succeeded - job.failed) > 0 && <span className="text-yellow-400 ml-2">{job.completed - job.succeeded - job.failed} skipped</span>}
            {job.failed > 0 && <span className="text-red-400 ml-2">{job.failed} failed</span>}
          </p>
        </div>
        <span className="text-2xl font-bold text-radarr-400">{pct}%</span>
      </div>

      <div className="w-full bg-dark-800 rounded-full h-2.5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            job.status === 'failed' ? 'bg-red-500' :
            job.status === 'completed' ? 'bg-green-500' : 'bg-radarr-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {job.status === 'completed' && job.results.length > 0 && (
        <div className="mt-4 max-h-60 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-dark-400 uppercase">
                <th className="text-left py-1">Title</th>
                <th className="text-left py-1 w-24">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-800">
              {job.results.map((r, i) => (
                <tr key={i}>
                  <td className="py-1.5 text-gray-300">{r.title}</td>
                  <td className="py-1.5">
                    {r.status === 'success' ? (
                      <span className="text-green-400 text-xs">Added</span>
                    ) : r.status === 'skipped' ? (
                      <span className="text-yellow-400 text-xs" title={r.error}>Skipped</span>
                    ) : (
                      <span className="text-red-400 text-xs" title={r.error}>Failed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
