import { useState } from 'react';
import { useToast } from './use-toast';

interface CodeExecutionParams {
  code: string;
  packages?: string[];
  timeout?: number;
}

interface CodeExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  execution_time?: number;
  container_id?: string;
  status?: string;
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

  

  const executeCode = async (codeOrParams: string | CodeExecutionParams) => {
    setState(prev => ({ ...prev, isExecuting: true, result: null, error: null }));

    try {
      // Handle both string code and params object
      const params = typeof codeOrParams === 'string' 
        ? { code: codeOrParams, packages: detectPackagesFromCode(codeOrParams) }
        : codeOrParams;

      // Show detected packages to user
      if (params.packages && params.packages.length > 0) {
        toast({
          title: 'Packages Detected',
          description: `Installing: ${params.packages.join(', ')}`,
          duration: 3000,
        });
      }

      // Create a fake tool call for run_python tool
      const toolCall = {
        id: `run_python_${Date.now()}`,
        name: 'run_python',
        arguments: params,
      };

      // Use the existing tool execution mechanism
      const response = await fetch('/api/tools/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          toolCalls: [toolCall],
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const results = await response.json();
      const result = results[0]; // Get the first (and only) result
      
      // For error cases, prioritize the message field over the generic error field
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
        error: errorToDisplay 
      }));

      // Show toast for tool execution errors
      if (result.result && !result.result.success && errorToDisplay) {
        toast({
          variant: 'destructive',
          title: 'Code Execution Failed',
          description: errorToDisplay,
        });
      }

      return result.result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to execute code';
      setState(prev => ({ 
        ...prev,
        isExecuting: false, 
        result: null, 
        error: errorMessage 
      }));
      
      toast({
        variant: 'destructive',
        title: 'Code Execution Failed',
        description: errorMessage,
      });
      
      throw error;
    }
  };

  const detectPackagesFromCode = (code: string): string[] => {
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
      'markupsafe': 'markupsafe'
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
      'warnings', 'contextlib', 'abc', 'atexit', 'site', 'builtins', '__main__', '__future__'
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