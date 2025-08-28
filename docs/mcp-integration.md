# MCP (Model Context Protocol) Integration

This document describes the MCP integration in the LLM UI project, allowing you to connect to external MCP servers and use their tools in your conversations.

## Overview

MCP (Model Context Protocol) is an open standard developed by Anthropic that enables seamless integration between AI systems and external tools, systems, and data sources. Our implementation allows you to:

- Connect to multiple MCP servers simultaneously
- Discover and use tools from connected servers
- Manage server configurations through a user-friendly interface
- Auto-approve trusted tools for seamless operation

## Features

### 🔧 **Server Management**
- Connect to multiple MCP servers with different transports (stdio, SSE, streamableHttp)
- Enable/disable servers individually
- Automatic reconnection on connection failures
- Real-time status monitoring

### 🛠️ **Tool Integration**
- Automatic discovery of tools from connected servers
- Seamless integration with existing tool system
- Support for complex parameter schemas
- Tool execution with proper error handling

### 📊 **Monitoring & Statistics**
- Real-time connection status
- Tool usage statistics
- Server health monitoring
- Error tracking and reporting

### ⚙️ **Configuration Management**
- JSON-based configuration
- Import/export configurations
- Environment variable support
- Global and per-server settings

## Quick Start

1. **Enable MCP servers**: Open the sidebar and click on "MCP Settings"
2. **Configure a server**: Toggle on one of the pre-configured servers (e.g., filesystem)
3. **Use MCP tools**: MCP tools will automatically appear in your tool list with the prefix `mcp_`

## Configuration

### Server Configuration

Each MCP server is configured with the following options:

```json
{
  "serverName": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "./"],
    "description": "Human-readable description",
    "transport": "stdio",
    "autoApprove": ["tool1", "tool2"],
    "disabled": false,
    "env": {
      "API_KEY": "your-api-key"
    },
    "workingDir": "/path/to/working/directory",
    "timeout": 30000,
    "retryAttempts": 3
  }
}
```

### Configuration Options

- **command**: Command to execute the MCP server
- **args**: Command line arguments
- **description**: Human-readable description
- **transport**: Communication protocol (stdio, sse, streamableHttp)
- **autoApprove**: List of tool names to auto-approve
- **disabled**: Whether the server is disabled
- **env**: Environment variables for the server process
- **workingDir**: Working directory for the server process
- **timeout**: Connection timeout in milliseconds
- **retryAttempts**: Number of retry attempts

### Global Settings

```json
{
  "globalSettings": {
    "timeout": 30000,
    "retryAttempts": 3,
    "autoApproveAll": false,
    "enableLogging": true
  }
}
```

## Popular MCP Servers

### Filesystem Server
```bash
npx -y @modelcontextprotocol/server-filesystem ./
```
- **Tools**: read_file, write_file, list_directory, create_directory
- **Use case**: File operations, reading documents, managing project files

### Memory Server
```bash
npx -y @modelcontextprotocol/server-memory
```
- **Tools**: store_memory, recall_memory, list_memories
- **Use case**: Persistent note-taking, knowledge storage

### Brave Search Server
```bash
npx -y @modelcontextprotocol/server-brave-search
```
- **Tools**: brave_search
- **Use case**: Web search capabilities
- **Requires**: BRAVE_API_KEY environment variable

### SQLite Server
```bash
npx -y @modelcontextprotocol/server-sqlite ./database.db
```
- **Tools**: execute_query, list_tables, describe_table
- **Use case**: Database operations, data analysis

## Tool Naming Convention

MCP tools are automatically prefixed in the system to avoid naming conflicts:

- Original tool: `read_file`
- System name: `mcp_filesystem_read_file`
- Format: `mcp_{serverName}_{toolName}`

## API Endpoints

The MCP integration provides several API endpoints:

### Configuration
- `GET /api/mcp/config` - Get current configuration
- `PUT /api/mcp/config` - Update configuration
- `GET /api/mcp/config/export` - Export configuration
- `POST /api/mcp/config/import` - Import configuration

### Server Management
- `GET /api/mcp/servers/status` - Get server statuses
- `POST /api/mcp/servers` - Add new server
- `PUT /api/mcp/servers/:name` - Update server
- `DELETE /api/mcp/servers/:name` - Remove server
- `PATCH /api/mcp/servers/:name/toggle` - Enable/disable server

### Tools & Resources
- `GET /api/mcp/tools` - List all MCP tools
- `GET /api/mcp/resources` - List all MCP resources
- `GET /api/mcp/prompts` - List all MCP prompts
- `POST /api/mcp/tools/:serverName/:toolName/call` - Call a tool

### System
- `GET /api/mcp/statistics` - Get MCP statistics
- `POST /api/mcp/refresh` - Refresh all connections

## Troubleshooting

### Server Connection Issues

1. **Check server status** in the MCP Settings dialog
2. **Verify command** and arguments are correct
3. **Check environment variables** if required
4. **Review server logs** in the browser console
5. **Try manual connection** using the refresh button

### Tool Not Available

1. **Verify server is connected** and enabled
2. **Check tool permissions** in autoApprove settings
3. **Refresh tools cache** using the refresh button
4. **Check server capabilities** in the Tools & Resources tab

### Performance Issues

1. **Adjust timeout settings** for slow servers
2. **Limit autoApprove tools** to reduce overhead
3. **Disable unused servers** to improve performance
4. **Monitor connection counts** in statistics

## Security Considerations

### Tool Approval
- Use `autoApprove` carefully for trusted tools only
- Avoid `autoApproveAll` in production environments
- Review tool capabilities before enabling servers

### Environment Variables
- Store sensitive API keys in environment variables
- Don't commit API keys to version control
- Use proper access controls for server processes

### Network Security
- MCP servers run as separate processes
- Ensure proper firewall rules for remote servers
- Use secure communication protocols when available

## Development

### Adding Custom MCP Servers

1. **Create your MCP server** following the MCP specification
2. **Add configuration** to `mcp-config.json`
3. **Test locally** before deployment
4. **Document tools and usage** for your team

### Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   LLM Client    │────│   MCP Client     │────│   MCP Server    │
│                 │    │   Manager        │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         │              ┌──────────────────┐              │
         └──────────────│   Tools Bridge   │──────────────┘
                        │                  │
                        └──────────────────┘
```

## Contributing

To contribute to the MCP integration:

1. **Follow the existing patterns** for client and server management
2. **Add tests** for new functionality
3. **Update documentation** for new features
4. **Consider backward compatibility** with existing configurations

## References

- [Official MCP Documentation](https://docs.mcp-agent.com/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [Available MCP Servers](https://github.com/modelcontextprotocol)
