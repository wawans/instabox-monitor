import { AlertTriangle, Loader2, Pause, Play, Square, Zap } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { Operation } from '../types/instabox';

export function LifecycleControls({
  accountId,
  machineId,
  machineName,
  state,
  canWrite,
  readOnlyReason,
  activeOperation,
  mobileFullWidth = false,
  onOperationStarted,
  onError,
}: {
  accountId: string;
  machineId: string;
  machineName: string;
  state: string;
  canWrite: boolean;
  readOnlyReason?: string;
  activeOperation?: Operation;
  mobileFullWidth?: boolean;
  onOperationStarted?: (op: Operation) => void;
  onError?: (msg: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'stop' | 'suspend' | null>(null);
  const [forceStop, setForceStop] = useState(false);

  const isTransitioning =
    state === 'creating' ||
    state === 'starting' ||
    state === 'stopping' ||
    state === 'suspending' ||
    state === 'resuming' ||
    state === 'deleting' ||
    activeOperation?.state === 'queued' ||
    activeOperation?.state === 'running';

  const disabledReason = !canWrite
    ? readOnlyReason || 'Account is read-only or lacks machines:write scope'
    : isTransitioning
      ? `Operation in progress (${activeOperation?.phase || state})`
      : undefined;

  const runAction = async (action: 'start' | 'stop' | 'suspend' | 'resume', force = false) => {
    setBusy(action);
    try {
      const op = await api.vmAction(accountId, machineId, action, { force, machineName });
      onOperationStarted?.(op);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : `Failed to ${action} ${machineName}`;
      onError?.(msg);
    } finally {
      setBusy(null);
      setConfirmAction(null);
      setForceStop(false);
    }
  };

  const btnBase = mobileFullWidth
    ? 'inline-flex flex-1 min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45'
    : 'inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45';

  return (
    <>
      <div
        className={`flex items-center gap-1.5 ${mobileFullWidth ? 'w-full' : 'justify-end'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {isTransitioning && (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500/10 px-2.5 py-1.5 text-xs font-medium text-sky-600 dark:text-sky-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {activeOperation?.phase || state}
          </span>
        )}

        {!isTransitioning && state === 'stopped' && (
          <button
            type="button"
            disabled={!canWrite || busy !== null}
            title={disabledReason || 'Start sandbox (1-click)'}
            onClick={() => runAction('start')}
            className={`${btnBase} bg-emerald-600 text-white hover:bg-emerald-500`}
          >
            {busy === 'start' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Start
          </button>
        )}

        {!isTransitioning && state === 'suspended' && (
          <button
            type="button"
            disabled={!canWrite || busy !== null}
            title={disabledReason || 'Wake / Resume paused sandbox (1-click)'}
            onClick={() => runAction('resume')}
            className={`${btnBase} bg-sky-600 text-white hover:bg-sky-500`}
          >
            {busy === 'resume' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            Resume
          </button>
        )}

        {!isTransitioning && state === 'running' && (
          <>
            <button
              type="button"
              disabled={!canWrite || busy !== null}
              title={disabledReason || 'Pause (suspend) sandbox keeping running processes'}
              onClick={() => setConfirmAction('suspend')}
              className={`${btnBase} border border-amber-500/35 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300`}
            >
              {busy === 'suspend' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
              Pause
            </button>
            <button
              type="button"
              disabled={!canWrite || busy !== null}
              title={disabledReason || 'Stop sandbox'}
              onClick={() => {
                setForceStop(false);
                setConfirmAction('stop');
              }}
              className={`${btnBase} border border-rose-500/35 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:text-rose-300`}
            >
              {busy === 'stop' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3 w-3" />}
              Stop
            </button>
          </>
        )}

        {!isTransitioning && state === 'error' && (
          <button
            type="button"
            disabled={!canWrite || busy !== null}
            title={disabledReason || 'Attempt to start sandbox'}
            onClick={() => runAction('start')}
            className={`${btnBase} border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200`}
          >
            <Play className="h-3.5 w-3.5" />
            Start
          </button>
        )}
      </div>

      {/* Confirmation Dialog for Pause / Stop (with explicit Force Stop option) */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          onClick={(e) => {
            e.stopPropagation();
            if (!busy) setConfirmAction(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  confirmAction === 'stop'
                    ? 'bg-rose-500/15 text-rose-500'
                    : 'bg-amber-500/15 text-amber-500'
                }`}
              >
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {confirmAction === 'stop' ? 'Stop Sandbox' : 'Pause Sandbox'}
                </h3>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  {confirmAction === 'stop' ? (
                    <>
                      Shut down <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{machineName}</span>?
                      Running processes will terminate; persistent files in <span className="font-mono">/data</span> are preserved.
                    </>
                  ) : (
                    <>
                      Pause <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{machineName}</span>?
                      Memory and running processes will be suspended and can be resumed later.
                    </>
                  )}
                </p>

                {confirmAction === 'stop' && (
                  <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/5 p-2.5 text-xs">
                    <input
                      type="checkbox"
                      checked={forceStop}
                      onChange={(e) => setForceStop(e.target.checked)}
                      className="mt-0.5 rounded border-slate-400 text-rose-600 focus:ring-rose-500"
                    />
                    <span>
                      <span className="font-semibold text-rose-600 dark:text-rose-400">
                        Force stop immediately (now=true)
                      </span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                        Use only if the VM is hung on graceful shutdown.
                      </span>
                    </span>
                  </label>
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => setConfirmAction(null)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => runAction(confirmAction, confirmAction === 'stop' && forceStop)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${
                  confirmAction === 'stop'
                    ? 'bg-rose-600 hover:bg-rose-500'
                    : 'bg-amber-600 hover:bg-amber-500'
                }`}
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {confirmAction === 'stop' ? (forceStop ? 'Force Stop' : 'Stop VM') : 'Pause VM'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
