import { useState, useEffect } from 'react';
import { getTags, createTag, type RadarrTag } from '../api/client';

interface TagSelectorProps {
  selectedTags: number[];
  onChange: (tags: number[]) => void;
}

export default function TagSelector({ selectedTags, onChange }: TagSelectorProps) {
  const [tags, setTags] = useState<RadarrTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTagLabel, setNewTagLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadTags();
  }, []);

  async function loadTags() {
    try {
      const loaded = await getTags();
      setTags(loaded);
    } catch {
      // Radarr might not be configured yet
    } finally {
      setLoading(false);
    }
  }

  function toggleTag(tagId: number) {
    if (selectedTags.includes(tagId)) {
      onChange(selectedTags.filter(id => id !== tagId));
    } else {
      onChange([...selectedTags, tagId]);
    }
  }

  async function handleCreate() {
    const label = newTagLabel.trim().toLowerCase();
    if (!label) return;

    const existing = tags.find(t => t.label.toLowerCase() === label);
    if (existing) {
      if (!selectedTags.includes(existing.id)) {
        onChange([...selectedTags, existing.id]);
      }
      setNewTagLabel('');
      setShowCreate(false);
      return;
    }

    setCreating(true);
    setError('');
    try {
      const created = await createTag(label);
      setTags(prev => [...prev, created]);
      onChange([...selectedTags, created.id]);
      setNewTagLabel('');
      setShowCreate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tag');
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="text-xs text-dark-500">Loading tags...</div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-dark-300">Tags</label>
        <span className="text-xs text-dark-500">
          {selectedTags.length > 0
            ? `${selectedTags.length} selected`
            : 'optional'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tags.map(tag => {
          const isSelected = selectedTags.includes(tag.id);
          return (
            <button
              key={tag.id}
              onClick={() => toggleTag(tag.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                isSelected
                  ? 'bg-radarr-500/20 border-radarr-500/50 text-radarr-400'
                  : 'bg-dark-800 border-dark-700 text-dark-400 hover:border-dark-500 hover:text-dark-300'
              }`}
            >
              {tag.label}
              {isSelected && (
                <span className="ml-1.5 text-radarr-400/70">&times;</span>
              )}
            </button>
          );
        })}

        {!showCreate ? (
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-1 rounded-full text-xs font-medium border border-dashed border-dark-600 text-dark-500 hover:border-dark-400 hover:text-dark-300 transition-colors"
          >
            + New Tag
          </button>
        ) : (
          <form
            onSubmit={e => { e.preventDefault(); handleCreate(); }}
            className="flex items-center gap-1.5"
          >
            <input
              type="text"
              value={newTagLabel}
              onChange={e => setNewTagLabel(e.target.value)}
              placeholder="tag name"
              autoFocus
              disabled={creating}
              className="w-28 px-2.5 py-1 bg-dark-800 border border-dark-600 rounded-full text-xs text-gray-200 placeholder-dark-500 focus:outline-none focus:ring-1 focus:ring-radarr-500/40 focus:border-radarr-500"
            />
            <button
              type="submit"
              disabled={creating || !newTagLabel.trim()}
              className="px-2.5 py-1 rounded-full text-xs font-medium bg-radarr-500/15 text-radarr-400 border border-radarr-500/30 hover:bg-radarr-500/25 transition-colors disabled:opacity-40"
            >
              {creating ? '...' : 'Add'}
            </button>
            <button
              type="button"
              onClick={() => { setShowCreate(false); setNewTagLabel(''); setError(''); }}
              className="px-1.5 py-1 text-xs text-dark-500 hover:text-dark-300 transition-colors"
            >
              Cancel
            </button>
          </form>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
