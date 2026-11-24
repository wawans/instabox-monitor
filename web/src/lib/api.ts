import { useEffect, useRef, useState } from 'react';
import type {
  Account,
  ActivityEvent,
  AuthStatus,
  BulkCreateAccountsResponse,
  FleetResponse,
  Machine,
  MachineDisk,
  MachineLogsResponse,
  MachineMetricsResponse,
  Operation,
  Org,
  ProcessListResponse,
  PublicPort,
  SSEEvent,
  WakeAllResponse,
} from '../types/instabox';

export class ApiError extends Error {
  status: number;
  code: string;
  hint?: string;

  constructor(status: number, code: string, message: string, hint?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const errObj = (data as { error?: { code?: string; message?: string; hint?: string } } | null)?.error;
    throw new ApiError(
      res.status,
      errObj?.code ?? 'http_error',
      errObj?.message ?? res.statusText ?? 'Request failed',
      errObj?.hint,
    );
  }
  return data as T;
}

export const api = {
  getAuthStatus: () => request<AuthStatus>('/api/auth/status'),
  login: (username: string, password: string) =>
    request<AuthStatus>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  getFleet: () => request<FleetResponse>('/api/fleet'),
  syncAll: () => request<{ ok: boolean }>('/api/fleet/sync', { method: 'POST' }),
  wakeAll: (filter: { accountId?: string; orgId?: string; search?: string; machineIds?: string[] }) =>
    request<WakeAllResponse>('/api/fleet/wake-all', {
      method: 'POST',
      body: JSON.stringify(filter),
    }),

  getPorts: () => request<{ ports: PublicPort[] }>('/api/ports'),
  getActivity: () => request<{ events: ActivityEvent[] }>('/api/activity'),

  listAccounts: () => request<{ accounts: Account[]; seedMode: string }>('/api/accounts'),
  testAccount: (apiKey: string, baseUrl: string) =>
    request<{ ok: boolean; me: { login: string; email: string; name: string }; orgs: Org[] }>('/api/accounts/test', {
      method: 'POST',
      body: JSON.stringify({ apiKey, baseUrl }),
    }),
  createAccount: (payload: {
    name: string;
    slug?: string;
    apiKey: string;
    baseUrl?: string;
    readOnly?: boolean;
    enabled?: boolean;
    validate?: boolean;
  }) =>
    request<Account>('/api/accounts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  bulkCreateAccounts: (payload: {
    raw?: string;
    items?: Array<{ name?: string; slug?: string; apiKey: string; baseUrl?: string; readOnly?: boolean }>;
    validate: boolean;
    readOnly?: boolean;
    baseUrl?: string;
  }) =>
    request<BulkCreateAccountsResponse>('/api/accounts/bulk', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateAccount: (
    id: string,
    payload: { name?: string; apiKey?: string; baseUrl?: string; readOnly?: boolean; enabled?: boolean },
  ) =>
    request<Account>(`/api/accounts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteAccount: (id: string) =>
    request<{ ok: boolean }>(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  syncAccount: (id: string) =>
    request<{ ok: boolean }>(`/api/accounts/${encodeURIComponent(id)}/sync`, { method: 'POST' }),

  getVM: (accountId: string, machineId: string) =>
    request<{ account: Account; machine: Machine; ports: PublicPort[] }>(
      `/api/accounts/${encodeURIComponent(accountId)}/vms/${encodeURIComponent(machineId)}`,
    ),
  getVMMetrics: (accountId: string, machineId: string, since: string) =>
    request<MachineMetricsResponse>(
      `/api/accounts/${encodeURIComponent(accountId)}/vms/${encodeURIComponent(machineId)}/metrics?since=${encodeURIComponent(since)}`,
    ),
  getVMDisk: (accountId: string, machineId: string) =>
    request<MachineDisk>(
      `/api/accounts/${encodeURIComponent(accountId)}/vms/${encodeURIComponent(machineId)}/disk`,
    ),
  getVMProcesses: (accountId: string, machineId: string) =>
    request<ProcessListResponse>(
      `/api/accounts/${encodeURIComponent(accountId)}/vms/${encodeURIComponent(machineId)}/processes`,
    ),
  getVMLogs: (accountId: string, machineId: string, tail = 200, after = 0) =>
    request<MachineLogsResponse>(
      `/api/accounts/${encodeURIComponent(accountId)}/vms/${encodeURIComponent(machineId)}/logs?tail=${tail}&after=${after}`,
    ),
  vmAction: (
    accountId: string,
    machineId: string,
    action: 'start' | 'stop' | 'suspend' | 'resume',
    opts?: { force?: boolean; machineName?: string },
  ) =>
    request<Operation>(
      `/api/accounts/${encodeURIComponent(accountId)}/vms/${encodeURIComponent(machineId)}/actions/${action}`,
      {
        method: 'POST',
        body: JSON.stringify(opts ?? {}),
      },
    ),
};

export type SSEState = 'connecting' | 'connected' | 'reconnecting';

export function useSSE(enabled: boolean, onEvent: (ev: SSEEvent) => void): SSEState {
  const [state, setState] = useState<SSEState>('connecting');
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    let closed = false;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      es = new EventSource('/api/events');
      es.onopen = () => {
        if (!closed) setState('connected');
      };
      es.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(msg.data) as SSEEvent;
          if (parsed.type === 'connected') {
            setState('connected');
            return;
          }
          cbRef.current(parsed);
        } catch {
          // ignore non-JSON pings
        }
      };
      es.onerror = () => {
        if (closed) return;
        setState('reconnecting');
        es?.close();
        retryTimer = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [enabled]);

  return state;
}
