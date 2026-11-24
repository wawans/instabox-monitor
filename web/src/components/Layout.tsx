import { Activity, Globe, KeyRound, LogOut, Moon, Server, Sun } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import type { SSEState } from '../lib/api';

export function Layout({
  children,
  sseState,
  darkMode,
  onToggleTheme,
  authEnabled,
  username,
  onLogout,
  vmCount,
  accountCount,
  portCount,
}: {
  children: React.ReactNode;
  sseState: SSEState;
  darkMode: boolean;
  onToggleTheme: () => void;
  authEnabled: boolean;
  username?: string;
  onLogout: () => void;
  vmCount: number;
  accountCount: number;
  portCount: number;
}) {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
      isActive
        ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100'
    }`;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-4">
            <NavLink to="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-500">
                <Activity className="h-4 w-4" />
              </span>
              <span className="text-base">InstaBox Monitor</span>
            </NavLink>

            <nav className="flex items-center gap-1">
              <NavLink to="/" end className={linkClass}>
                <Server className="h-4 w-4" />
                <span>Fleet</span>
                <span className="ml-0.5 rounded-full bg-slate-200/80 px-1.5 py-0.2 text-[11px] font-mono dark:bg-slate-800">
                  {vmCount}
                </span>
              </NavLink>
              <NavLink to="/ports" className={linkClass}>
                <Globe className="h-4 w-4" />
                <span className="hidden sm:inline">Ports</span>
                <span className="ml-0.5 rounded-full bg-slate-200/80 px-1.5 py-0.2 text-[11px] font-mono dark:bg-slate-800">
                  {portCount}
                </span>
              </NavLink>
              <NavLink to="/accounts" className={linkClass}>
                <KeyRound className="h-4 w-4" />
                <span className="hidden sm:inline">Accounts</span>
                <span className="ml-0.5 rounded-full bg-slate-200/80 px-1.5 py-0.2 text-[11px] font-mono dark:bg-slate-800">
                  {accountCount}
                </span>
              </NavLink>
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-xs font-mono text-slate-600 dark:border-slate-800 dark:text-slate-400"
              title="Real-time Server-Sent Events stream status"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  sseState === 'connected'
                    ? 'bg-emerald-500'
                    : sseState === 'reconnecting'
                      ? 'bg-amber-500 animate-pulse'
                      : 'bg-sky-500 animate-pulse'
                }`}
              />
              {sseState === 'connected' ? 'SSE Live' : sseState === 'reconnecting' ? 'Reconnecting' : 'Connecting'}
            </span>

            <button
              type="button"
              onClick={onToggleTheme}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
              title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {authEnabled && (
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                title={`Sign out (${username || 'admin'})`}
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5">{children}</main>
    </div>
  );
}
