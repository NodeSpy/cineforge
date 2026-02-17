import type { PreviewItem } from '../api/client';

interface MovieTableProps {
  items: PreviewItem[];
  selectable?: boolean;
  selected?: Set<number>;
  onToggle?: (tmdbId: number) => void;
}

export default function MovieTable({ items, selectable, selected, onToggle }: MovieTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-dark-800">
      <table className="w-full">
        <thead>
          <tr className="bg-dark-900 border-b border-dark-800">
            {selectable && (
              <th className="w-10 px-4 py-3"></th>
            )}
            <th className="w-16 px-4 py-3"></th>
            <th className="px-4 py-3 text-left text-xs font-medium text-dark-400 uppercase tracking-wider">Title</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-dark-400 uppercase tracking-wider w-20">Year</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-dark-400 uppercase tracking-wider w-28">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-dark-800">
          {items.map((item, i) => (
            <tr key={`${item.tmdb_id}-${i}`} className="hover:bg-dark-900/50 transition-colors">
              {selectable && (
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected?.has(item.tmdb_id) ?? false}
                    onChange={() => onToggle?.(item.tmdb_id)}
                    disabled={item.status !== 'ready'}
                    className="rounded border-dark-600 bg-dark-800 text-radarr-500 focus:ring-radarr-500 focus:ring-offset-0 disabled:opacity-30"
                  />
                </td>
              )}
              <td className="px-4 py-3">
                {item.poster_url ? (
                  <img
                    src={item.poster_url}
                    alt={item.title}
                    className="w-10 h-14 object-cover rounded"
                  />
                ) : (
                  <div className="w-10 h-14 bg-dark-800 rounded flex items-center justify-center">
                    <svg className="w-5 h-5 text-dark-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M18 14.25a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    </svg>
                  </div>
                )}
              </td>
              <td className="px-4 py-3">
                <p className="text-sm font-medium text-gray-200">{item.title}</p>
                {item.overview && (
                  <p className="text-xs text-dark-400 mt-0.5 line-clamp-2 max-w-lg">{item.overview}</p>
                )}
              </td>
              <td className="px-4 py-3 text-sm text-dark-300">{item.year || '—'}</td>
              <td className="px-4 py-3">
                <StatusBadge status={item.status} error={item.error} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status, error }: { status: string; error?: string }) {
  const styles: Record<string, string> = {
    ready: 'bg-green-500/15 text-green-400 border-green-500/30',
    exists: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    not_found: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    error: 'bg-red-500/15 text-red-400 border-red-500/30',
  };

  const labels: Record<string, string> = {
    ready: 'Ready',
    exists: 'Already Added',
    not_found: 'Not Found',
    error: 'Error',
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status] || styles.error}`}
      title={error}
    >
      {labels[status] || status}
    </span>
  );
}
