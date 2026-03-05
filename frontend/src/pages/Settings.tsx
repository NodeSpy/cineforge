import { useState, useEffect, useRef } from 'react';
import {
  getConfig,
  updateConfig,
  getSecrets,
  validateConfig,
  testRadarrConnection,
  testSonarrConnection,
  testTmdbConnection,
  getQualityProfiles,
  getRootFolders,
  getNormalizeConfig,
  updateNormalizeConfig,
  clearNormalizeHistory,
  type AppConfig,
  type QualityProfile,
  type RootFolder,
  type ValidationResult,
  type NormalizeConfig,
} from '../api/client';

export default function Settings() {
  const [form, setForm] = useState<Partial<AppConfig>>({});
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [radarrTest, setRadarrTest] = useState('');
  const [sonarrTest, setSonarrTest] = useState('');
  const [tmdbTest, setTmdbTest] = useState('');
  const [profiles, setProfiles] = useState<QualityProfile[]>([]);
  const [folders, setFolders] = useState<RootFolder[]>([]);
  const [showRadarrKey, setShowRadarrKey] = useState(false);
  const [showSonarrKey, setShowSonarrKey] = useState(false);
  const [showTmdbKey, setShowTmdbKey] = useState(false);
  const [revealedSecrets, setRevealedSecrets] = useState<{ radarr_api_key?: string; sonarr_api_key?: string; tmdb_api_key?: string }>({});
  const dirtyFields = useRef<Set<keyof AppConfig>>(new Set());

  const defaultNormalize: NormalizeConfig = { target_lufs: -16.0, hwaccel: 'auto', audio_bitrate: '320k', backup: false, parallel: 1, video_mode: 'copy', measure_mode: 'auto' };
  const [normalizeForm, setNormalizeForm] = useState<NormalizeConfig>(defaultNormalize);
  const normalizeChanged = useRef(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [clearMessage, setClearMessage] = useState('');

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    try {
      const [cfg, ncfg] = await Promise.all([getConfig(), getNormalizeConfig()]);
      setConfig(cfg);
      setForm(cfg);
      dirtyFields.current.clear();
      setRevealedSecrets({});
      setShowRadarrKey(false);
      setShowSonarrKey(false);
      setShowTmdbKey(false);

      setNormalizeForm(ncfg);
      normalizeChanged.current = false;

      if (cfg.radarr_url && cfg.radarr_api_key) {
        loadRadarrData();
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to load configuration' });
    } finally {
      setLoading(false);
    }
  }

  async function loadRadarrData() {
    try {
      const [p, f] = await Promise.all([getQualityProfiles(), getRootFolders()]);
      setProfiles(p);
      setFolders(f);
    } catch {
      // Radarr might not be configured yet
    }
  }

  function updateField(key: keyof AppConfig, value: string | number | boolean) {
    dirtyFields.current.add(key);
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function updateNormalizeField<K extends keyof NormalizeConfig>(key: K, value: NormalizeConfig[K]) {
    normalizeChanged.current = true;
    setNormalizeForm(prev => ({ ...prev, [key]: value }));
  }

  function getDirtyPayload(): Partial<AppConfig> | null {
    if (dirtyFields.current.size === 0) return null;
    const payload: Record<string, unknown> = {};
    for (const key of dirtyFields.current) {
      payload[key] = form[key];
    }
    return payload as Partial<AppConfig>;
  }

  async function fetchSecretsIfNeeded() {
    if (revealedSecrets.radarr_api_key !== undefined) return revealedSecrets;
    const secrets = await getSecrets();
    setRevealedSecrets(secrets);
    return secrets;
  }

  async function toggleRevealRadarr() {
    if (showRadarrKey) {
      setShowRadarrKey(false);
      if (!dirtyFields.current.has('radarr_api_key') && config) {
        setForm(prev => ({ ...prev, radarr_api_key: config.radarr_api_key }));
      }
      return;
    }
    if (!dirtyFields.current.has('radarr_api_key')) {
      try {
        const secrets = await fetchSecretsIfNeeded();
        setForm(prev => ({ ...prev, radarr_api_key: secrets.radarr_api_key }));
      } catch {
        setMessage({ type: 'error', text: 'Failed to fetch secret' });
        return;
      }
    }
    setShowRadarrKey(true);
  }

  async function toggleRevealSonarr() {
    if (showSonarrKey) {
      setShowSonarrKey(false);
      if (!dirtyFields.current.has('sonarr_api_key') && config) {
        setForm(prev => ({ ...prev, sonarr_api_key: config.sonarr_api_key }));
      }
      return;
    }
    if (!dirtyFields.current.has('sonarr_api_key')) {
      try {
        const secrets = await fetchSecretsIfNeeded();
        setForm(prev => ({ ...prev, sonarr_api_key: secrets.sonarr_api_key }));
      } catch {
        setMessage({ type: 'error', text: 'Failed to fetch secret' });
        return;
      }
    }
    setShowSonarrKey(true);
  }

  async function toggleRevealTmdb() {
    if (showTmdbKey) {
      setShowTmdbKey(false);
      if (!dirtyFields.current.has('tmdb_api_key') && config) {
        setForm(prev => ({ ...prev, tmdb_api_key: config.tmdb_api_key }));
      }
      return;
    }
    if (!dirtyFields.current.has('tmdb_api_key')) {
      try {
        const secrets = await fetchSecretsIfNeeded();
        setForm(prev => ({ ...prev, tmdb_api_key: secrets.tmdb_api_key }));
      } catch {
        setMessage({ type: 'error', text: 'Failed to fetch secret' });
        return;
      }
    }
    setShowTmdbKey(true);
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);

    const payload = getDirtyPayload();
    const hasNormalizeChanges = normalizeChanged.current;

    if (!payload && !hasNormalizeChanges) {
      try {
        const res = await validateConfig();
        const allOk = res.results.every((r: ValidationResult) => r.status === 'ok');
        const msgs = res.results.map((r: ValidationResult) =>
          `${r.service}: ${r.status === 'ok' ? '\u2713' : r.status === 'warning' ? '\u26A0' : '\u2717'} ${r.message}`
        ).join('\n');
        setMessage({ type: allOk ? 'success' : 'error', text: msgs });
      } catch (err) {
        setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Validation failed' });
      } finally {
        setSaving(false);
      }
      return;
    }

    try {
      const promises: Promise<unknown>[] = [];

      if (payload) {
        promises.push(updateConfig(payload).then(updated => {
          setConfig(updated);
          setForm(updated);
          dirtyFields.current.clear();
          setRevealedSecrets({});
          setShowRadarrKey(false);
          setShowSonarrKey(false);
          setShowTmdbKey(false);
          loadRadarrData();
        }));
      }

      if (hasNormalizeChanges) {
        promises.push(updateNormalizeConfig(normalizeForm).then(saved => {
          setNormalizeForm(saved);
          normalizeChanged.current = false;
        }));
      }

      await Promise.all(promises);
      setMessage({ type: 'success', text: 'Configuration saved successfully' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestRadarr() {
    setRadarrTest('Testing...');
    try {
      const result = await testRadarrConnection(form.radarr_url || '', form.radarr_api_key || '');
      if (result.success) {
        setRadarrTest(`Connected to ${result.appName} v${result.version}`);
        loadRadarrData();
      } else {
        setRadarrTest(`Connection failed: ${result.error}`);
      }
    } catch (err) {
      setRadarrTest(err instanceof Error ? err.message : 'Test failed');
    }
  }

  async function handleTestSonarr() {
    setSonarrTest('Testing...');
    try {
      const result = await testSonarrConnection(form.sonarr_url || '', form.sonarr_api_key || '');
      if (result.success) {
        setSonarrTest(`Connected to ${result.appName} v${result.version}`);
      } else {
        setSonarrTest(`Connection failed: ${result.error}`);
      }
    } catch (err) {
      setSonarrTest(err instanceof Error ? err.message : 'Test failed');
    }
  }

  async function handleTestTmdb() {
    setTmdbTest('Testing...');
    try {
      const result = await testTmdbConnection(form.tmdb_api_key || '');
      if (result.success) {
        setTmdbTest('TMDb API connection successful');
      } else {
        setTmdbTest(`Connection failed: ${result.error}`);
      }
    } catch (err) {
      setTmdbTest(err instanceof Error ? err.message : 'Test failed');
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-100">Settings</h2>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-dark-900 border border-dark-800 rounded-xl h-20" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-100">Settings</h2>
        <p className="text-dark-400 mt-1">Configure your Radarr, Sonarr, and TMDb connections</p>
      </div>

      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm border whitespace-pre-line ${
          message.type === 'success'
            ? 'bg-green-500/10 border-green-500/30 text-green-400'
            : 'bg-red-500/10 border-red-500/30 text-red-400'
        }`}>
          {message.text}
        </div>
      )}

      {/* Radarr Connection */}
      <section className="bg-dark-900 border border-dark-800 rounded-xl p-6 space-y-5">
        <h3 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-radarr-500"></span>
          Radarr Connection
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1.5">Radarr URL</label>
            <input
              type="text"
              value={form.radarr_url || ''}
              onChange={e => updateField('radarr_url', e.target.value)}
              placeholder="http://localhost:7878"
              className="w-full px-4 py-2.5 bg-dark-800 border border-dark-700 rounded-lg text-gray-200 placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-radarr-500/40 focus:border-radarr-500 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1.5">Radarr API Key</label>
            <div className="relative">
              <input
                type={showRadarrKey ? 'text' : 'password'}
                value={form.radarr_api_key || ''}
                onChange={e => updateField('radarr_api_key', e.target.value)}
                placeholder="Enter API key"
                className="w-full px-4 py-2.5 pr-10 bg-dark-800 border border-dark-700 rounded-lg text-gray-200 placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-radarr-500/40 focus:border-radarr-500 text-sm"
              />
              <button
                type="button"
                onClick={toggleRevealRadarr}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-dark-500 hover:text-dark-300 transition-colors"
                tabIndex={-1}
              >
                {showRadarrKey ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleTestRadarr}
            disabled={!form.radarr_url || !form.radarr_api_key}
            className="px-4 py-2 bg-dark-800 hover:bg-dark-700 border border-dark-600 rounded-lg text-sm font-medium text-gray-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Test Connection
          </button>
          {radarrTest && (
            <span className={`text-sm ${radarrTest.includes('Connected') ? 'text-green-400' : radarrTest === 'Testing...' ? 'text-dark-400' : 'text-red-400'}`}>
              {radarrTest}
            </span>
          )}
        </div>
      </section>

      {/* Sonarr Connection */}
      <section className="bg-dark-900 border border-dark-800 rounded-xl p-6 space-y-5">
        <h3 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-orange-500"></span>
          Sonarr Connection
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1.5">Sonarr URL</label>
            <input
              type="text"
              value={form.sonarr_url || ''}
              onChange={e => updateField('sonarr_url', e.target.value)}
              placeholder="http://localhost:8989"
              className="w-full px-4 py-2.5 bg-dark-800 border border-dark-700 rounded-lg text-gray-200 placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40 focus:border-orange-500 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1.5">Sonarr API Key</label>
            <div className="relative">
              <input
                type={showSonarrKey ? 'text' : 'password'}
                value={form.sonarr_api_key || ''}
                onChange={e => updateField('sonarr_api_key', e.target.value)}
                placeholder="Enter API key"
                className="w-full px-4 py-2.5 pr-10 bg-dark-800 border border-dark-700 rounded-lg text-gray-200 placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40 focus:border-orange-500 text-sm"
              />
              <button
                type="button"
                onClick={toggleRevealSonarr}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-dark-500 hover:text-dark-300 transition-colors"
                tabIndex={-1}
              >
                {showSonarrKey ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleTestSonarr}
            disabled={!form.sonarr_url || !form.sonarr_api_key}
            className="px-4 py-2 bg-dark-800 hover:bg-dark-700 border border-dark-600 rounded-lg text-sm font-medium text-gray-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Test Connection
          </button>
          {sonarrTest && (
            <span className={`text-sm ${sonarrTest.includes('Connected') ? 'text-green-400' : sonarrTest === 'Testing...' ? 'text-dark-400' : 'text-red-400'}`}>
              {sonarrTest}
            </span>
          )}
        </div>

        <p className="text-xs text-dark-500">Optional. Configure to browse your TV series library and normalize episode audio.</p>
      </section>

      {/* TMDb API */}
      <section className="bg-dark-900 border border-dark-800 rounded-xl p-6 space-y-5">
        <h3 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500"></span>
          TMDb API
        </h3>

        <div>
          <label className="block text-sm font-medium text-dark-300 mb-1.5">TMDb API Key (Bearer Token)</label>
          <div className="relative">
            <input
              type={showTmdbKey ? 'text' : 'password'}
              value={form.tmdb_api_key || ''}
              onChange={e => updateField('tmdb_api_key', e.target.value)}
              placeholder="Enter TMDb API read access token"
              className="w-full px-4 py-2.5 pr-10 bg-dark-800 border border-dark-700 rounded-lg text-gray-200 placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-radarr-500/40 focus:border-radarr-500 text-sm"
            />
            <button
              type="button"
              onClick={toggleRevealTmdb}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-dark-500 hover:text-dark-300 transition-colors"
              tabIndex={-1}
            >
              {showTmdbKey ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
              )}
            </button>
          </div>
          <p className="text-xs text-dark-500 mt-1.5">Required for the Convert feature. Get one at themoviedb.org/settings/api</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleTestTmdb}
            disabled={!form.tmdb_api_key}
            className="px-4 py-2 bg-dark-800 hover:bg-dark-700 border border-dark-600 rounded-lg text-sm font-medium text-gray-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Test Connection
          </button>
          {tmdbTest && (
            <span className={`text-sm ${tmdbTest.includes('successful') ? 'text-green-400' : tmdbTest === 'Testing...' ? 'text-dark-400' : 'text-red-400'}`}>
              {tmdbTest}
            </span>
          )}
        </div>
      </section>

      {/* Import Defaults */}
      <section className="bg-dark-900 border border-dark-800 rounded-xl p-6 space-y-5">
        <h3 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500"></span>
          Import Defaults
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1.5">
              Quality Profile <span className="text-red-400">*</span>
            </label>
            <select
              value={form.quality_profile_id || ''}
              onChange={e => updateField('quality_profile_id', parseInt(e.target.value) || 0)}
              className="w-full px-4 py-2.5 bg-dark-800 border border-dark-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-radarr-500/40 focus:border-radarr-500 text-sm"
            >
              <option value="">Select profile...</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {profiles.length === 0 && (
              <p className="text-xs text-dark-500 mt-1">Connect to Radarr first to load profiles</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1.5">
              Root Folder <span className="text-red-400">*</span>
            </label>
            <select
              value={form.root_folder_path || ''}
              onChange={e => updateField('root_folder_path', e.target.value)}
              className="w-full px-4 py-2.5 bg-dark-800 border border-dark-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-radarr-500/40 focus:border-radarr-500 text-sm"
            >
              <option value="">Select folder...</option>
              {folders.map(f => (
                <option key={f.id} value={f.path}>{f.path}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1.5">Minimum Availability</label>
            <select
              value={form.min_availability || 'released'}
              onChange={e => updateField('min_availability', e.target.value)}
              className="w-full px-4 py-2.5 bg-dark-800 border border-dark-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-radarr-500/40 focus:border-radarr-500 text-sm"
            >
              <option value="announced">Announced</option>
              <option value="inCinemas">In Cinemas</option>
              <option value="released">Released</option>
              <option value="preDB">PreDB</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.monitored ?? true}
              onChange={e => updateField('monitored', e.target.checked)}
              className="rounded border-dark-600 bg-dark-800 text-radarr-500 focus:ring-radarr-500 focus:ring-offset-0"
            />
            <span className="text-sm text-gray-300">Monitored</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.search_on_add ?? true}
              onChange={e => updateField('search_on_add', e.target.checked)}
              className="rounded border-dark-600 bg-dark-800 text-radarr-500 focus:ring-radarr-500 focus:ring-offset-0"
            />
            <span className="text-sm text-gray-300">Search on Add</span>
          </label>
        </div>
      </section>

      {/* Normalize Defaults */}
      <section className="bg-dark-900 border border-dark-800 rounded-xl p-6 space-y-5">
        <div>
          <h3 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-teal-500"></span>
            Normalize Defaults
          </h3>
          <p className="text-xs text-dark-500 mt-1">Default settings for audio normalization jobs. These can be overridden per-job on the Normalize page.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-dark-300 mb-2">Target Loudness</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {([
              { value: -16.0, label: 'Streaming', desc: 'Netflix, Disney+, YouTube' },
              { value: -24.0, label: 'Broadcast', desc: 'EBU R128 TV standard' },
              { value: -27.0, label: 'Cinematic', desc: 'Theater-like dynamic range' },
            ] as const).map(preset => (
              <button
                key={preset.value}
                onClick={() => updateNormalizeField('target_lufs', preset.value)}
                className={'p-3 rounded-lg border text-left transition-colors ' + (normalizeForm.target_lufs === preset.value ? 'border-teal-500 bg-teal-500/10' : 'border-dark-700 hover:border-dark-600')}
              >
                <div className="text-sm text-gray-100 font-medium">{preset.label} <span className="text-dark-400 font-normal">({preset.value})</span></div>
                <div className="text-xs text-dark-400 mt-0.5">{preset.desc}</div>
              </button>
            ))}
            <div className={'p-3 rounded-lg border transition-colors ' + (![-16.0, -24.0, -27.0].includes(normalizeForm.target_lufs) ? 'border-teal-500 bg-teal-500/10' : 'border-dark-700')}>
              <div className="text-sm text-gray-100 font-medium mb-1.5">Custom</div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.5"
                  min="-70"
                  max="0"
                  value={normalizeForm.target_lufs}
                  onChange={e => updateNormalizeField('target_lufs', parseFloat(e.target.value) || -16.0)}
                  className="w-24 px-3 py-1.5 bg-dark-800 border border-dark-700 rounded text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500"
                />
                <span className="text-xs text-dark-400">LUFS</span>
              </div>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-dark-300 mb-2 flex items-center gap-2">
            Measurement Strategy
            <span className="relative inline-block group">
              <span className="w-4 h-4 rounded-full bg-dark-700 text-dark-400 hover:text-dark-200 text-[10px] font-bold inline-flex items-center justify-center cursor-help">i</span>
              <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 bg-dark-700 border border-dark-600 rounded-lg shadow-xl text-xs text-dark-200 leading-relaxed hidden group-hover:block">
                Controls how files are checked before normalization. Smart mode reads embedded metadata from previously normalized files for instant detection, then samples a short portion to estimate loudness. Full mode analyzes the entire audio track.
                <span className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-dark-700 border-r border-b border-dark-600 rotate-45 -mt-1" />
              </span>
            </span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {([
              { value: 'auto', label: 'Smart', tag: 'recommended', desc: 'Checks file metadata and samples audio. Skips files already at target.' },
              { value: 'full', label: 'Always Measure', tag: 'most accurate', desc: 'Analyzes the complete audio track. Slowest for large batches.' },
              { value: 'sample', label: 'Quick Sample', tag: 'fastest', desc: 'Samples a portion of the audio. Full analysis only when needed.' },
            ] as const).map(mode => (
              <button
                key={mode.value}
                onClick={() => updateNormalizeField('measure_mode', mode.value)}
                className={'p-3 rounded-lg border text-left transition-colors ' + (normalizeForm.measure_mode === mode.value ? 'border-teal-500 bg-teal-500/10' : 'border-dark-700 hover:border-dark-600')}
              >
                <div className="text-sm text-gray-100 font-medium">{mode.label} <span className="text-dark-400 font-normal text-xs">({mode.tag})</span></div>
                <div className="text-xs text-dark-400 mt-0.5">{mode.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1.5">HW Acceleration</label>
            <select
              value={normalizeForm.hwaccel}
              onChange={e => updateNormalizeField('hwaccel', e.target.value)}
              className="w-full px-4 py-2.5 bg-dark-800 border border-dark-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500 text-sm"
            >
              <option value="auto">Auto Detect</option>
              <option value="vaapi">VAAPI (Intel/AMD)</option>
              <option value="nvenc">NVENC (NVIDIA)</option>
              <option value="cpu">CPU Only</option>
            </select>
            <p className="text-xs text-dark-500 mt-1">GPU acceleration for video re-encoding. Only applies when video re-encoding is needed.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1.5">Audio Bitrate</label>
            <select
              value={normalizeForm.audio_bitrate}
              onChange={e => updateNormalizeField('audio_bitrate', e.target.value)}
              className="w-full px-4 py-2.5 bg-dark-800 border border-dark-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500 text-sm"
            >
              <option value="192k">192 kbps (smaller files)</option>
              <option value="256k">256 kbps (balanced)</option>
              <option value="320k">320 kbps (best quality)</option>
            </select>
            <p className="text-xs text-dark-500 mt-1">Higher bitrate means better audio quality but larger files.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1.5">Video Mode</label>
            <select
              value={normalizeForm.video_mode}
              onChange={e => updateNormalizeField('video_mode', e.target.value)}
              className="w-full px-4 py-2.5 bg-dark-800 border border-dark-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500 text-sm"
            >
              <option value="copy">Copy (fast, audio only)</option>
              <option value="reencode">Re-encode (slow)</option>
            </select>
            <p className="text-xs text-dark-500 mt-1">Copy is fast and only changes audio. Re-encode also re-compresses the video track.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1.5">Parallel Jobs</label>
            <input
              type="number"
              min={1}
              max={4}
              value={normalizeForm.parallel}
              onChange={e => updateNormalizeField('parallel', Math.max(1, Math.min(4, parseInt(e.target.value) || 1)))}
              className="w-full px-4 py-2.5 bg-dark-800 border border-dark-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500 text-sm"
            />
            <p className="text-xs text-dark-500 mt-1">Process multiple files simultaneously. Start with 1-2 unless you have a powerful system.</p>
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={normalizeForm.backup}
            onChange={e => updateNormalizeField('backup', e.target.checked)}
            className="rounded border-dark-600 bg-dark-800 text-teal-500 focus:ring-teal-500 focus:ring-offset-0"
          />
          <span className="text-sm text-gray-300">Create backup before normalizing</span>
          <span className="text-xs text-dark-500">Keeps original file with .backup extension</span>
        </label>
      </section>

      {/* Data Management */}
      <section className="bg-dark-900 border border-dark-800 rounded-xl p-6 space-y-5">
        <div>
          <h3 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500"></span>
            Data Management
          </h3>
          <p className="text-xs text-dark-500 mt-1">Manage stored data and job history.</p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-300">Normalize History</div>
            <p className="text-xs text-dark-500 mt-0.5">Clear all normalization job records, item results, and processing cache.</p>
          </div>
          <div className="flex items-center gap-3">
            {clearMessage && <span className="text-xs text-green-400">{clearMessage}</span>}
            <button
              onClick={async () => {
                if (!confirm('This will permanently delete all normalization job history and cache. Are you sure?')) return;
                setClearingHistory(true);
                setClearMessage('');
                try {
                  await clearNormalizeHistory();
                  setClearMessage('History cleared');
                  setTimeout(() => setClearMessage(''), 3000);
                } catch {
                  setClearMessage('Failed to clear');
                } finally {
                  setClearingHistory(false);
                }
              }}
              disabled={clearingHistory}
              className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 rounded-lg text-sm font-medium text-red-400 transition-colors disabled:opacity-50"
            >
              {clearingHistory ? 'Clearing...' : 'Clear Normalize History'}
            </button>
          </div>
        </div>
      </section>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-radarr-500 hover:bg-radarr-600 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
