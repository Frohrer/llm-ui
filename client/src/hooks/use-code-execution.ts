import { useState } from 'react';
import { useToast } from './use-toast';

const SUPPORTED_LANGUAGES = ['python', 'node', 'ruby', 'bash', 'go'] as const;
export type ExecutableLanguage = typeof SUPPORTED_LANGUAGES[number];

// Map common code-block language tags (from markdown) to supakiln runtime names.
const LANGUAGE_ALIASES: Record<string, ExecutableLanguage> = {
  python: 'python',
  py: 'python',
  python3: 'python',
  node: 'node',
  nodejs: 'node',
  javascript: 'node',
  js: 'node',
  typescript: 'node', // best-effort; ts won't run as-is but keeps the button visible
  ts: 'node',
  ruby: 'ruby',
  rb: 'ruby',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  go: 'go',
  golang: 'go',
};

export function normalizeLanguage(raw: string | undefined | null): ExecutableLanguage | null {
  if (!raw) return null;
  return LANGUAGE_ALIASES[raw.toLowerCase()] ?? null;
}

interface CodeExecutionParams {
  code: string;
  language?: ExecutableLanguage;
  packages?: string[];
  timeout?: number;
}

interface WebService {
  type?: string;
  external_port?: number;
  proxy_url?: string;
}

interface CodeExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  execution_time?: number;
  container_id?: string;
  status?: string;
  timed_out?: boolean;
  timings_ms?: Record<string, number> | null;
  web_service?: WebService | null;
  language?: ExecutableLanguage;
}

interface CodeExecutionState {
  isExecuting: boolean;
  result: CodeExecutionResult | null;
  error: string | null;
}

export function useCodeExecution() {
  const [state, setState] = useState<CodeExecutionState>({
    isExecuting: false,
    result: null,
    error: null,
  });

  const { toast } = useToast();

  const executeCode = async (
    codeOrParams: string | CodeExecutionParams,
    languageArg?: ExecutableLanguage,
  ) => {
    setState(prev => ({ ...prev, isExecuting: true, result: null, error: null }));

    try {
      const params: CodeExecutionParams = typeof codeOrParams === 'string'
        ? { code: codeOrParams, language: languageArg ?? 'python' }
        : { ...codeOrParams, language: codeOrParams.language ?? languageArg ?? 'python' };

      // Auto-detect packages only for Python and only when none provided.
      if (params.language === 'python' && !params.packages) {
        params.packages = detectPythonPackagesFromCode(params.code);
      }

      if (params.packages && params.packages.length > 0) {
        toast({
          title: 'Packages Detected',
          description: `Installing: ${params.packages.join(', ')}`,
          duration: 3000,
        });
      }

      // Use the multi-language run_code tool.
      const toolCall = {
        id: `run_code_${Date.now()}`,
        name: 'run_code',
        arguments: params,
      };

      const response = await fetch('/api/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolCalls: [toolCall] }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const results = await response.json();
      const result = results[0];

      let errorToDisplay = result.error;
      if (result.result && !result.result.success && result.result.message) {
        errorToDisplay = result.result.message;
      } else if (result.result && !result.result.success && result.result.error) {
        errorToDisplay = result.result.error;
      }

      setState(prev => ({
        ...prev,
        isExecuting: false,
        result: result.result,
        error: errorToDisplay,
      }));

      if (result.result && !result.result.success && errorToDisplay) {
        toast({
          variant: 'destructive',
          title: 'Code Execution Failed',
          description: errorToDisplay,
        });
      }

      if (result.result?.web_service?.proxy_url) {
        toast({
          title: 'Web service started',
          description: `${result.result.web_service.type || 'service'} available at ${result.result.web_service.proxy_url}`,
          duration: 6000,
        });
      }

      return result.result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to execute code';
      setState(prev => ({
        ...prev,
        isExecuting: false,
        result: null,
        error: errorMessage,
      }));
      toast({
        variant: 'destructive',
        title: 'Code Execution Failed',
        description: errorMessage,
      });
      throw error;
    }
  };

  const detectPythonPackagesFromCode = (code: string): string[] => {
    const importToPackage: Record<string, string> = {
      'cv2': 'opencv-python',
      'sklearn': 'scikit-learn',
      'PIL': 'Pillow',
      'bs4': 'beautifulsoup4',
      'yaml': 'PyYAML',
      'dns': 'dnspython',
      'serial': 'pyserial',
      'crypto': 'pycryptodome',
      'jwt': 'PyJWT',
      'dateutil': 'python-dateutil',
      'magic': 'python-magic',
      'psutil': 'psutil',
      'requests': 'requests',
      'numpy': 'numpy',
      'pandas': 'pandas',
      'matplotlib': 'matplotlib',
      'seaborn': 'seaborn',
      'plotly': 'plotly',
      'scipy': 'scipy',
      'tensorflow': 'tensorflow',
      'torch': 'torch',
      'transformers': 'transformers',
      'flask': 'flask',
      'fastapi': 'fastapi',
      'django': 'django',
      'sqlalchemy': 'sqlalchemy',
      'pymongo': 'pymongo',
      'redis': 'redis',
      'celery': 'celery',
      'pytest': 'pytest',
      'click': 'click',
      'rich': 'rich',
      'typer': 'typer',
      'pydantic': 'pydantic',
      'httpx': 'httpx',
      'aiohttp': 'aiohttp',
      'websockets': 'websockets',
      'streamlit': 'streamlit',
      'gradio': 'gradio',
      'dash': 'dash',
      'bokeh': 'bokeh',
      'altair': 'altair',
      'folium': 'folium',
      'geopandas': 'geopandas',
      'shapely': 'shapely',
      'rasterio': 'rasterio',
      'fiona': 'fiona',
      'openpyxl': 'openpyxl',
      'xlrd': 'xlrd',
      'xlsxwriter': 'xlsxwriter',
      'lxml': 'lxml',
      'html5lib': 'html5lib',
      'jinja2': 'jinja2',
      'markupsafe': 'markupsafe',
      'paramiko': 'paramiko',
      'fabric': 'fabric',
      'invoke': 'invoke',
    };

    const stdLibModules = new Set([
      'os', 'sys', 'json', 'time', 'datetime', 'random', 'math', 'collections',
      'itertools', 'functools', 'operator', 'pathlib', 'glob', 'shutil', 'tempfile',
      'subprocess', 'threading', 'multiprocessing', 'asyncio', 'concurrent', 'queue',
      'socket', 'ssl', 'urllib', 'http', 'email', 'base64', 'hashlib', 'hmac',
      'secrets', 'uuid', 'pickle', 'shelve', 'dbm', 'sqlite3', 'zlib', 'gzip',
      'bz2', 'lzma', 'zipfile', 'tarfile', 'csv', 'configparser', 'logging',
      'getpass', 'platform', 'stat', 'filecmp', 'fnmatch', 'linecache', 'traceback',
      'pdb', 'profile', 'pstats', 'timeit', 'cProfile', 'trace', 'gc', 'weakref',
      'copy', 'reprlib', 'pprint', 'enum', 'types', 'inspect', 'importlib',
      'pkgutil', 'modulefinder', 'runpy', 'argparse', 'optparse', 'shlex', 'struct',
      'codecs', 'unicodedata', 'stringprep', 'readline', 'rlcompleter', 'array',
      'bisect', 'heapq', 'keyword', 'io', 'mmap', 'select', 'selectors', 'signal',
      'warnings', 'contextlib', 'abc', 'atexit', 'site', 'builtins', '__main__', '__future__',
      'string', 're', 'difflib', 'textwrap',
      'decimal', 'fractions', 'numbers', 'cmath', 'statistics',
      'os.path', 'fileinput', 'copyreg', 'marshal',
      'netrc', 'xdrlib', 'plistlib',
      'getopt', 'curses', 'errno', 'ctypes',
      'sched',
      'asyncore', 'asynchat',
      'webbrowser', 'cgi', 'cgitb', 'wsgiref', 'ftplib', 'poplib', 'imaplib', 'nntplib', 'smtplib', 'smtpd', 'telnetlib', 'socketserver', 'xmlrpc',
      'audioop', 'aifc', 'sunau', 'wave', 'chunk', 'colorsys', 'imghdr', 'sndhdr', 'ossaudiodev',
      'gettext', 'locale',
      'turtle', 'cmd',
      'tkinter', 'tkinter.ttk', 'tkinter.tix', 'tkinter.scrolledtext',
      'typing', 'pydoc', 'doctest', 'unittest', 'test', '2to3', 'lib2to3',
      'bdb', 'faulthandler', 'tracemalloc',
      'distutils', 'ensurepip', 'venv', 'zipapp',
      'sysconfig', 'dataclasses',
      'code', 'codeop',
      'zipimport',
      'parser', 'ast', 'symtable', 'symbol', 'token', 'tokenize', 'tabnanny', 'pyclbr', 'py_compile', 'compileall', 'dis', 'pickletools',
      'formatter',
    ]);

    const importPatterns = [
      /^import\s+([\w.]+)/gm,
      /^from\s+([\w.]+)\s+import/gm,
    ];

    const detectedImports = new Set<string>();
    for (const pattern of importPatterns) {
      let match;
      while ((match = pattern.exec(code)) !== null) {
        const rootModule = match[1].split('.')[0];
        detectedImports.add(rootModule);
      }
    }

    const packages: string[] = [];
    detectedImports.forEach(imp => {
      if (importToPackage[imp]) {
        packages.push(importToPackage[imp]);
      } else if (!stdLibModules.has(imp)) {
        packages.push(imp);
      }
    });

    return Array.from(new Set(packages)).sort();
  };

  const clearResults = () => {
    setState(prev => ({ ...prev, isExecuting: false, result: null, error: null }));
  };

  return {
    executeCode,
    clearResults,
    isExecuting: state.isExecuting,
    result: state.result,
    error: state.error,
  };
}
