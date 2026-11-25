import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { api, ApiError, useSSE } from './lib/api';
import { AccountsPage } from './pages/AccountsPage';
import { FleetPage } from './pages/FleetPage';
import { LoginPage } from './pages/LoginPage';
import { PortsPage } from './pages/PortsPage';
import { VMDetailPage } from './pages/VMDetailPage';
import type { AuthStatus, FleetResponse, Operation, SSEEvent } from './types/instabox';

export default function App() {
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('instabox-monitor-theme');
    return saved ? saved === 'dark' : true;
  });

  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [fleet, setFleet] = useState<FleetResponse | null>(null);
  const [fleetLoading, setFleetLoading] = useState(true);
  const [activeOps, setActiveOps] = useState<Record<string, Operation>>({});

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('instabox-monitor-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const loadAuth = useCallback(async () => {
    try {
      const status = await api.getAuthStatus();
      setAuth(status);
    } catch {
      setAuth({ authEnabled: false, authenticated: true });
    }
  }, []);

  const loadFleet = useCallback(async () => {
    try {
      const data = await api.getFleet();
      setFleet(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuth((prev) => ({ authEnabled: true, authenticated: false, username: prev?.username }));
      }
    } finally {
      setFleetLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAuth();
  }, [loadAuth]);

  const isAuthed = Boolean(auth && (!auth.authEnabled || auth.authenticated));

  useEffect(() => {
    if (isAuthed) {
      void loadFleet();
    }
  }, [isAuthed, loadFleet]);

  const handleSSEEvent = useCallback(
    (ev: SSEEvent) => {
      if (ev.type === 'fleet_updated' || ev.type === 'account_updated') {
        void loadFleet();
      } else if (ev.type === 'operation_updated' && ev.accountId && ev.machineId && ev.payload) {
        const key = `${ev.accountId}:${ev.machineId}`;
        const op = ev.payload;
        setActiveOps((prev) => ({ ...prev, [key]: op }));
        if (op.state === 'succeeded' || op.state === 'failed') {
          void loadFleet();
          setTimeout(() => {
            setActiveOps((prev) => {
              const next = { ...prev };
              if (next[key]?.id === op.id) delete next[key];
              return next;
            });
          }, 8000);
        }
      }
    },
    [loadFleet],
  );

  const sseState = useSSE(isAuthed, handleSSEEvent);

  const handleOperationStarted = (accountId: string, machineId: string, op: Operation) => {
    setActiveOps((prev) => ({ ...prev, [`${accountId}:${machineId}`]: op }));
  };

  const handleLogout = async () => {
    await api.logout();
    setAuth({ authEnabled: true, authenticated: false });
    setFleet(null);
  };

  if (!auth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading InstaBox Monitor...
      </div>
    );
  }

  if (auth.authEnabled && !auth.authenticated) {
    return (
      <LoginPage
        onSuccess={(username) => {
          setAuth({ authEnabled: true, authenticated: true, username });
        }}
      />
    );
  }

  const totalPorts = (fleet?.machines ?? []).reduce((sum, m) => sum + (m.portsCount ?? 0), 0);

  return (
    <BrowserRouter>
      <Layout
        sseState={sseState}
        darkMode={darkMode}
        onToggleTheme={() => setDarkMode((d) => !d)}
        authEnabled={auth.authEnabled}
        username={auth.username}
        onLogout={handleLogout}
        vmCount={fleet?.summary.totalVMs ?? 0}
        accountCount={fleet?.summary.totalAccounts ?? 0}
        portCount={totalPorts}
      >
        <Routes>
          <Route
            path="/"
            element={
              <FleetPage
                fleet={fleet}
                loading={fleetLoading}
                activeOps={activeOps}
                onOperationStarted={handleOperationStarted}
                onRefresh={loadFleet}
              />
            }
          />
          <Route
            path="/accounts/:accountId/vms/:machineId"
            element={
              <VMDetailPage
                activeOps={activeOps}
                onOperationStarted={handleOperationStarted}
                onFleetRefresh={loadFleet}
              />
            }
          />
          <Route
            path="/ports"
            element={
              <PortsPage
                fleet={fleet}
                activeOps={activeOps}
                onOperationStarted={handleOperationStarted}
                onFleetRefresh={loadFleet}
              />
            }
          />
          <Route path="/accounts" element={<AccountsPage onAccountsChanged={loadFleet} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
