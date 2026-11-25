import { AlertTriangle, Check, Copy, ExternalLink, Terminal } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { PublicPort } from '../types/instabox';

export function parseTcpAddress(port: PublicPort): {
  address: string;
  host: string;
  tcpPort: string;
} {
  const raw = (port.address || port.url.replace(/^tls:\/\//i, '')).trim();
  const lastColon = raw.lastIndexOf(':');
  if (lastColon > 0 && lastColon < raw.length - 1) {
    return {
      address: raw,
      host: raw.slice(0, lastColon),
      tcpPort: raw.slice(lastColon + 1),
    };
  }
  return {
    address: raw,
    host: raw,
    tcpPort: '443',
  };
}

export function buildTcpOpenSSLCommand(port: PublicPort): string {
  const { address, host } = parseTcpAddress(port);
  return `openssl s_client -connect ${address} -servername ${host}`;
}

export function buildTcpPsqlCommand(port: PublicPort): string {
  const { host, tcpPort } = parseTcpAddress(port);
  return `psql "host=${host} port=${tcpPort} sslmode=require"`;
}

export function PortEndpoint({
  port,
  compact = false,
  offlineAction,
}: {
  port: PublicPort;
  compact?: boolean;
  offlineAction?: ReactNode;
}) {
  const [copiedKey, setCopiedKey] = useState<'url' | 'sni' | 'openssl' | 'psql' | null>(null);

  const isTcp = port.protocol.toLowerCase() === 'tcp';
  const { address } = parseTcpAddress(port);
  const endpoint = isTcp ? address : port.url || port.address || '';
  const isOffline = Boolean(port.machineState && port.machineState !== 'running');

  const copyText = async (key: 'url' | 'sni' | 'openssl' | 'psql', value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1500);
    } catch {
      // Clipboard may fail in non-HTTPS contexts
    }
  };

  return (
    <div className="space-y-1">
      {isTcp ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-indigo-600 dark:text-indigo-400">
              TLS SNI
            </span>
            <span
              className={`truncate font-mono ${compact ? 'max-w-[220px] text-[11px]' : 'max-w-[260px] text-xs'} text-slate-800 dark:text-slate-200`}
              title={address}
            >
              {address || port.url}
            </span>
            <button
              type="button"
              onClick={() => void copyText('sni', address || port.url)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              title="Copy host:port SNI address"
            >
              {copiedKey === 'sni' ? (
                <Check className="h-3 w-3 text-emerald-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              <span>{copiedKey === 'sni' ? 'Copied' : 'SNI'}</span>
            </button>
          </div>

          {address && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => void copyText('openssl', buildTcpOpenSSLCommand(port))}
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                title={buildTcpOpenSSLCommand(port)}
              >
                {copiedKey === 'openssl' ? (
                  <Check className="h-2.5 w-2.5 text-emerald-500" />
                ) : (
                  <Terminal className="h-2.5 w-2.5" />
                )}
                openssl
              </button>
              <button
                type="button"
                onClick={() => void copyText('psql', buildTcpPsqlCommand(port))}
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                title={buildTcpPsqlCommand(port)}
              >
                {copiedKey === 'psql' ? (
                  <Check className="h-2.5 w-2.5 text-emerald-500" />
                ) : (
                  <Copy className="h-2.5 w-2.5" />
                )}
                psql
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {port.url ? (
            <a
              href={port.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`${compact ? 'max-w-[220px] text-[11px]' : 'max-w-[260px] text-xs'} truncate font-mono text-sky-600 hover:underline dark:text-sky-400`}
              title={port.url}
            >
              {port.url}
            </a>
          ) : (
            <span className={`font-mono ${compact ? 'text-[11px]' : 'text-xs'} text-slate-700 dark:text-slate-300`}>
              {endpoint}
            </span>
          )}
          {endpoint && (
            <button
              type="button"
              onClick={() => void copyText('url', endpoint)}
              className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              title="Copy URL"
            >
              {copiedKey === 'url' ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          {port.url && (
            <a
              href={port.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              title="Open URL"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      )}

      {(isOffline || offlineAction || (!isTcp && port.access === 'private')) && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {isOffline && (
            <span
              className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"
              title="Endpoint returns HTTP 503 while sandbox is stopped or suspended"
            >
              <AlertTriangle className="h-3 w-3" />
              VM {port.machineState} (503)
            </span>
          )}
          {offlineAction}
          {!isTcp && port.access === 'private' && (
            <span className="text-slate-400">Token hidden (rotate to reissue)</span>
          )}
        </div>
      )}
    </div>
  );
}
