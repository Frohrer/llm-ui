# Custom Tools Guide

## Overview

The Custom Tools feature allows you to create, manage, and execute user-defined Python tools that can be used by AI assistants. These tools run in a secure sandboxed Python environment and integrate seamlessly with the agentic workflow system.

## Features

- ✨ **Create Custom Tools**: Define Python-based tools with custom parameters
- 🔄 **Hot Reload**: Tools are automatically reloaded when created, updated, or deleted
- 🔒 **Secure Execution**: All Python code runs in isolated containers via the supakiln API
- 📊 **Usage Tracking**: Track execution count and last execution time for each tool
- 🌐 **Sharing**: Optionally share tools with all users
- 🎯 **AI SDK Integration**: Tools automatically integrate with all AI SDK providers
- 🧪 **Test Console**: Test your tools before deploying them with live parameter testing
- 🤖 **AI-Powered Schema Generation**: Automatically generate parameter schemas from your Python code using LLMs

## How It Works

### Architecture

```
User Creates Tool → Database Storage → Hot Reload → AI SDK Format → LLM Tool Calling
                                           ↓
                                   Python Execution
                                   (via supakiln)
```

1. **Tool Creation**: Users define tools through the UI with:
   - Tool name (snake_case format)
   - Description (for the LLM to understand when to use the tool)
   - Python code
   - Parameter schema (JSON Schema format)

2. **Storage**: Tools are stored in the `custom_tools` database table

3. **Loading**: The tools system dynamically loads custom tools from the database alongside built-in tools

4. **Execution**: When an AI assistant calls a custom tool:
   - Parameters are injected as variables in the Python code
   - Code is executed in a secure sandbox via the `run_python` tool
   - Results are returned to the AI assistant

5. **Hot Reload**: The agentic workflow forces a tool reload on every execution, ensuring custom tools are always up-to-date

## System Model Configuration

The system uses an LLM to generate parameter schemas from your Python code. You can configure which model to use by setting the `SYSTEM_MODEL` environment variable.

### Supported Models

- **OpenAI**: `gpt-4o`, `gpt-4-turbo`, `gpt-4`, `gpt-3.5-turbo`
- **Anthropic**: `claude-sonnet-4-20250514`, `claude-3-5-sonnet-20241022`, `claude-3-opus-20240229`
- **Google**: `gemini-2.0-flash-exp`, `gemini-1.5-pro`, `gemini-1.5-flash`

### Configuration

Add to your `.env` file:
```bash
# Default is gpt-4o
SYSTEM_MODEL=gpt-4o

# Or use Claude
SYSTEM_MODEL=claude-sonnet-4-20250514

# Or use Gemini
SYSTEM_MODEL=gemini-2.0-flash-exp
```

Make sure you have the corresponding API key configured:
- OpenAI: `OPENAI_API_KEY`
- Anthropic: `ANTHROPIC_API_KEY`
- Google: `GEMINI_API_KEY` or `GOOGLE_API_KEY`

## Creating a Custom Tool

The Custom Tools interface provides two tabs:
1. **Configuration**: Define your tool's name, description, code, and parameters
2. **Test Console**: Test your tool with sample parameters before deploying

### Example 1: Simple Calculator

**Tool Name**: `calculate_fibonacci`

**Description**: 
```
Calculates the nth Fibonacci number. Use this when the user asks about Fibonacci sequences or wants to calculate Fibonacci numbers.
```

**Python Code**:
```python
def fibonacci(n):
    if n <= 0:
        print(f"Error: n must be positive, got {n}")
        return
    elif n == 1 or n == 2:
        print(1)
        return
    
    a, b = 1, 1
    for _ in range(n - 2):
        a, b = b, a + b
    
    print(f"The {n}th Fibonacci number is: {b}")

fibonacci(n)
```

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "n": {
      "type": "integer",
      "description": "The position in the Fibonacci sequence (must be positive)"
    }
  },
  "required": ["n"]
}
```

### Example 2: Data Analysis Tool

**Tool Name**: `analyze_data`

**Description**:
```
Analyzes a list of numbers and provides statistical summary including mean, median, min, max, and standard deviation.
```

**Python Code**:
```python
import statistics

if not data or len(data) == 0:
    print("Error: No data provided")
else:
    mean = statistics.mean(data)
    median = statistics.median(data)
    min_val = min(data)
    max_val = max(data)
    
    if len(data) > 1:
        stdev = statistics.stdev(data)
    else:
        stdev = 0
    
    print(f"Statistical Analysis:")
    print(f"  Count: {len(data)}")
    print(f"  Mean: {mean:.2f}")
    print(f"  Median: {median:.2f}")
    print(f"  Min: {min_val}")
    print(f"  Max: {max_val}")
    print(f"  Std Dev: {stdev:.2f}")
```

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "data": {
      "type": "array",
      "items": {
        "type": "number"
      },
      "description": "List of numbers to analyze"
    }
  },
  "required": ["data"]
}
```

### Example 3: String Manipulation Tool

**Tool Name**: `transform_text`

**Description**:
```
Transforms text according to specified operations: uppercase, lowercase, reverse, count_words, or count_chars.
```

**Python Code**:
```python
operations = {
    'uppercase': lambda s: s.upper(),
    'lowercase': lambda s: s.lower(),
    'reverse': lambda s: s[::-1],
    'count_words': lambda s: len(s.split()),
    'count_chars': lambda s: len(s)
}

if operation not in operations:
    print(f"Error: Unknown operation '{operation}'. Available: {', '.join(operations.keys())}")
else:
    result = operations[operation](text)
    print(f"Operation '{operation}' result: {result}")
```

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "description": "The text to transform"
    },
    "operation": {
      "type": "string",
      "enum": ["uppercase", "lowercase", "reverse", "count_words", "count_chars"],
      "description": "The transformation operation to apply"
    }
  },
  "required": ["text", "operation"]
}
```

## Using the Test Console

The test console allows you to test your Python code before saving the tool. It offers two convenient ways to input test parameters: **Form View** and **JSON View**.

### Form View (Recommended)

When you have a parameter schema defined, the test console automatically generates a dynamic form based on your parameters:

1. Switch to the **Test Console** tab
2. The form automatically appears with fields for each parameter
3. Fill in the values using appropriate input types:
   - **Text fields** for strings
   - **Number inputs** for numbers/integers
   - **Switches** for booleans
   - **Text areas** for arrays (with JSON syntax)
4. Required fields are marked with a red asterisk (*)
5. Click **Run Test** to execute

**Form View Benefits:**
- No need to write JSON manually
- Type-appropriate inputs (number spinners, boolean toggles, etc.)
- Automatic validation
- Parameter descriptions shown as hints
- Required fields clearly marked

### JSON View (Advanced)

For complex parameters or manual control:

1. Click the **JSON View** button
2. Enter test parameters as JSON (e.g., `{"n": 10}`)
3. Click **Run Test**

The views automatically sync when you switch between them, so you can:
- Build parameters in Form View, then switch to JSON View to see the result
- Edit JSON directly, then switch to Form View to see it rendered

### How to Test

1. Switch to the **Test Console** tab
2. Use Form View (if schema is defined) or JSON View
3. Enter or fill in test parameters
4. Click **Run Test**
5. View the output, errors, and execution time

### Test Console Features

- **Dynamic Form Generation**: Automatically creates form fields from your parameter schema
- **Two-Way Sync**: Switch between form and JSON views seamlessly
- **Live Execution**: Runs your code in the same sandboxed environment as production
- **Automatic Package Detection**: Automatically detects and installs required Python packages from your imports
- **Parameter Injection**: Parameters are automatically injected as variables
- **Output Capture**: See all print() output and any errors
- **Execution Timing**: Track how long your code takes to run
- **Error Debugging**: Get detailed error messages if something goes wrong
- **Type-Safe Inputs**: Form fields match parameter types (string, number, boolean, array)

### Example Test

For the Fibonacci tool with parameter schema:
```json
{
  "type": "object",
  "properties": {
    "n": {
      "type": "integer",
      "description": "The position in the Fibonacci sequence"
    }
  },
  "required": ["n"]
}
```

**Form View** will automatically show:
- Label: "n *" (with red asterisk for required)
- Input type: Number field
- Placeholder: "The position in the Fibonacci sequence"

Simply enter `10` in the number field and click **Run Test**.

**JSON View** equivalent:
```json
{
  "n": 10
}
```

Expected output:
```
The 10th Fibonacci number is: 55
```

### Supported Parameter Types

The form builder supports these JSON Schema types:

| Schema Type | Form Input | Example |
|-------------|------------|---------|
| `string` | Text input | `"hello"` |
| `number` | Number input | `42` or `3.14` |
| `integer` | Number input | `42` |
| `boolean` | Switch toggle | `true` or `false` |
| `array` | JSON text area | `["a", "b"]` or `[1, 2, 3]` |
| `object` | Use JSON View | `{"key": "value"}` |

**Note**: For `array` types in Form View, enter JSON syntax (e.g., `["item1", "item2"]`). For complex `object` types, use JSON View.

### Automatic Package Detection

The system automatically detects and installs Python packages based on your import statements. You don't need to manually specify packages!

**Supported packages include:**
- Data Science: `numpy`, `pandas`, `scipy`, `matplotlib`, `seaborn`, `plotly`
- Machine Learning: `scikit-learn`, `tensorflow`, `torch`, `transformers`
- Web: `requests`, `httpx`, `aiohttp`, `beautifulsoup4`, `flask`, `fastapi`
- File Processing: `openpyxl`, `Pillow`, `lxml`, `PyYAML`
- SSH/Networking: `paramiko`, `fabric`, `invoke`
- And many more!

**Example:**
```python
import pandas as pd
import numpy as np
import requests

# The system automatically detects and installs: pandas, numpy, requests
data = pd.DataFrame({'x': [1, 2, 3], 'y': [4, 5, 6]})
print(data.describe())
```

The packages are automatically installed both during testing and when the AI calls your tool in production.

**For uncommon packages:**
If your package isn't auto-detected, you can manually specify it by including it in your import statement. The system will attempt to install any imported module that's not part of Python's standard library.

## AI-Powered Schema Generation

Instead of manually writing parameter schemas, you can use the **Generate Schema** button to automatically create one from your Python code.

### How It Works

1. Write your Python code
2. (Optional) Add a description to help the AI understand context
3. Click **Generate Schema** button (⚡ Sparkles icon)
4. The system analyzes your code and generates a JSON schema
5. Review and edit the generated schema if needed

### What It Detects

- Variable usage in your code
- Parameter types (string, number, boolean, array, object)
- Required vs optional parameters
- Appropriate descriptions for each parameter

### Example

Given this Python code:
```python
result = x + y
print(f"Sum of {x} and {y} is {result}")
```

The AI will generate:
```json
{
  "type": "object",
  "properties": {
    "x": {
      "type": "number",
      "description": "First number to add"
    },
    "y": {
      "type": "number",
      "description": "Second number to add"
    }
  },
  "required": ["x", "y"]
}
```

### Tips for Better Schema Generation

1. **Use descriptive variable names**: `user_age` is better than `a`
2. **Add a tool description**: Helps the AI understand context
3. **Include example usage in comments**: Shows expected parameter formats
4. **Review the generated schema**: AI is smart but not perfect—verify the types and requirements

## Best Practices

### 1. Clear Descriptions
Write descriptions that help the LLM understand:
- **What** the tool does
- **When** to use it
- **What kind of problems** it solves

### 2. Use Print Statements
Always use `print()` statements for output. Return values are NOT captured:
```python
# ✅ Good
result = calculation()
print(f"Result: {result}")

# ❌ Bad (won't see the output)
return calculation()
```

### 3. Handle Edge Cases
Add error handling for invalid inputs:
```python
if n <= 0:
    print(f"Error: n must be positive, got {n}")
    return

# Normal processing...
```

### 4. Parameter Naming
- Use descriptive parameter names
- Match parameter names in your code with the schema
- Parameters are automatically injected as variables

### 5. Tool Naming Convention
- Use lowercase with underscores: `my_custom_tool`
- Be descriptive: `calculate_fibonacci` not just `calc`
- Avoid conflicts with built-in tools

## API Endpoints

### GET `/api/custom-tools`
Get all custom tools for the current user (including shared tools)

### GET `/api/custom-tools/:id`
Get a specific custom tool

### POST `/api/custom-tools`
Create a new custom tool

**Request Body**:
```json
{
  "name": "tool_name",
  "description": "Tool description",
  "python_code": "print('Hello')",
  "parameters_schema": {
    "type": "object",
    "properties": {},
    "required": []
  },
  "is_enabled": true,
  "is_shared": false
}
```

### PUT `/api/custom-tools/:id`
Update an existing custom tool

### DELETE `/api/custom-tools/:id`
Delete a custom tool

### PATCH `/api/custom-tools/:id/toggle`
Toggle tool enabled/disabled status

### POST `/api/custom-tools/test`
Test a tool's Python code with parameters

**Request Body**:
```json
{
  "python_code": "print('Hello')",
  "parameters": {
    "param1": "value1"
  }
}
```

**Response**:
```json
{
  "success": true,
  "output": "Hello",
  "error": null,
  "execution_time": 0.123
}
```

### POST `/api/custom-tools/generate-schema`
Generate parameter schema from Python code using AI

**Request Body**:
```json
{
  "python_code": "result = x + y\nprint(result)",
  "description": "Adds two numbers"
}
```

**Response**:
```json
{
  "schema": {
    "type": "object",
    "properties": {
      "x": { "type": "number", "description": "..." },
      "y": { "type": "number", "description": "..." }
    },
    "required": ["x", "y"]
  }
}
```

## Database Schema

```sql
CREATE TABLE custom_tools (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  python_code TEXT NOT NULL,
  parameters_schema JSONB NOT NULL,
  is_enabled BOOLEAN DEFAULT true,
  is_shared BOOLEAN DEFAULT false,
  execution_count INTEGER DEFAULT 0,
  last_executed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## Technical Details

### Hot Reload Implementation

The system implements hot reload in the agentic workflow:

```typescript
// Force reload tools from database on every agentic loop
const tools = await getAISDKTools(true);
```

This ensures that:
1. New tools are immediately available
2. Updated tools reflect latest changes
3. Deleted tools are removed from the system

### Parameter Injection

Parameters are automatically injected into the Python environment:

```python
# If tool receives parameters: { "n": 10, "text": "hello" }
# The following variables are automatically available:
n = 10
text = "hello"
```

### Execution Flow

1. LLM calls tool with parameters
2. Tool wrapper receives parameters
3. Parameters are serialized to Python variable assignments
4. User's Python code is appended
5. Combined code is sent to supakiln for execution
6. Results are captured and returned to LLM
7. Execution statistics are updated in database

## Security Considerations

- All Python code runs in isolated containers via supakiln
- No direct access to the host system
- Execution timeouts prevent infinite loops
- User-specific tools prevent unauthorized access
- Shared tools are opt-in only

## Troubleshooting

### Tool Not Appearing in LLM
- Check that `is_enabled` is true
- Verify the tool name follows naming conventions
- Check for any database errors in server logs

### Python Code Not Working
- **Use the Test Console first!** Test your code before saving
- Ensure you're using `print()` for output
- Check parameter names match the schema
- Review test output for execution errors
- Check server logs for detailed error traces

### Parameters Not Available
- Verify parameter names in schema match variable names in code
- Test with the Test Console using sample parameters
- Check that parameters are in the `required` array if mandatory
- Ensure parameter types match the schema definition

### Schema Generation Not Working
- Verify `SYSTEM_MODEL` environment variable is set
- Ensure the corresponding API key is configured
- Check that your Python code is not empty
- Review server logs for LLM API errors
- Try adding a description to provide more context

### Test Console Errors
- Verify test parameters are valid JSON
- Ensure Python code doesn't have syntax errors
- Check that SUPAKILN_API_URL is configured
- Verify the supakiln service is running
- Review execution timeout settings (default: 30s)

## Future Enhancements

Potential improvements for the custom tools system:

- [ ] Tool templates library
- [ ] Code editor with syntax highlighting
- [ ] Tool testing/debugging interface
- [ ] Import/export tool definitions
- [ ] Tool versioning
- [ ] Package management per tool
- [ ] Tool categories/tags
- [ ] Usage analytics dashboard
- [ ] Rate limiting per tool
- [ ] Cost tracking for tool execution

## Support

For issues or questions:
1. Check the server logs: `docker-compose logs app`
2. Verify database connectivity
3. Test the run_python tool independently
4. Ensure SUPAKILN_API_URL is configured correctly

