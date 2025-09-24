import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Header } from './header';
import { RunOverview } from './runs_overview';
import { TestDetails } from './test_details';
import { TestLogViewer } from './test_log_viewer';
import { router, RouteParams } from './router';
import { getRunDataById, markTestsPageAccessed } from './dataStore';
import './styles.css';

// Main function that returns the Header component
function Main(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'runs' | 'tests'>('runs');
  const [currentView, setCurrentView] = useState<'overview' | 'run-details' | 'test-details' | 'test-logs'>('overview');
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [selectedRunDate, setSelectedRunDate] = useState<Date | undefined>(undefined);
  const [selectedTestName, setSelectedTestName] = useState<string>('');
  const [selectedJobName, setSelectedJobName] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [navigationContext, setNavigationContext] = useState<'overview' | 'test-details' | 'run-details'>('overview');

  // Initialize state from URL on mount and listen for changes
  useEffect(() => {
    const syncStateFromRoute = () => {
      const params = router.getCurrentRoute();
      
      const activeTab = params.tab || 'runs';
      setActiveTab(activeTab);
      setCurrentView(params.view || 'overview');
      setSearchFilter(params.searchFilter || '');
      
      // Mark tests page as accessed if navigating to tests tab
      if (activeTab === 'tests') {
        markTestsPageAccessed();
      }
      
      if (params.runId) {
        setSelectedRunId(params.runId);
        // Try to get the run date from cached data
        const runData = getRunDataById(params.runId);
        if (runData) {
          setSelectedRunDate(runData.creationTime);
        }
      } else {
        setSelectedRunId('');
        setSelectedRunDate(undefined);
      }
      
      if (params.testName) {
        setSelectedTestName(params.testName);
      } else {
        setSelectedTestName('');
      }
      
      if (params.jobName) {
        setSelectedJobName(params.jobName);
      } else {
        setSelectedJobName('');
      }
    };

    // Initial sync
    syncStateFromRoute();

    // Subscribe to route changes (back/forward navigation)
    const unsubscribe = router.subscribe(syncStateFromRoute);
    
    return unsubscribe;
  }, []);

  // Update URL when state changes (but not during initial load or browser navigation)
  const updateRoute = (params: Partial<RouteParams>, replace: boolean = false) => {
    const currentParams = router.getCurrentRoute();
    const newParams: RouteParams = {
      ...currentParams,
      ...params,
    };
    
    router.navigateTo(newParams, replace);
  };

  // Scroll to top when view changes
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentView, activeTab]);

  const handleRunClick = (runId: string, runDate?: Date) => {
    setSelectedRunId(runId);
    setSelectedRunDate(runDate);
    setCurrentView('run-details');
    // Keep track of where we came from for proper back navigation
    if (currentView === 'test-details') {
      setNavigationContext('test-details');
    } else {
      setNavigationContext('overview');
    }
    
    // Update URL
    updateRoute({
      tab: 'runs',
      view: 'run-details',
      runId: runId,
      testName: undefined,
      jobName: undefined,
    });
  };

  const handleTestClick = (testName: string) => {
    setSelectedTestName(testName);
    setCurrentView('test-details');
    
    // Update URL
    updateRoute({
      tab: 'tests',
      view: 'test-details',
      testName: testName,
      runId: undefined,
      jobName: undefined,
    });
  };

  const handleTestLogClick = (testName: string, jobName: string) => {
    setSelectedTestName(testName);
    setSelectedJobName(jobName);
    setCurrentView('test-logs');
    setNavigationContext('run-details');
    
    // Update URL
    updateRoute({
      view: 'test-logs',
      testName: testName,
      jobName: jobName,
    });
  };

  const handleBackToOverview = () => {
    setCurrentView('overview');
    setSelectedRunId('');
    setSelectedRunDate(undefined);
    setSelectedTestName('');
    setSelectedJobName('');
    setNavigationContext('overview');
    
    // Update URL
    updateRoute({
      view: 'overview',
      runId: undefined,
      testName: undefined,
      jobName: undefined,
    });
  };

  const handleBackFromRunDetails = () => {
    if (navigationContext === 'test-details') {
      // Go back to test details page
      setCurrentView('test-details');
      setSelectedRunId('');
      setSelectedRunDate(undefined);
      
      // Update URL
      updateRoute({
        tab: 'tests',
        view: 'test-details',
        runId: undefined,
      });
    } else {
      // Go back to overview
      handleBackToOverview();
    }
  };

  const handleBackFromTestLogs = () => {
    // Always go back to run details when coming from test logs
    setCurrentView('run-details');
    setSelectedTestName('');
    setSelectedJobName('');
    setNavigationContext('overview');
    
    // Update URL
    updateRoute({
      view: 'run-details',
      testName: undefined,
      jobName: undefined,
    });
  };

  const handleTabChange = (tab: 'runs' | 'tests') => {
    setActiveTab(tab);
    
    // Update URL
    updateRoute({
      tab: tab,
      view: 'overview',
      runId: undefined,
      testName: undefined,
      jobName: undefined,
    });
  };

  const handleSearchFilterChange = (filter: string) => {
    setSearchFilter(filter);
    
    // Update URL with search filter
    updateRoute({
      searchFilter: filter,
    });
  };

  return (
    <div>
      <Header 
        activeTab={activeTab} 
        setActiveTab={handleTabChange} 
        currentView={currentView}
        onBackToOverview={handleBackToOverview}
      />
      <div className="main-container">
        {currentView === 'overview' ? (
          <RunOverview 
            activeTab={activeTab} 
            onRunClick={handleRunClick}
            onTestClick={handleTestClick}
            currentView="overview"
            searchFilter={searchFilter}
            onSearchFilterChange={handleSearchFilterChange}
          />
        ) : currentView === 'test-details' ? (
          <TestDetails
            testName={selectedTestName}
            onRunClick={handleRunClick}
            onBack={handleBackToOverview}
            searchFilter={searchFilter}
            onSearchFilterChange={handleSearchFilterChange}
          />
        ) : currentView === 'test-logs' ? (
          <TestLogViewer
            runId={selectedRunId}
            runDate={selectedRunDate}
            testName={selectedTestName}
            jobName={selectedJobName}
            onBack={handleBackFromTestLogs}
            githubUrl={`https://github.com/microsoft/openvmm/actions/runs/${selectedRunId}`}
          />
        ) : (
          <RunOverview 
            activeTab={activeTab} 
            onRunClick={handleRunClick}
            onTestClick={handleTestClick}
            currentView="run-details"
            selectedRunId={selectedRunId}
            selectedRunDate={selectedRunDate}
            onBack={handleBackFromRunDetails}
            backButtonText={navigationContext === 'test-details' ? 'Test Details' : 'All Runs'}
            searchFilter={searchFilter}
            onSearchFilterChange={handleSearchFilterChange}
            onTestLogClick={handleTestLogClick}
          />
        )}
      </div>
    </div>
  );
}

// Mount the app to the #root element when the page loads
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<Main />);
}
