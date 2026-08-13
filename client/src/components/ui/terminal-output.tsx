interface TerminalOutputProps {
  output?: string;
  error?: string;
  isExecuting?: boolean;
  executionTime?: number;
  language?: string;
  webServiceUrl?: string;
  timedOut?: boolean;
  className?: string;
}

const PROMPT_BY_LANGUAGE: Record<string, string> = {
  python: '$ python',
  node: '$ node',
  ruby: '$ ruby',
  bash: '$ bash',
  go: '$ go run',
};

export function TerminalOutput({
  output,
  error,
  isExecuting,
  executionTime,
  language,
  webServiceUrl,
  timedOut,
  className,
}: TerminalOutputProps) {
  const shouldShow = isExecuting || error || output !== undefined || executionTime || webServiceUrl;
  if (!shouldShow) {
    return null;
  }

  const prompt = PROMPT_BY_LANGUAGE[language || 'python'] ?? `$ ${language || 'run'}`;
  const runningLabel = `Running ${language || 'code'}...`;

  return (
    <div className={`mt-3 rounded-md border bg-black/90 text-green-400 font-mono text-sm ${className || ''}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 bg-gray-800">
        <div className="flex items-center gap-2">
          {isExecuting ? (
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 bg-yellow-400 rounded-full animate-pulse"></div>
              <span className="text-yellow-400">Executing...</span>
            </div>
          ) : timedOut ? (
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 bg-orange-400 rounded-full"></div>
              <span className="text-orange-400">Timed out</span>
            </div>
          ) : error ? (
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 bg-red-400 rounded-full"></div>
              <span className="text-red-400">Error</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 bg-green-400 rounded-full"></div>
              <span className="text-green-400">Success</span>
            </div>
          )}
        </div>
        {language && !isExecuting && (
          <span className="text-gray-400 text-xs uppercase tracking-wide">{language}</span>
        )}
        {executionTime !== undefined && executionTime !== null && (
          <div className="ml-auto flex items-center gap-1 text-gray-400">
            <span>⏱</span>
            <span>{executionTime}s</span>
          </div>
        )}
      </div>

      <div className="p-3 max-h-96 overflow-y-auto">
        {isExecuting ? (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-yellow-400">{runningLabel}</span>
          </div>
        ) : (
          <div className="space-y-2">
            {webServiceUrl && (
              <div className="space-y-1">
                <div className="text-gray-400">$ web-service</div>
                <a
                  href={webServiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 underline break-all"
                >
                  {webServiceUrl}
                </a>
              </div>
            )}
            {(output !== undefined && output !== null) && (
              <div className="space-y-1">
                <div className="text-gray-400">{prompt}</div>
                <pre className="whitespace-pre-wrap text-green-400">
                  {output || '(no output)'}
                </pre>
              </div>
            )}
            {error && (
              <div className="space-y-1">
                <div className="text-gray-400">{prompt}</div>
                <pre className="whitespace-pre-wrap text-red-400">
                  {error}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
