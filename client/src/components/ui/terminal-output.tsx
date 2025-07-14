interface TerminalOutputProps {
  output?: string;
  error?: string;
  isExecuting?: boolean;
  executionTime?: number;
  className?: string;
}

export function TerminalOutput({
  output,
  error,
  isExecuting,
  executionTime,
  className,
}: TerminalOutputProps) {
  if (!output && !error && !isExecuting) {
    return null;
  }

  return (
    <div className={`mt-3 rounded-md border bg-black/90 text-green-400 font-mono text-sm ${className || ''}`}>
      {/* Terminal Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 bg-gray-800">
        <div className="flex items-center gap-2">
          {isExecuting ? (
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 bg-yellow-400 rounded-full animate-pulse"></div>
              <span className="text-yellow-400">Executing...</span>
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
        {executionTime && (
          <div className="ml-auto flex items-center gap-1 text-gray-400">
            <span>⏱</span>
            <span>{executionTime}s</span>
          </div>
        )}
      </div>

      {/* Terminal Content */}
      <div className="p-3 max-h-96 overflow-y-auto">
        {isExecuting ? (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-yellow-400">Running Python code...</span>
          </div>
        ) : (
          <div>
            {output && (
              <div className="space-y-1">
                <div className="text-gray-400">$ python</div>
                <pre className="whitespace-pre-wrap text-green-400">
                  {output}
                </pre>
              </div>
            )}
            {error && (
              <div className="space-y-1">
                <div className="text-gray-400">$ python</div>
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