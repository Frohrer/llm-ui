import axios from 'axios';
import type { Tool } from './types';

function createCloudflareHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const clientId = process.env.CF_ACCESS_CLIENT_ID;
  const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (clientId && clientSecret) {
    headers['CF-Access-Client-Id'] = clientId;
    headers['CF-Access-Client-Secret'] = clientSecret;
  }
  return headers;
}

interface ManageWorkersParams {
  action: 'list' | 'stop' | 'reset';
  container_id?: string;
}

export const manageWorkersTool: Tool = {
  name: 'manage_workers',
  description: 'Manages supakiln worker containers — the per-(language, package set) cache that backs run_code/run_python. Actions: list (snapshot of live workers grouped by language), stop (force-kill one worker by short or full container ID), reset (kill all workers the caller owns). Useful for evicting a stale environment after a package update or freeing resources. Does not affect persistent services.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'stop', 'reset'],
        description: 'list = snapshot of live workers; stop = kill one (requires container_id); reset = kill all caller-owned workers.',
      },
      container_id: {
        type: 'string',
        description: '12-char short ID or full 64-char container ID. Required for action=stop.',
      },
    },
    required: ['action'],
  },
  execute: async (params: ManageWorkersParams) => {
    if (!params || typeof params !== 'object') {
      return { success: false, error: 'Invalid parameters', message: 'Must provide an object.' };
    }
    const { action, container_id } = params;

    const supakilnUrl = process.env.SUPAKILN_API_URL;
    if (!supakilnUrl) {
      return {
        success: false,
        error: 'Supakiln API URL not configured',
        message: 'SUPAKILN_API_URL environment variable is not set.',
      };
    }

    const headers = createCloudflareHeaders();

    try {
      switch (action) {
        case 'list': {
          const response = await axios.get(`${supakilnUrl}/workers`, { headers });
          const data = response.data || {};
          const totalCount = Object.values(data).reduce(
            (sum: number, workers: any) => sum + (Array.isArray(workers) ? workers.length : 0),
            0,
          );
          return {
            success: true,
            action: 'list',
            workers_by_language: data,
            count: totalCount,
            message: `Found ${totalCount} live worker(s) across ${Object.keys(data).length} language(s)`,
          };
        }
        case 'stop': {
          if (!container_id) {
            return {
              success: false,
              error: 'container_id required',
              message: 'container_id is required for action=stop.',
            };
          }
          const response = await axios.delete(`${supakilnUrl}/workers/${container_id}`, { headers });
          return {
            success: true,
            action: 'stop',
            container_id,
            result: response.data,
            message: `Worker ${container_id} stopped`,
          };
        }
        case 'reset': {
          const response = await axios.post(`${supakilnUrl}/workers/reset`, undefined, { headers });
          const killed = response.data?.killed ?? 0;
          return {
            success: true,
            action: 'reset',
            killed,
            message: `Reset complete: ${killed} worker(s) killed`,
          };
        }
        default:
          return {
            success: false,
            error: 'Invalid action',
            message: `Unknown action: ${action}. Valid: list, stop, reset.`,
          };
      }
    } catch (error) {
      console.error('[supakiln] manage_workers failed:', error);
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED') {
          return {
            success: false,
            error: 'Connection refused',
            message: 'Could not connect to supakiln service.',
          };
        }
        if (error.response) {
          return {
            success: false,
            error: `HTTP ${error.response.status}: ${error.response.statusText}`,
            message: error.response.data?.detail || error.response.data?.error || 'Server error',
            status_code: error.response.status,
          };
        }
      }
      return {
        success: false,
        error: 'Request failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
};
