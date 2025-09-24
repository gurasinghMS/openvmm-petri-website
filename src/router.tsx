// Simple URL router using browser History API
export interface RouteParams {
  tab?: 'runs' | 'tests';
  view?: 'overview' | 'run-details' | 'test-details' | 'test-logs';
  runId?: string;
  testName?: string;
  jobName?: string;
  searchFilter?: string;
}

export class Router {
  private listeners: Array<(params: RouteParams) => void> = [];

  constructor() {
    // Listen for back/forward button clicks
    window.addEventListener('popstate', () => {
      this.notifyListeners();
    });
  }

  // Parse current URL and return route parameters
  getCurrentRoute(): RouteParams {
    const url = new URL(window.location.href);
    const params: RouteParams = {};

    // Parse tab from hash or default to 'runs'
    const hash = url.hash.slice(1); // Remove the #
    const pathParts = hash.split('/').filter(Boolean);

    if (pathParts.length === 0) {
      params.tab = 'runs';
      params.view = 'overview';
      return params;
    }

    // Parse the route structure: #runs/12345 or #tests/test-name or #tests
    const firstPart = pathParts[0];
    
    if (firstPart === 'runs') {
      params.tab = 'runs';
      if (pathParts.length > 1) {
        params.view = 'run-details';
        params.runId = pathParts[1];
        
        // Check for test logs: #runs/12345/logs/test-name/job-name
        if (pathParts.length >= 5 && pathParts[2] === 'logs') {
          params.view = 'test-logs';
          params.testName = decodeURIComponent(pathParts[3]);
          params.jobName = decodeURIComponent(pathParts[4]);
        }
      } else {
        params.view = 'overview';
      }
    } else if (firstPart === 'tests') {
      params.tab = 'tests';
      if (pathParts.length > 1) {
        params.view = 'test-details';
        params.testName = decodeURIComponent(pathParts[1]);
      } else {
        params.view = 'overview';
      }
    } else {
      // Default fallback
      params.tab = 'runs';
      params.view = 'overview';
    }

    // Parse query parameters
    const searchParams = url.searchParams;
    if (searchParams.has('search')) {
      params.searchFilter = searchParams.get('search') || '';
    }

    return params;
  }

  // Navigate to a new route
  navigateTo(params: RouteParams, replace: boolean = false) {
    const url = this.buildUrl(params);
    
    if (replace) {
      window.history.replaceState(null, '', url);
    } else {
      window.history.pushState(null, '', url);
    }
    
    this.notifyListeners();
  }

  // Build URL from route parameters
  private buildUrl(params: RouteParams): string {
    let hash = '';
    const searchParams = new URLSearchParams();

    // Build hash based on view and parameters
    if (params.view === 'overview') {
      hash = params.tab || 'runs';
    } else if (params.view === 'run-details' && params.runId) {
      hash = `runs/${params.runId}`;
    } else if (params.view === 'test-details' && params.testName) {
      hash = `tests/${encodeURIComponent(params.testName)}`;
    } else if (params.view === 'test-logs' && params.runId && params.testName && params.jobName) {
      hash = `runs/${params.runId}/logs/${encodeURIComponent(params.testName)}/${encodeURIComponent(params.jobName)}`;
    } else {
      hash = params.tab || 'runs';
    }

    // Add search filter as query parameter
    if (params.searchFilter) {
      searchParams.set('search', params.searchFilter);
    }

    const queryString = searchParams.toString();
    return `#${hash}${queryString ? `?${queryString}` : ''}`;
  }

  // Subscribe to route changes
  subscribe(listener: (params: RouteParams) => void) {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  private notifyListeners() {
    const params = this.getCurrentRoute();
    this.listeners.forEach(listener => listener(params));
  }
}

// Create a singleton router instance
export const router = new Router();