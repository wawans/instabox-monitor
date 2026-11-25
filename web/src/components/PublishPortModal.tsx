import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { FleetMachine, FleetResponse, PublicPort } from '../types/instabox';

export const RESERVED_PORTS: Record<number, string> = {
  5901: 'InstaBox Desktop (VNC)',
  6768: 'Orca agent daemon',
};

export interface PortModalTarget {
  accountId: string;
  accountName?: string;
  machineId: string;
  machineName?: string;
  machineState?: string;
  portsCount?: number;
  canWrite?: boolean;
}

export function validatePortInput(raw: string): { port?: number; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { error: 'Enter a port number between 1024 and 65535.' };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { error: 'Port must be a whole number.' };
  }
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) {
    return { error: 'Port must be between 1024 and 65535.' };
  }
  if (RESERVED_PORTS[n]) {
    return { error: `Port ${n} is reserved for ${RESERVED_PORTS[n]}.` };
  }
  return { port: n };
}

function TokenRevealContent({
  port,
  machineName,
  onClose,
}: {
  port: PublicPort;
  machineName?: string;
  onClose: () => void;
}) {
  const [copiedKey, setCopiedKey] = useState<'tokenUrl' | 'token' | 'curl' | null>(null);
  const [showSecret, setShowSecret] = useState(true);

  const copyValue = async (key: 'tokenUrl' | 'token' | 'curl', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
    } catch {
      // Clipboard may be blocked in insecure contexts
    }
  };

  const token = port.token || '';
  const tokenUrl = port.tokenUrl || '';
  const curlCmd = token
    ? `curl -H "Authorization: Bearer ${token}" "${port.url}"`
    : tokenUrl
      ? `curl "${tokenUrl}"`
      : '';

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500">
          <KeyRound className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            One-Time Private Port Credentials
          </h3>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
            Port <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">:{port.port}</span>
            {port.name ? ` (${port.name})` : ''}
            {machineName ? (
              <>
                {' '}
                on <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{machineName}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div>
          <span className="font-semibold">Save this secret now.</span> InstaBox only returns private port tokens once
          on creation or rotation. InstaBox Monitor does not store tokens in memory, database snapshots, or logs — if
          lost, rotate the token to issue a new one.
        </div>
      </div>

      {tokenUrl && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <span>Authenticated URL (?_token=...)</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void copyValue('tokenUrl', tokenUrl)}
                className="inline-flex items-center gap-1 font-sans text-xs font-medium normal-case text-sky-600 hover:text-sky-500 dark:text-sky-400"
              >
                {copiedKey === 'tokenUrl' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedKey === 'tokenUrl' ? 'Copied' : 'Copy URL'}
              </button>
              <a
                href={tokenUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-sans text-xs font-medium normal-case text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"
              >
                Open <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
          <div className="select-all break-all rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
            {showSecret ? tokenUrl : `${port.url}?_token=••••••••••••••••••••`}
          </div>
        </div>
      )}

      {token && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <span>Bearer Token</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowSecret((prev) => !prev)}
                className="inline-flex items-center gap-1 font-sans text-xs font-medium normal-case text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              >
                {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showSecret ? 'Hide' : 'Reveal'}
              </button>
              <button
                type="button"
                onClick={() => void copyValue('token', token)}
                className="inline-flex items-center gap-1 font-sans text-xs font-medium normal-case text-sky-600 hover:text-sky-500 dark:text-sky-400"
              >
                {copiedKey === 'token' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedKey === 'token' ? 'Copied' : 'Copy Token'}
              </button>
            </div>
          </div>
          <div className="select-all break-all rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
            {showSecret ? token : 'ibp_••••••••••••••••••••••••••••••••'}
          </div>
        </div>
      )}

      {curlCmd && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <span>cURL Example</span>
            <button
              type="button"
              onClick={() => void copyValue('curl', curlCmd)}
              className="inline-flex items-center gap-1 font-sans text-xs font-medium normal-case text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            >
              {copiedKey === 'curl' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedKey === 'curl' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-950 p-2.5 font-mono text-[11px] text-slate-200 dark:border-slate-800">
            {showSecret ? curlCmd : `curl -H "Authorization: Bearer ibp_••••••••" "${port.url}"`}
          </pre>
        </div>
      )}

      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
        >
          I&apos;ve Saved the Credentials
        </button>
      </div>
    </div>
  );
}

export function TokenRevealModal({
  port,
  machineName,
  onClose,
}: {
  port: PublicPort | null;
  machineName?: string;
  onClose: () => void;
}) {
  if (!port) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <TokenRevealContent port={port} machineName={machineName} onClose={onClose} />
      </div>
    </div>
  );
}

export function RotateTokenModal({
  target,
  onClose,
  onRotated,
}: {
  target: { accountId: string; machineId: string; machineName?: string; port: PublicPort } | null;
  onClose: () => void;
  onRotated: (updated: PublicPort) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    setBusy(false);
  }, [target]);

  if (!target) return null;

  const handleConfirm = async () => {
    setBusy(true);
    setError('');
    try {
      const updated = await api.publishPort(target.accountId, target.machineId, {
        port: target.port.port,
        name: target.port.name,
        protocol: target.port.protocol === 'tcp' ? 'tcp' : 'http',
        access: 'private',
        rotateToken: true,
        machineName: target.machineName,
      });
      onRotated(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to rotate port token');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500">
            <RefreshCw className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Rotate Private Port Token
            </h3>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Generate a new access token for port{' '}
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">:{target.port.port}</span>
              {target.port.name ? ` (${target.port.name})` : ''}{' '}
              on{' '}
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {target.machineName || target.machineId}
              </span>
              ? The previous token will stop working immediately.
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-600 dark:text-rose-400">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleConfirm()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
            Rotate Token
          </button>
        </div>
      </div>
    </div>
  );
}

export function UnpublishPortModal({
  target,
  onClose,
  onUnpublished,
}: {
  target: { accountId: string; machineId: string; machineName?: string; port: PublicPort } | null;
  onClose: () => void;
  onUnpublished: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    setBusy(false);
  }, [target]);

  if (!target) return null;

  const handleConfirm = async () => {
    setBusy(true);
    setError('');
    try {
      await api.unpublishPort(target.accountId, target.machineId, target.port.port, target.machineName);
      onUnpublished();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to unpublish port');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-500">
            <Trash2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Unpublish Port :{target.port.port}
            </h3>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Remove published endpoint{' '}
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {target.port.address || target.port.url}
              </span>{' '}
              from{' '}
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {target.machineName || target.machineId}
              </span>
              ? External requests will return <span className="font-mono">404</span> immediately.
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-600 dark:text-rose-400">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleConfirm()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Unpublish Port
          </button>
        </div>
      </div>
    </div>
  );
}

export function PublishPortModal({
  isOpen,
  onClose,
  fleet,
  fixedTarget,
  editingPort,
  defaultAccountId,
  defaultMachineId,
  onPublished,
}: {
  isOpen: boolean;
  onClose: () => void;
  fleet?: FleetResponse | null;
  fixedTarget?: PortModalTarget;
  editingPort?: PublicPort | null;
  defaultAccountId?: string;
  defaultMachineId?: string;
  onPublished: (result: PublicPort) => void;
}) {
  const isEdit = Boolean(editingPort);

  const [accountId, setAccountId] = useState('');
  const [machineId, setMachineId] = useState('');
  const [portInput, setPortInput] = useState('3000');
  const [nameInput, setNameInput] = useState('');
  const [protocol, setProtocol] = useState<'http' | 'tcp'>('http');
  const [access, setAccess] = useState<'public' | 'private'>('public');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [revealedPort, setRevealedPort] = useState<PublicPort | null>(null);

  const accounts = fleet?.accounts ?? [];
  const machines = fleet?.machines ?? [];

  useEffect(() => {
    if (!isOpen) return;
    setSubmitError('');
    setRevealedPort(null);
    setSubmitting(false);

    if (editingPort) {
      setAccountId(editingPort.accountId || fixedTarget?.accountId || '');
      setMachineId(editingPort.machineId || fixedTarget?.machineId || '');
      setPortInput(String(editingPort.port));
      setNameInput(editingPort.name || '');
      const proto = editingPort.protocol === 'tcp' ? 'tcp' : 'http';
      setProtocol(proto);
      setAccess(proto === 'tcp' ? 'public' : editingPort.access);
      return;
    }

    if (fixedTarget) {
      setAccountId(fixedTarget.accountId);
      setMachineId(fixedTarget.machineId);
    } else {
      const preferredAccount =
        accounts.find((a) => a.id === defaultAccountId) ||
        accounts.find((a) => a.canWrite && a.enabled) ||
        accounts[0];
      const nextAccId = preferredAccount?.id || '';
      setAccountId(nextAccId);
      const matchingVMs = machines.filter((m) => m.accountId === nextAccId);
      const preferredVM = matchingVMs.find((m) => m.id === defaultMachineId) || matchingVMs[0];
      setMachineId(preferredVM?.id || '');
    }

    setPortInput('3000');
    setNameInput('');
    setProtocol('http');
    setAccess('public');
  }, [isOpen, editingPort, fixedTarget, defaultAccountId, defaultMachineId, accounts, machines]);

  const accountVMs: FleetMachine[] = useMemo(
    () => machines.filter((m) => m.accountId === accountId),
    [machines, accountId],
  );

  const selectedAccount = accounts.find((a) => a.id === accountId);
  const selectedVM = accountVMs.find((m) => m.id === machineId);

  const resolvedAccountName = fixedTarget?.accountName || selectedAccount?.name || editingPort?.accountName || accountId;
  const resolvedMachineName = fixedTarget?.machineName || selectedVM?.name || editingPort?.machineName || machineId;
  const resolvedMachineState = fixedTarget?.machineState || selectedVM?.state || editingPort?.machineState || '';
  const resolvedPortsCount =
    fixedTarget?.portsCount !== undefined ? fixedTarget.portsCount : selectedVM?.portsCount;
  const resolvedCanWrite =
    fixedTarget?.canWrite !== undefined
      ? fixedTarget.canWrite
      : selectedAccount
        ? selectedAccount.canWrite
        : editingPort?.canWrite ?? true;

  const portValidation = validatePortInput(portInput);
  const quotaReached = !isEdit && resolvedPortsCount !== undefined && resolvedPortsCount >= 16;
  const accessChanged = isEdit && editingPort ? access !== editingPort.access : false;

  if (!isOpen) return null;

  const handleAccountChange = (nextAccId: string) => {
    setAccountId(nextAccId);
    const nextVMs = machines.filter((m) => m.accountId === nextAccId);
    setMachineId(nextVMs[0]?.id || '');
  };

  const handleProtocolChange = (nextProto: 'http' | 'tcp') => {
    if (isEdit) return;
    setProtocol(nextProto);
    if (nextProto === 'tcp') {
      setAccess('public');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId || !machineId || !resolvedCanWrite || quotaReached) return;
    if (!isEdit && portValidation.error) return;

    const portNum = isEdit && editingPort ? editingPort.port : portValidation.port!;
    setSubmitting(true);
    setSubmitError('');

    try {
      const result = await api.publishPort(accountId, machineId, {
        port: portNum,
        name: nameInput.trim(),
        protocol,
        access: protocol === 'tcp' ? 'public' : access,
        machineName: resolvedMachineName,
      });
      onPublished(result);
      if (result.token || result.tokenUrl) {
        setRevealedPort(result);
      } else {
        onClose();
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setSubmitError(err.hint ? `${err.message} (${err.hint})` : err.message);
      } else {
        setSubmitError('Failed to save published port');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    setRevealedPort(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {revealedPort ? (
          <TokenRevealContent port={revealedPort} machineName={resolvedMachineName} onClose={handleClose} />
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-500">
                  <Plus className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {isEdit ? `Edit Port :${editingPort?.port}` : 'Publish Sandbox Port'}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {isEdit
                      ? 'Update port label or access mode. Port number and protocol cannot be modified.'
                      : 'Expose a sandbox TCP or HTTP service via InstaBox public ingress.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={handleClose}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!resolvedCanWrite && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <span>
                  Account <span className="font-semibold">{resolvedAccountName}</span> is disabled, read-only, or lacks{' '}
                  <span className="font-mono">machines:write</span> scope.
                </span>
              </div>
            )}

            {/* Account & Target VM */}
            {fixedTarget || isEdit ? (
              <div className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/60 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] font-medium text-slate-500">Account</div>
                  <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">{resolvedAccountName}</div>
                </div>
                <div>
                  <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
                    <span>Target Sandbox</span>
                    {resolvedPortsCount !== undefined && (
                      <span
                        className={`font-mono ${
                          quotaReached ? 'font-semibold text-rose-500' : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {resolvedPortsCount}/16 ports
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {resolvedMachineName}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Account</label>
                  <select
                    value={accountId}
                    onChange={(e) => handleAccountChange(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {accounts.length === 0 && <option value="">No accounts</option>}
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} {!acc.canWrite ? '(Read-Only / No Write)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Sandbox VM</label>
                    {resolvedPortsCount !== undefined && (
                      <span
                        className={`font-mono text-[11px] ${
                          quotaReached ? 'font-semibold text-rose-500' : 'text-slate-500'
                        }`}
                      >
                        {resolvedPortsCount} / 16 ports
                      </span>
                    )}
                  </div>
                  <select
                    value={machineId}
                    onChange={(e) => setMachineId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {accountVMs.length === 0 && <option value="">No VMs in account</option>}
                    {accountVMs.map((vm) => (
                      <option key={vm.id} value={vm.id}>
                        {vm.name} ({vm.state}) · {vm.portsCount}/16
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {quotaReached && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Maximum quota of 16 exposed ports reached on this sandbox. Unpublish a port first.</span>
              </div>
            )}

            {resolvedMachineState && resolvedMachineState !== 'running' && (
              <div className="flex items-start gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-700 dark:text-sky-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                <span>
                  This sandbox is currently <span className="font-mono font-semibold">{resolvedMachineState}</span>.
                  Publishing succeeds now, but the endpoint will return HTTP <span className="font-mono">503</span> until
                  the VM is running.
                </span>
              </div>
            )}

            {/* Port Number & Name */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Port (1024–65535)</label>
                  {!isEdit && (
                    <div className="flex gap-1">
                      {[3000, 5173, 8080].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setPortInput(String(preset))}
                          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  disabled={isEdit}
                  value={portInput}
                  onChange={(e) => setPortInput(e.target.value)}
                  placeholder="3000"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:border-sky-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:disabled:bg-slate-800"
                />
                {!isEdit && portValidation.error ? (
                  <p className="mt-1 text-[11px] text-rose-500">{portValidation.error}</p>
                ) : (
                  <p className="mt-1 text-[11px] text-slate-500">Reserved: 5901 (Desktop), 6768 (Orca)</p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Name <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  type="text"
                  maxLength={64}
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="e.g. web, api, vite"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <p className="mt-1 text-[11px] text-slate-500">Helpful service label in Ports table.</p>
              </div>
            </div>

            {/* Protocol & Access */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">Protocol</label>
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-950">
                  {(['http', 'tcp'] as const).map((proto) => (
                    <button
                      key={proto}
                      type="button"
                      disabled={isEdit}
                      onClick={() => handleProtocolChange(proto)}
                      className={`rounded-md py-1.5 text-xs font-semibold uppercase transition-colors disabled:cursor-not-allowed ${
                        protocol === proto
                          ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                      }`}
                    >
                      {proto}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {isEdit
                    ? 'Immutable after creation (unpublish first to switch).'
                    : protocol === 'tcp'
                      ? 'TCP routes TLS via SNI on paid plans (Public only).'
                      : 'HTTPS subdomain routing via InstaBox ingress.'}
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">Access Mode</label>
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-950">
                  <button
                    type="button"
                    onClick={() => setAccess('public')}
                    className={`inline-flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${
                      access === 'public'
                        ? 'bg-white text-emerald-600 shadow-xs dark:bg-slate-800 dark:text-emerald-400'
                        : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                    }`}
                  >
                    <Globe className="h-3.5 w-3.5" />
                    Public
                  </button>
                  <button
                    type="button"
                    disabled={protocol === 'tcp'}
                    title={protocol === 'tcp' ? 'TCP ports do not support private token access' : undefined}
                    onClick={() => setAccess('private')}
                    className={`inline-flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                      access === 'private'
                        ? 'bg-white text-amber-600 shadow-xs dark:bg-slate-800 dark:text-amber-400'
                        : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                    }`}
                  >
                    <Lock className="h-3.5 w-3.5" />
                    Private
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {protocol === 'tcp'
                    ? 'Locked to Public for TCP TLS SNI endpoints.'
                    : access === 'private'
                      ? 'Issues one-time ?_token & Bearer secret.'
                      : 'Accessible without a port token.'}
                </p>
              </div>
            </div>

            {accessChanged && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <span>
                  Changing access mode from <span className="font-mono font-semibold">{editingPort?.access}</span> to{' '}
                  <span className="font-mono font-semibold">{access}</span> will update ingress authorization and may
                  interrupt active connections.
                </span>
              </div>
            )}

            {submitError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400">
                {submitError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={submitting}
                onClick={handleClose}
                className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  submitting ||
                  !accountId ||
                  !machineId ||
                  !resolvedCanWrite ||
                  quotaReached ||
                  (!isEdit && Boolean(portValidation.error))
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {isEdit ? 'Save Changes' : 'Publish Port'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
