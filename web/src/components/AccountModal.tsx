import { CheckCircle2, FileUp, KeyRound, Loader2, ShieldCheck, Upload, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { Account, BulkCreateAccountsResponse, Org } from '../types/instabox';

interface PreviewRow {
  name: string;
  keyMask: string;
  readOnly: boolean;
  duplicateInBatch: boolean;
}

function maskPreview(key: string): string {
  const s = key.trim();
  if (s.length <= 8) return '••••';
  const idx = s.indexOf('_');
  const prefix = idx > 0 && idx <= 5 ? s.slice(0, idx + 1) : s.slice(0, 4);
  return `${prefix}••••${s.slice(-4)}`;
}

function parseClientPreview(raw: string): PreviewRow[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const extracted: Array<{ name: string; apiKey: string; readOnly: boolean }> = [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as
        | Array<{ name?: string; apiKey?: string; readOnly?: boolean }>
        | { accounts?: Array<{ name?: string; apiKey?: string; readOnly?: boolean }> };
      const arr = Array.isArray(parsed) ? parsed : (parsed.accounts ?? []);
      for (const item of arr) {
        if (item?.apiKey) {
          extracted.push({
            name: item.name ?? '',
            apiKey: String(item.apiKey).trim(),
            readOnly: Boolean(item.readOnly),
          });
        }
      }
    } catch {
      // fall through to line parser
    }
  }

  if (extracted.length === 0) {
    const lines = trimmed.split('\n');
    // Quick YAML extraction for preview if `apiKey:` appears
    if (trimmed.includes('apiKey:')) {
      let curName = '';
      let curRO = false;
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.startsWith('- ')) {
          curName = '';
          curRO = false;
        }
        const mName = line.match(/^(?:-\s+)?name:\s*["']?(.+?)["']?$/);
        if (mName) curName = mName[1].trim();
        const mRO = line.match(/^(?:-\s+)?readOnly:\s*(true|false)/i);
        if (mRO) curRO = mRO[1].toLowerCase() === 'true';
        const mKey = line.match(/^(?:-\s+)?apiKey:\s*["']?(.+?)["']?$/);
        if (mKey) {
          extracted.push({ name: curName, apiKey: mKey[1].trim(), readOnly: curRO });
        }
      }
    } else {
      lines.forEach((rawLine, idx) => {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) return;
        const cols = line.split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
        if (idx === 0 && cols.length >= 2 && cols[0].toLowerCase() === 'name' && cols[1].toLowerCase().includes('key')) {
          return;
        }
        if (cols.length === 1) {
          extracted.push({ name: '', apiKey: cols[0], readOnly: false });
        } else {
          const roFlag = (cols[2] ?? '').toLowerCase();
          extracted.push({
            name: cols[0],
            apiKey: cols[1],
            readOnly: ['readonly', 'read-only', 'ro', 'true', '1'].includes(roFlag),
          });
        }
      });
    }
  }

  const seen = new Set<string>();
  return extracted.map((item) => {
    const dup = seen.has(item.apiKey);
    seen.add(item.apiKey);
    return {
      name: item.name || '(auto from /v1/me)',
      keyMask: maskPreview(item.apiKey),
      readOnly: item.readOnly,
      duplicateInBatch: dup,
    };
  });
}

export function AccountModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: Account | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');

  // Single account state
  const [name, setName] = useState(editing?.name ?? '');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? 'https://api.instabox.sh');
  const [readOnly, setReadOnly] = useState(editing?.readOnly ?? false);
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [testing, setTesting] = useState(false);
  const [testInfo, setTestInfo] = useState<{ login: string; email: string; orgs: Org[] } | null>(null);

  // Bulk import state
  const [bulkRaw, setBulkRaw] = useState('');
  const [bulkBaseUrl, setBulkBaseUrl] = useState('https://api.instabox.sh');
  const [bulkReadOnly, setBulkReadOnly] = useState(false);
  const [bulkValidate, setBulkValidate] = useState(true);
  const [bulkResult, setBulkResult] = useState<BulkCreateAccountsResponse | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const previewRows = useMemo(() => parseClientPreview(bulkRaw), [bulkRaw]);

  const handleTest = async () => {
    setError('');
    setTestInfo(null);
    if (!apiKey.trim()) {
      setError('Enter an API key to test connection.');
      return;
    }
    setTesting(true);
    try {
      const res = await api.testAccount(apiKey.trim(), baseUrl.trim());
      setTestInfo({ login: res.me.login, email: res.me.email, orgs: res.orgs });
      if (!name.trim() && (res.me.login || res.me.email)) {
        setName(res.me.login || res.me.email);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (editing) {
        await api.updateAccount(editing.id, {
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          readOnly,
          enabled,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        });
      } else {
        await api.createAccount({
          name: name.trim(),
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim(),
          readOnly,
          enabled,
          validate: true,
        });
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save account');
    } finally {
      setSaving(false);
    }
  };

  const handleBulkFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setBulkRaw(reader.result);
        setBulkResult(null);
        setError('');
      }
    };
    reader.readAsText(file);
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await api.bulkCreateAccounts({
        raw: bulkRaw,
        baseUrl: bulkBaseUrl.trim(),
        readOnly: bulkReadOnly,
        validate: bulkValidate,
      });
      setBulkResult(res);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Bulk import failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={() => !saving && onClose()}
    >
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-sky-500" />
            <h2 className="text-base font-semibold">
              {editing ? `Edit Account: ${editing.name}` : 'Add InstaBox Account'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode Switcher (only when adding new account) */}
        {!editing && (
          <div className="mt-4 flex rounded-xl bg-slate-100 p-1 text-xs font-semibold dark:bg-slate-950">
            <button
              type="button"
              onClick={() => {
                setMode('single');
                setError('');
              }}
              className={`flex-1 rounded-lg py-1.5 transition-colors ${
                mode === 'single'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              Single Account
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('bulk');
                setError('');
              }}
              className={`flex-1 rounded-lg py-1.5 transition-colors ${
                mode === 'bulk'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              Bulk Import (CSV / JSON / YAML)
            </button>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-500">
            {error}
          </div>
        )}

        {/* SINGLE ACCOUNT FORM */}
        {(editing || mode === 'single') && (
          <form onSubmit={handleSingleSubmit} className="mt-4 space-y-3.5 text-xs">
            <div>
              <label className="mb-1 block font-medium text-slate-600 dark:text-slate-300">Account Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Prod Workspace (leave empty to auto-fill from /v1/me)"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="mb-1 block font-medium text-slate-600 dark:text-slate-300">
                InstaBox API Key {editing && <span className="font-normal text-slate-400">(leave blank to keep {editing.keyHint})</span>}
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  required={!editing}
                  placeholder="ibk_..."
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950"
                />
                <button
                  type="button"
                  disabled={testing || !apiKey.trim()}
                  onClick={handleTest}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 font-semibold hover:bg-slate-100 disabled:opacity-45 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                  Test
                </button>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Encrypted at rest with AES-256-GCM (APP_KEY). Write-only: never displayed in plaintext again.
              </p>
            </div>

            {testInfo && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-emerald-700 dark:text-emerald-300">
                <div className="flex items-center gap-1.5 font-semibold">
                  <CheckCircle2 className="h-4 w-4" />
                  Connected as {testInfo.login || testInfo.email}
                </div>
                {testInfo.orgs.length > 0 && (
                  <div className="mt-1 text-[11px]">
                    Orgs: {testInfo.orgs.map((o) => `${o.name} (${o.tier})`).join(', ')}
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="mb-1 block font-medium text-slate-600 dark:text-slate-300">API Base URL</label>
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div className="flex flex-wrap gap-5 pt-1">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={readOnly}
                  onChange={(e) => setReadOnly(e.target.checked)}
                  className="rounded border-slate-400"
                />
                <span>Read-Only Mode (disable Start/Stop/Pause/Resume)</span>
              </label>

              {editing && (
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="rounded border-slate-400"
                  />
                  <span>Enabled (re-enabling resets 401 failure counter)</span>
                </label>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 px-3.5 py-2 font-medium dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editing ? 'Save Changes' : 'Add Account'}
              </button>
            </div>
          </form>
        )}

        {/* BULK IMPORT FORM */}
        {!editing && mode === 'bulk' && !bulkResult && (
          <form onSubmit={handleBulkSubmit} className="mt-4 space-y-3.5 text-xs">
            <div className="flex items-center justify-between">
              <label className="font-medium text-slate-600 dark:text-slate-300">
                Paste CSV / Plain Text / JSON / YAML
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
                <FileUp className="h-3.5 w-3.5" />
                Upload File
                <input
                  type="file"
                  accept=".csv,.txt,.json,.yaml,.yml"
                  onChange={handleBulkFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            <textarea
              rows={6}
              value={bulkRaw}
              onChange={(e) => setBulkRaw(e.target.value)}
              placeholder={`Prod Workspace, ibk_xxxx_prod\nDev Personal, ibk_xxxx_dev, readonly\nibk_xxxx_bare_key_only`}
              className="w-full rounded-lg border border-slate-300 bg-white p-3 font-mono text-xs outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950"
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-medium text-slate-600 dark:text-slate-300">Default Base URL</label>
                <input
                  type="url"
                  value={bulkBaseUrl}
                  onChange={(e) => setBulkBaseUrl(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div className="flex flex-col justify-center gap-2 pt-2">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={bulkValidate}
                    onChange={(e) => setBulkValidate(e.target.checked)}
                    className="rounded border-slate-400"
                  />
                  <span>Validate API keys via /v1/me before saving</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={bulkReadOnly}
                    onChange={(e) => setBulkReadOnly(e.target.checked)}
                    className="rounded border-slate-400"
                  />
                  <span>Mark all imported accounts as Read-Only</span>
                </label>
              </div>
            </div>

            {previewRows.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="mb-2 flex items-center justify-between font-semibold">
                  <span>Preview ({previewRows.length} entries detected)</span>
                  <span className="text-[11px] font-normal text-slate-500">Duplicates are automatically skipped</span>
                </div>
                <div className="max-h-36 space-y-1 overflow-y-auto font-mono text-[11px]">
                  {previewRows.map((row, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded bg-white px-2.5 py-1 dark:bg-slate-900"
                    >
                      <span className="truncate">{row.name}</span>
                      <div className="ml-2 flex shrink-0 items-center gap-1.5">
                        <span className="text-slate-500">{row.keyMask}</span>
                        {(row.readOnly || bulkReadOnly) && (
                          <span className="rounded bg-slate-200 px-1 text-[10px] dark:bg-slate-800">RO</span>
                        )}
                        {row.duplicateInBatch && (
                          <span className="rounded bg-amber-500/15 px-1 text-[10px] text-amber-500">dup</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 px-3.5 py-2 font-medium dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !bulkRaw.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Import {previewRows.length > 0 ? `${previewRows.length} Accounts` : 'Accounts'}
              </button>
            </div>
          </form>
        )}

        {/* BULK IMPORT REPORT */}
        {!editing && mode === 'bulk' && bulkResult && (
          <div className="mt-4 space-y-3 text-xs">
            <div className="grid grid-cols-3 gap-2 text-center font-mono">
              <div className="rounded-lg bg-emerald-500/10 p-2.5 text-emerald-600 dark:text-emerald-400">
                <div className="text-lg font-bold">{bulkResult.created}</div>
                <div>Created</div>
              </div>
              <div className="rounded-lg bg-amber-500/10 p-2.5 text-amber-600 dark:text-amber-400">
                <div className="text-lg font-bold">{bulkResult.skipped}</div>
                <div>Skipped</div>
              </div>
              <div className="rounded-lg bg-rose-500/10 p-2.5 text-rose-600 dark:text-rose-400">
                <div className="text-lg font-bold">{bulkResult.failed}</div>
                <div>Failed</div>
              </div>
            </div>

            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {bulkResult.results.map((r) => (
                <div
                  key={r.index}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800"
                >
                  <div className="min-w-0">
                    <div className="font-semibold">
                      {r.name || `Row #${r.index + 1}`}{' '}
                      {r.keyHint && <span className="font-mono text-[11px] text-slate-400">{r.keyHint}</span>}
                    </div>
                    {r.reason && <div className="truncate text-[11px] text-slate-500">{r.reason}</div>}
                  </div>
                  <span
                    className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                      r.status === 'created'
                        ? 'bg-emerald-500/15 text-emerald-500'
                        : r.status === 'skipped'
                          ? 'bg-amber-500/15 text-amber-500'
                          : 'bg-rose-500/15 text-rose-500'
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-500"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
