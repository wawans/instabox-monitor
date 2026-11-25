import {
  Activity,
  Edit3,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AccountModal } from '../components/AccountModal';
import { AccountStatusBadge } from '../components/StateBadge';
import { api, ApiError } from '../lib/api';
import { formatRelativeTime } from '../lib/format';
import type { Account, ActivityEvent } from '../types/instabox';

export function AccountsPage({
  onAccountsChanged,
  fleetGeneratedAt,
}: {
  onAccountsChanged: () => Promise<void>;
  fleetGeneratedAt?: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [seedMode, setSeedMode] = useState('sync');
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingIds, setSyncingIds] = useState<Record<string, boolean>>({});
  const [modalOpen, setModalOpen] = useState(searchParams.get('add') === '1');
  const [editing, setEditing] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [accRes, actRes] = await Promise.all([api.listAccounts(), api.getActivity()]);
      setAccounts(accRes.accounts ?? []);
      setSeedMode(accRes.seedMode ?? 'sync');
      setEvents(actRes.events ?? []);
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, fleetGeneratedAt]);

  const handleSaved = async () => {
    await load();
    await onAccountsChanged();
  };

  const handleSync = async (acc: Account) => {
    setSyncingIds((prev) => ({ ...prev, [acc.id]: true }));
    try {
      await api.syncAccount(acc.id);
      await handleSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sync failed');
    } finally {
      setSyncingIds((prev) => {
        const next = { ...prev };
        delete next[acc.id];
        return next;
      });
    }
  };

  const handleToggleEnabled = async (acc: Account) => {
    try {
      await api.updateAccount(acc.id, { enabled: !acc.enabled });
      await handleSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await api.deleteAccount(deleting.id);
      setDeleting(null);
      await handleSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  };

  const openAdd = () => {
    setEditing(null);
    setModalOpen(true);
    if (searchParams.has('add')) {
      searchParams.delete('add');
      setSearchParams(searchParams, { replace: true });
    }
  };

  const openEdit = (acc: Account) => {
    setEditing(acc);
    setModalOpen(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">Connected Accounts</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Encrypted with AES-256-GCM (APP_KEY) · Zero-Export write-only · Seed mode:{' '}
            <span className="font-mono font-semibold">{seedMode}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-sky-500"
        >
          <Plus className="h-4 w-4" />
          Add / Bulk Import
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-500">
          {error}
        </div>
      )}

      {!loading && accounts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900/50">
          <KeyRound className="mx-auto h-10 w-10 text-slate-400" />
          <h2 className="mt-3 text-base font-semibold">No Accounts Configured</h2>
          <p className="mt-1 text-xs text-slate-500">
            Add your first InstaBox API key or use Bulk Import (CSV/JSON/YAML).
          </p>
          <button
            type="button"
            onClick={openAdd}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500"
          >
            <Plus className="h-4 w-4" />
            Add Account
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold">{acc.name}</h3>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          acc.source === 'seed'
                            ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300'
                            : 'bg-slate-200/80 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {acc.source === 'seed' ? 'Config' : 'UI'}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          acc.canWrite
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'bg-slate-200/80 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {acc.readOnly ? 'Read-Only' : acc.writeCapable === false ? 'Scope Read-Only' : 'Read+Write'}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {acc.keyHint}
                      {acc.userLogin ? ` · @${acc.userLogin}` : ''}
                      {acc.lastSyncAt ? ` · synced ${formatRelativeTime(acc.lastSyncAt)}` : ''}
                    </div>
                  </div>
                  <AccountStatusBadge account={acc} />
                </div>

                {/* Auto-Disabled (401) Alert Banner */}
                {acc.lastSyncStatus === 'auto_disabled' && (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-rose-500/35 bg-rose-500/10 p-2.5 text-xs text-rose-600 dark:text-rose-300">
                    <div className="flex items-start gap-2">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <div className="font-semibold">
                          Auto-Disabled ({acc.consecutiveAuthFailures}/{acc.maxAuthFailures} auth failures)
                        </div>
                        <div className="text-[11px] opacity-90">{acc.disabledReason || acc.lastError}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openEdit(acc)}
                      className="shrink-0 rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-500"
                    >
                      Update Key
                    </button>
                  </div>
                )}

                {/* APP_KEY Mismatch (key_error) Alert Banner */}
                {acc.lastSyncStatus === 'key_error' && (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
                    <div className="flex items-start gap-2">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <div className="font-semibold">APP_KEY Decryption Error</div>
                        <div className="text-[11px] opacity-90">
                          Poller paused; cached snapshot preserved. Re-enter API key or restore original APP_KEY.
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openEdit(acc)}
                      className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-500"
                    >
                      Re-enter Key
                    </button>
                  </div>
                )}

                {/* Generic Error */}
                {acc.lastError &&
                  acc.lastSyncStatus !== 'auto_disabled' &&
                  acc.lastSyncStatus !== 'key_error' && (
                    <div className="mt-2.5 rounded-lg bg-rose-500/10 px-2.5 py-1.5 font-mono text-[11px] text-rose-500">
                      {acc.lastError}
                    </div>
                  )}

                {/* Orgs & Lightweight Quotas */}
                {acc.orgs.length > 0 && (
                  <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                    {acc.orgs.map((org) => {
                      const mUsed = org.usage?.machines ?? 0;
                      const mMax = org.limits?.maxMachines || org.limits?.freeSandboxes || 0;
                      const rUsed = org.usage?.running ?? 0;
                      const rMax = org.limits?.maxRunning ?? 0;
                      const diskGiB = org.usage?.allocatedDiskGiB ?? 0;
                      const maxStoredGiB = org.limits?.maxStoredGiB ?? 0;
                      return (
                        <div key={org.id} className="rounded-lg bg-slate-50 p-2.5 text-[11px] dark:bg-slate-950/70">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">{org.name}</span>
                            {org.tier && (
                              <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-sky-600 dark:text-sky-400">
                                {org.tier}
                              </span>
                            )}
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-slate-600 dark:text-slate-400">
                            <span>
                              VMs: {mUsed}
                              {mMax > 0 ? `/${mMax}` : ''}
                            </span>
                            <span>
                              Running: {rUsed}
                              {rMax > 0 ? `/${rMax}` : ''}
                            </span>
                            {(diskGiB > 0 || maxStoredGiB > 0) && (
                              <span>
                                Disk: {diskGiB} GiB{maxStoredGiB > 0 ? ` / ${maxStoredGiB} GiB` : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => handleToggleEnabled(acc)}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  {acc.enabled ? 'Disable' : 'Enable'}
                </button>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={!acc.enabled || Boolean(syncingIds[acc.id])}
                    onClick={() => handleSync(acc)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    <RefreshCw className={`h-3 w-3 ${syncingIds[acc.id] ? 'animate-spin' : ''}`} />
                    {syncingIds[acc.id] ? 'Syncing...' : 'Sync'}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(acc)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    <Edit3 className="h-3 w-3" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(acc)}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-500/20 dark:text-rose-400"
                  >
                    <Trash2 className="h-3 w-3" />
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent Activity Log */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 text-xs font-semibold dark:border-slate-800">
          <Activity className="h-4 w-4 text-sky-500" />
          Recent Fleet Activity
        </div>
        <div className="max-h-72 divide-y divide-slate-200 overflow-y-auto text-xs dark:divide-slate-800">
          {events.length === 0 ? (
            <div className="p-6 text-center text-slate-400">No recent activity recorded yet.</div>
          ) : (
            events.map((ev) => (
              <div key={ev.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <div className="min-w-0">
                  <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {ev.eventType}
                  </span>
                  <span className="text-slate-700 dark:text-slate-200">{ev.detail}</span>
                </div>
                <span className="shrink-0 font-mono text-[11px] text-slate-400">
                  {formatRelativeTime(ev.createdAt)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {modalOpen && (
        <AccountModal
          editing={editing}
          onClose={() => setModalOpen(false)}
          onSaved={handleSaved}
        />
      )}

      {deleting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          onClick={() => setDeleting(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold">Remove Account</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Remove <strong>{deleting.name}</strong> from InstaBox Monitor? This only removes the API key from the
              dashboard; your sandboxes on InstaBox are unaffected.
              {deleting.source === 'seed' && (
                <span className="mt-1 block text-amber-500">
                  Note: this account was seeded from config and will be re-created on restart unless removed from your
                  seed file/env.
                </span>
              )}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleting(null)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
