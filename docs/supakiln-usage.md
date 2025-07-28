# Supakiln Python Code Execution Usage Guide

This guide explains how to use the supakiln integration for executing Python code within your LLM conversations.

## Prerequisites

1. A running supakiln instance
2. Set the `SUPAKILN_API_URL` environment variable to point to your supakiln instance
3. If your supakiln instance is protected by Cloudflare Access, configure service-to-service authentication:
   - Set `CF_ACCESS_CLIENT_ID` to your Cloudflare Access service token client ID
   - Set `CF_ACCESS_CLIENT_SECRET` to your Cloudflare Access service token client secret

## Available Tools

### 1. run_python

Execute Python code in a sandboxed environment with automatic package installation.

**Parameters:**
- `code` (required): The Python code to execute
- `packages` (optional): List of packages to install (e.g., `["pandas", "numpy"]`)
- `container_id` (optional): Use an existing container instead of creating a new one
- `timeout` (optional): Execution timeout in seconds (default: 30, max: 300)

**Example usage in conversation:**
```
User: "Can you analyze this CSV data and create a plot?"

AI: I'll help you analyze CSV data and create a visualization. Let me run some Python code to demonstrate:

[The AI would use run_python to execute code like:]
```python
import pandas as pd
import matplotlib.pyplot as plt
import numpy as np

# Create sample data
data = {
    'date': pd.date_range('2024-01-01', periods=30),
    'sales': np.random.randint(100, 1000, 30),
    'profit': np.random.randint(20, 200, 30)
}
df = pd.DataFrame(data)

# Basic analysis
print("Data shape:", df.shape)
print("\nSummary statistics:")
print(df.describe())

# Create a plot
plt.figure(figsize=(10, 6))
plt.plot(df['date'], df['sales'], label='Sales', marker='o')
plt.plot(df['date'], df['profit'], label='Profit', marker='s')
plt.title('Sales and Profit Over Time')
plt.xlabel('Date')
plt.ylabel('Amount')
plt.legend()
plt.xticks(rotation=45)
plt.tight_layout()
plt.show()
```

### 2. manage_containers

Manage persistent containers for complex workflows that require maintaining state across multiple executions.

**Actions:**
- `create`: Create a new container with specified packages
- `list`: List all existing containers
- `get`: Get detailed information about a specific container
- `delete`: Delete a specific container
- `cleanup_all`: Delete all containers

**Parameters:**
- `action` (required): The action to perform
- `name` (required for create): Container name
- `packages` (required for create): List of packages to pre-install
- `container_id` (required for get/delete): Container ID

**Example workflow:**

1. **Create a data science container:**
```
AI uses: manage_containers with action="create", name="data-science", packages=["pandas", "numpy", "matplotlib", "scikit-learn", "seaborn"]
```

2. **List available containers:**
```
AI uses: manage_containers with action="list"
```

3. **Use the container for multiple executions:**
```
AI uses: run_python with container_id="<container-id-from-step-1>" and different code blocks
```

4. **Clean up when done:**
```
AI uses: manage_containers with action="delete", container_id="<container-id>"
```

## Advanced Usage Patterns

### Pattern 1: Data Analysis Workflow

1. Create a container with data science packages
2. Load and explore data using the container
3. Perform analysis in multiple steps using the same container
4. Generate visualizations and reports
5. Clean up the container when done

### Pattern 2: Machine Learning Pipeline

1. Create a container with ML packages
2. Load and preprocess data
3. Train models (maintaining state between steps)
4. Evaluate and compare different models
5. Generate final predictions

### Pattern 3: Web Scraping and Analysis

1. Create a container with web scraping packages
2. Scrape data from websites
3. Clean and process the scraped data
4. Perform analysis and create visualizations
5. Export results

## Best Practices

1. **Container Management:**
   - Create containers with all necessary packages upfront
   - Use descriptive names for containers
   - Clean up containers when workflows are complete

2. **Code Execution:**
   - Use meaningful variable names and comments
   - Handle errors gracefully in your code
   - Print intermediate results for debugging

3. **Performance:**
   - Use containers for multi-step workflows to avoid repeated package installation
   - Set appropriate timeouts for long-running operations
   - Consider memory usage for large datasets

4. **Security:**
   - Never include sensitive credentials in code
   - Be cautious with file system operations
   - Use environment variables for configuration

## Error Handling

The tools provide detailed error information:
- Connection errors (supakiln service unavailable)
- HTTP errors (API issues)
- Execution errors (Python code errors)
- Timeout errors (execution took too long)

Check the tool response for `success: false` and examine the `error` and `message` fields for troubleshooting.

## Limitations

1. Maximum execution timeout: 300 seconds (5 minutes)
2. Code executes in isolated containers (no access to local files)
3. Network access depends on supakiln configuration
4. Memory and CPU limits depend on supakiln instance configuration

## Configuration

Set the following environment variables:
```bash
# Required
SUPAKILN_API_URL=https://your-supakiln-instance.com

# Optional - Only needed if supakiln is protected by Cloudflare Access
CF_ACCESS_CLIENT_ID=your_service_token_client_id
CF_ACCESS_CLIENT_SECRET=your_service_token_client_secret
```

### Cloudflare Access Service Tokens

If your supakiln instance is protected by Cloudflare Access, you need to create a service token:

1. Go to your Cloudflare Zero Trust dashboard
2. Navigate to Access > Service Auth > Service Tokens
3. Create a new service token with access to your supakiln application
4. Use the Client ID and Client Secret as the environment variables above

The tools will automatically detect if supakiln is configured and provide appropriate error messages if not available. If Cloudflare credentials are not provided but needed, you'll see authentication errors in the tool responses. 