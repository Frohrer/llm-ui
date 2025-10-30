#!/usr/bin/env node

/**
 * Agentic Mode Test Script
 * 
 * This script:
 * 1. Builds and starts Docker containers
 * 2. Waits for the service to be ready
 * 3. Tests agentic mode with each provider
 * 4. Verifies that tools are being called correctly
 */

import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

// Configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const TEST_TIMEOUT = 120000; // 2 minutes per test
const STARTUP_WAIT = parseInt(process.env.STARTUP_WAIT || '10000'); // 10 seconds when in Docker (service healthcheck handles readiness)

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

// Helper to print colored output
function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title) {
  log('\n' + '='.repeat(80), colors.bright);
  log(title, colors.bright + colors.cyan);
  log('='.repeat(80), colors.bright);
}

function logSuccess(message) {
  log(`✅ ${message}`, colors.green);
}

function logError(message) {
  log(`❌ ${message}`, colors.red);
}

function logWarning(message) {
  log(`⚠️  ${message}`, colors.yellow);
}

function logInfo(message) {
  log(`ℹ️  ${message}`, colors.blue);
}

// Run a shell command
function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    logInfo(`Running: ${command} ${args.join(' ')}`);
    
    const proc = spawn(command, args, {
      stdio: options.silent ? 'pipe' : 'inherit',
      shell: true,
      ...options
    });

    let stdout = '';
    let stderr = '';

    if (options.silent) {
      proc.stdout?.on('data', (data) => stdout += data.toString());
      proc.stderr?.on('data', (data) => stderr += data.toString());
    }

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

// Check if service is ready
async function waitForService(maxAttempts = 30) {
  logInfo('Waiting for service to be ready...');
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok) {
        logSuccess('Service is ready!');
        return true;
      }
    } catch (error) {
      // Service not ready yet
      process.stdout.write('.');
      await setTimeout(1000);
    }
  }
  
  console.log('');
  throw new Error('Service did not become ready in time');
}

// Test a provider with agentic mode
async function testProvider(providerName, modelName, endpoint) {
  logSection(`Testing ${providerName} (${modelName}) - Agentic Mode`);
  
  const startTime = Date.now();
  let conversationId = null;
  let receivedChunks = [];
  let toolCallsDetected = false;
  let finalResponse = '';

  try {
    logInfo(`Making request to ${endpoint}...`);
    
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'You MUST use the browse_website tool to fetch https://example.com and then describe the actual HTML content you retrieve. Do not use any prior knowledge - only describe what the tool returns.',
        model: modelName,
        useTools: true,
        useAgenticMode: true,
      }),
      signal: AbortSignal.timeout(TEST_TIMEOUT),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            
            if (data.type === 'start') {
              conversationId = data.conversationId;
              logInfo(`Conversation started: ${conversationId}`);
            } else if (data.type === 'chunk') {
              receivedChunks.push(data.content);
              finalResponse += data.content;
              process.stdout.write('.');
            } else if (data.type === 'tool_call') {
              toolCallsDetected = true;
              logInfo(`\nTool called: ${data.toolName}`);
            } else if (data.type === 'done') {
              console.log('');
              logSuccess('Stream completed');
            }
          } catch (e) {
            // Ignore parse errors for non-JSON lines
          }
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // Validate results
    console.log('\n');
    logSection('Test Results');
    logInfo(`Duration: ${duration}s`);
    logInfo(`Chunks received: ${receivedChunks.length}`);
    logInfo(`Response length: ${finalResponse.length} chars`);
    
    if (finalResponse.length === 0) {
      logError('No response received from model');
      return false;
    }

    logSuccess('Received response from model');
    
    // In agentic mode, tool calls happen internally and aren't streamed as events
    // Check multiple indicators that the tool was actually used:
    const lowerResponse = finalResponse.toLowerCase();
    
    const hasHTMLContent = finalResponse.includes('<!doctype') || 
                          finalResponse.includes('<html') ||
                          finalResponse.includes('<title>Example Domain</title>');
    
    const mentionsFetched = lowerResponse.includes('fetched') || 
                           lowerResponse.includes('browsed') ||
                           lowerResponse.includes('visited') ||
                           lowerResponse.includes('retrieved');
    
    const hasSpecificContent = finalResponse.includes('iana.org') ||
                               finalResponse.includes('documentation examples') ||
                               lowerResponse.includes('example domain');
    
    const mentionsExample = lowerResponse.includes('example');
    
    if (toolCallsDetected) {
      // Tool call events were sent (old streaming mode)
      logSuccess('Tool call events detected in stream');
    } else if (hasHTMLContent) {
      // Agentic mode: Response contains actual HTML content
      logSuccess('Response contains actual HTML content from browse_website tool!');
      logSuccess('Agentic mode successfully executed tools internally');
    } else if (mentionsFetched && hasSpecificContent) {
      // Agentic mode: Response indicates tool was used and has specific content
      logSuccess('Response indicates tool was used (mentions fetching/browsing)');
      logSuccess('Response contains specific content from the actual page');
      logSuccess('Agentic mode successfully executed tools internally');
    } else {
      // No clear indicators - likely answered from training data
      logError('No tool execution detected - agentic mode did NOT work!');
      logWarning('Response does not contain HTML or clear indicators of tool usage');
      logWarning('The model may have answered from training data instead');
      return false;
    }
    
    if (mentionsExample) {
      logSuccess('Response mentions example.com content');
    } else {
      logWarning('Response does not mention example.com');
    }

    // Show preview of response
    log('\n--- Response Preview (first 500 chars) ---', colors.cyan);
    log(finalResponse.substring(0, 500) + (finalResponse.length > 500 ? '...' : ''));
    log('--- End Preview ---\n', colors.cyan);

    return true;

  } catch (error) {
    logError(`Test failed: ${error.message}`);
    if (error.stack) {
      log(error.stack, colors.red);
    }
    return false;
  }
}

// Main test flow
async function main() {
  const results = {
    build: false,
    startup: false,
    tests: {}
  };

  try {
    logSection('AI SDK Agentic Mode - Integration Test');
    
    // Check if running in Docker (BASE_URL contains 'app' instead of 'localhost')
    const isDockerized = BASE_URL.includes('app:');
    
    if (!isDockerized) {
      // Step 1: Build Docker containers (only when running on host)
      logSection('Step 1: Building Docker Containers');
      try {
        await runCommand('docker-compose', ['build']);
        results.build = true;
        logSuccess('Docker build completed');
      } catch (error) {
        logError('Docker build failed');
        throw error;
      }

      // Step 2: Start containers (only when running on host)
      logSection('Step 2: Starting Docker Containers');
      try {
        // Start containers in detached mode
        await runCommand('docker-compose', ['up', '-d']);
        logSuccess('Containers started');
        
        // Wait for startup
        logInfo(`Waiting ${STARTUP_WAIT / 1000}s for service initialization...`);
        await setTimeout(STARTUP_WAIT);
        
        // Wait for service to be ready
        await waitForService();
        results.startup = true;
      } catch (error) {
        logError('Service startup failed');
        throw error;
      }
    } else {
      // Running in Docker - service should already be up via depends_on
      logSection('Running in Docker - Waiting for Service');
      results.build = true;
      
      logInfo('Service should be ready (depends_on health check)');
      logInfo(`Waiting ${STARTUP_WAIT / 1000}s for additional initialization...`);
      await setTimeout(STARTUP_WAIT);
      
      // Verify service is ready
      try {
        await waitForService();
        results.startup = true;
      } catch (error) {
        logError('Service not ready');
        throw error;
      }
    }

    // Step 3: Test providers
    logSection('Step 3: Testing Providers with Agentic Mode');
    
    const providers = [
      {
        name: 'OpenAI',
        model: 'gpt-4',
        endpoint: '/api/chat/openai',
        envVar: 'OPENAI_API_KEY'
      },
      {
        name: 'Anthropic',
        model: 'claude-sonnet-4-0',
        endpoint: '/api/chat/anthropic',
        envVar: 'ANTHROPIC_API_KEY'
      },
      {
        name: 'Google Gemini',
        model: 'gemini-pro',
        endpoint: '/api/chat/gemini',
        envVar: 'GEMINI_API_KEY',
        skip: true // Skip if not implemented
      },
    ];

    for (const provider of providers) {
      if (provider.skip) {
        logWarning(`Skipping ${provider.name} (not implemented or configured)`);
        results.tests[provider.name] = 'skipped';
        continue;
      }

      logInfo(`Testing ${provider.name}...`);
      logWarning(`Note: Ensure ${provider.envVar} is set in docker-compose.yml`);
      
      try {
        const success = await testProvider(provider.name, provider.model, provider.endpoint);
        results.tests[provider.name] = success ? 'passed' : 'failed';
        
        if (success) {
          logSuccess(`${provider.name} test passed!`);
        } else {
          logError(`${provider.name} test failed!`);
        }
      } catch (error) {
        logError(`${provider.name} test error: ${error.message}`);
        results.tests[provider.name] = 'error';
      }

      // Wait between tests to avoid rate limits
      if (provider !== providers[providers.length - 1]) {
        logInfo('Waiting 5s before next test...');
        await setTimeout(5000);
      }
    }

    // Final summary
    logSection('Test Summary');
    log(`Build: ${results.build ? '✅ Passed' : '❌ Failed'}`, 
        results.build ? colors.green : colors.red);
    log(`Startup: ${results.startup ? '✅ Passed' : '❌ Failed'}`, 
        results.startup ? colors.green : colors.red);
    
    log('\nProvider Tests:', colors.bright);
    for (const [provider, result] of Object.entries(results.tests)) {
      const symbol = result === 'passed' ? '✅' : result === 'skipped' ? '⏭️' : '❌';
      const color = result === 'passed' ? colors.green : 
                    result === 'skipped' ? colors.yellow : colors.red;
      log(`  ${symbol} ${provider}: ${result}`, color);
    }

    const allPassed = Object.values(results.tests)
      .filter(r => r !== 'skipped')
      .every(r => r === 'passed');

    if (allPassed && Object.keys(results.tests).length > 0) {
      log('\n🎉 All tests passed!', colors.green + colors.bright);
      process.exit(0);
    } else {
      log('\n❌ Some tests failed', colors.red + colors.bright);
      process.exit(1);
    }

  } catch (error) {
    logError(`Test suite failed: ${error.message}`);
    if (error.stack) {
      log(error.stack, colors.red);
    }
    
    // Show logs on error (only if not running in Docker)
    const isDockerized = BASE_URL.includes('app:');
    if (!isDockerized) {
      logSection('Docker Logs (last 50 lines)');
      try {
        await runCommand('docker-compose', ['logs', '--tail=50']);
      } catch (e) {
        logError('Could not retrieve logs');
      }
    }
    
    process.exit(1);
  }
}

// Handle cleanup on exit
process.on('SIGINT', async () => {
  log('\n\nReceived SIGINT, cleaning up...', colors.yellow);
  const isDockerized = BASE_URL.includes('app:');
  if (!isDockerized) {
    logInfo('Containers are still running. Use "docker-compose down" to stop them.');
  }
  process.exit(130);
});

// Run the tests
main().catch((error) => {
  logError(`Unhandled error: ${error.message}`);
  process.exit(1);
});

