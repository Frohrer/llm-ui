import axios from 'axios';
import type { Tool } from './types';

// Helper function to create Cloudflare Access headers for service-to-service authentication
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

export const manageContainersTool: Tool = {
  name: 'manage_containers',
  description: 'Manages supakiln containers for persistent Python environments. Can create, list, get details, and delete containers with pre-installed packages. IMPORTANT: Always provide the action parameter as a string.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'list', 'get', 'delete', 'cleanup_all'],
        description: 'The action to perform: create (new container), list (all containers), get (container details), delete (specific container), cleanup_all (delete all containers)'
      },
      name: {
        type: 'string',
        description: 'Name for the container (required for create action)'
      },
      packages: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'List of Python packages to install in the container (required for create action)',
        default: []
      },
      container_id: {
        type: 'string',
        description: 'Container ID (required for get and delete actions)'
      }
    },
    required: ['action']
  },
  execute: async (params: { 
    action: 'create' | 'list' | 'get' | 'delete' | 'cleanup_all';
    name?: string;
    packages?: string[];
    container_id?: string;
  }) => {
    try {
      // Handle case where params might be undefined or malformed
      if (!params || typeof params !== 'object') {
        return {
          success: false,
          error: 'Invalid parameters',
          message: 'Tool parameters must be provided as an object. Received: ' + typeof params
        };
      }

      const { action, name, packages = [], container_id } = params;
      
      // Debug logging
      console.log('manage_containers tool called with params:', {
        action,
        name,
        packages: packages?.length || 0,
        container_id
      });

      // Validate action parameter
      if (!action || typeof action !== 'string') {
        return {
          success: false,
          error: 'Invalid action parameter',
          message: 'The action parameter is required and must be a string. Valid actions: create, list, get, delete, cleanup_all. Received: ' + typeof action
        };
      }
      
      // Get supakiln API URL from environment variables
      const supakilnUrl = process.env.SUPAKILN_API_URL;
      if (!supakilnUrl) {
        return {
          success: false,
          error: 'Supakiln API URL not configured',
          message: 'SUPAKILN_API_URL environment variable is not set. Please configure it to use container management.'
        };
      }

      console.log(`Managing containers with supakiln: ${action}`);

      let response;
      let result;

      switch (action) {
        case 'create':
          if (!name) {
            return {
              success: false,
              error: 'Name required',
              message: 'Container name is required for create action.'
            };
          }

          response = await axios.post(`${supakilnUrl}/containers`, {
            name,
            packages
          }, {
            headers: { 
              'Content-Type': 'application/json',
              ...createCloudflareHeaders()
            }
          });

          result = response.data;
          return {
            success: true,
            action: 'create',
            container: {
              id: result.container_id,
              name: result.name,
              packages: result.packages,
              created_at: result.created_at
            },
            message: `Container '${name}' created successfully with ID: ${result.container_id}`
          };

        case 'list':
          response = await axios.get(`${supakilnUrl}/containers`, {
            headers: createCloudflareHeaders()
          });
          result = response.data;
          
          return {
            success: true,
            action: 'list',
            containers: result.map((container: any) => ({
              id: container.container_id,
              name: container.name,
              packages: container.packages,
              created_at: container.created_at
            })),
            count: result.length,
            message: `Found ${result.length} containers`
          };

        case 'get':
          if (!container_id) {
            return {
              success: false,
              error: 'Container ID required',
              message: 'Container ID is required for get action.'
            };
          }

          response = await axios.get(`${supakilnUrl}/containers/${container_id}`, {
            headers: createCloudflareHeaders()
          });
          result = response.data;
          
          return {
            success: true,
            action: 'get',
            container: {
              id: result.container_id,
              name: result.name,
              packages: result.packages,
              created_at: result.created_at,
              code: result.code
            },
            message: `Retrieved details for container: ${result.name}`
          };

        case 'delete':
          if (!container_id) {
            return {
              success: false,
              error: 'Container ID required',
              message: 'Container ID is required for delete action.'
            };
          }

          await axios.delete(`${supakilnUrl}/containers/${container_id}`, {
            headers: createCloudflareHeaders()
          });
          
          return {
            success: true,
            action: 'delete',
            container_id,
            message: `Container ${container_id} deleted successfully`
          };

        case 'cleanup_all':
          await axios.delete(`${supakilnUrl}/containers`, {
            headers: createCloudflareHeaders()
          });
          
          return {
            success: true,
            action: 'cleanup_all',
            message: 'All containers cleaned up successfully'
          };

        default:
          return {
            success: false,
            error: 'Invalid action',
            message: `Unknown action: ${action}. Valid actions are: create, list, get, delete, cleanup_all`
          };
      }

    } catch (error) {
      console.error('Error managing containers with supakiln:', error);
      
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED') {
          return {
            success: false,
            error: 'Connection refused',
            message: 'Could not connect to supakiln service. Please check if the service is running and the URL is correct.'
          };
        }
        
        if (error.response) {
          return {
            success: false,
            error: `HTTP ${error.response.status}: ${error.response.statusText}`,
            message: error.response.data?.detail || error.response.data?.error || 'Unknown server error',
            status_code: error.response.status
          };
        }
        
        if (error.request) {
          return {
            success: false,
            error: 'Network error',
            message: 'Request to supakiln service timed out or failed. Please check your network connection.'
          };
        }
      }
      
      return {
        success: false,
        error: 'Container management failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred during container management'
      };
    }
  }
}; 