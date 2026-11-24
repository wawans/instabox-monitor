import { Check, Copy, ExternalLink, Globe, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { VMStateBadge } from '../components/StateBadge';
import { api } from '../lib/api';
import type { PublicPort } from '../types/instabox';

export function PortsPage() {
  const [ports, setPorts] = useState<PublicPort[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessFilter, setAccessFilter] = useState('');
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api
      .getPorts()
      .then((res) => setPorts(res.ports ?? []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ports.filter((p) => {
      if (accessFilter && p.access !== accessFilter) return false;
      if (q) {
        const hay = `${p.machineName} ${p.accountName} ${p.url} ${p.port} ${p.name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [ports, accessFilter, search]);

  const copyUrl = (id: string, url: string) => {
    void navigator.clipboard.writeText(url);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-bold">Exposed Ports</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Aggregated HTTP &amp; TCP ports across all connected InstaBox accounts
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search URL, sandbox, port..."
              className="rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs outline-none focus:border-sky-500 dark:border-slate-800 dark:bg-slate-900"
            />
          </div>
          <select
            value={accessFilter}
            onChange={(e) => setAccessFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-sky-500 dark:border-slate-800 dark:bg-slate-900"
          >
            <option value="">All Access</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </div>
      </div>

      {!loading && filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/70">
          <Globe className="mx-auto mb-2 h-8 w-8 text-slate-400" />
          No exposed ports found.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                  <th className="px-4 py-3">Sandbox / Account</th>
                  <th className="px-4 py-3">Port &amp; Access</th>
                  <th className="px-4 py-3">Endpoint URL</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filtered.map((p) => (
                  <tr key={`${p.accountId}:${p.id}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {p.accountId ? (
                          <Link
                            to={`/accounts/${p.accountId}/vms/${p.machineId}`}
                            className="font-semibold text-sky-600 hover:underline dark:text-sky-400"
                          >
                            {p.machineName || p.machineId}
                          </Link>
                        ) : (
                          <span className="font-semibold">{p.machineName || p.machineId}</span>
                        )}
                        {p.machineState && <VMStateBadge state={p.machineState} />}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">{p.accountName}</div>
                    </td>
                    <td className="px-4 py-3 font-mono">
                      <span className="font-semibold">:{p.port}</span>
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase dark:bg-slate-800">
                        {p.protocol}
                      </span>
                      <span
                        className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] uppercase ${
                          p.access === 'public'
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : 'bg-amber-500/15 text-amber-500'
                        }`}
                      >
                        {p.access}
                      </span>
                    </td>
                    <td className="max-w-sm truncate px-4 py-3 font-mono text-sky-600 dark:text-sky-400">
                      {p.url}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => copyUrl(p.id, p.url)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                        >
                          {copied === p.id ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                          Copy
                        </button>
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Open
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
