import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Header } from './header';
import { RunOverview } from './runs_overview';
import { RunDetailsView } from './run_details';
import { TestDetails } from './test_details';
import { TestLogViewer } from './test_log_viewer';
import { fetchRunData } from './fetch';
import './styles.css';

// Main function that returns the Header component
function Main(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'runs' | 'tests'>('runs');
  const [currentView, setCurrentView] = useState<'overview' | 'details' | 'test-details' | 'test-logs'>('overview');
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [selectedRunDate, setSelectedRunDate] = useState<Date | undefined>(undefined);
  const [selectedTestName, setSelectedTestName] = useState<string>('');
  const [selectedJobName, setSelectedJobName] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [navigationContext, setNavigationContext] = useState<'overview' | 'test-details' | 'run-details'>('overview');

  const handleRunClick = (runId: string, runDate?: Date) => {
    setSelectedRunId(runId);
    setSelectedRunDate(runDate);
    setCurrentView('details');
    // Keep track of where we came from for proper back navigation
    if (currentView === 'test-details') {
      setNavigationContext('test-details');
    } else {
      setNavigationContext('overview');
    }
  };

  const handleTestClick = (testName: string) => {
    setSelectedTestName(testName);
    setCurrentView('test-details');
  };

  const handleTestLogClick = (testName: string, jobName: string) => {
    setSelectedTestName(testName);
    setSelectedJobName(jobName);
    setCurrentView('test-logs');
    setNavigationContext('run-details');
  };

  const handleBackToOverview = () => {
    setCurrentView('overview');
    setSelectedRunId('');
    setSelectedRunDate(undefined);
    setSelectedTestName('');
    setSelectedJobName('');
    setNavigationContext('overview');
  };

  const handleBackFromRunDetails = () => {
    if (navigationContext === 'test-details') {
      // Go back to test details page
      setCurrentView('test-details');
      setSelectedRunId('');
      setSelectedRunDate(undefined);
    } else {
      // Go back to overview
      handleBackToOverview();
    }
  };

  const handleBackFromTestLogs = () => {
    // Always go back to run details when coming from test logs
    setCurrentView('details');
    setSelectedTestName('');
    setSelectedJobName('');
    setNavigationContext('overview');
  };

  return (
    <div>
      <Header 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
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
            onSearchFilterChange={setSearchFilter}
          />
        ) : currentView === 'test-details' ? (
          <TestDetails
            testName={selectedTestName}
            onRunClick={handleRunClick}
            onBack={handleBackToOverview}
            searchFilter={searchFilter}
            onSearchFilterChange={setSearchFilter}
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
            onSearchFilterChange={setSearchFilter}
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
