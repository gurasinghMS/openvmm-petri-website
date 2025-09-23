import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Header } from './header';
import { RunOverview } from './runs_overview';
import { TestDetails } from './test_details';
import { TestLogViewer } from './test_log_viewer';
import './styles.css';
// Main function that returns the Header component
function Main() {
    const [activeTab, setActiveTab] = useState('runs');
    const [currentView, setCurrentView] = useState('overview');
    const [selectedRunId, setSelectedRunId] = useState('');
    const [selectedRunDate, setSelectedRunDate] = useState(undefined);
    const [selectedTestName, setSelectedTestName] = useState('');
    const [selectedJobName, setSelectedJobName] = useState('');
    const [searchFilter, setSearchFilter] = useState('');
    const [navigationContext, setNavigationContext] = useState('overview');
    const handleRunClick = (runId, runDate) => {
        setSelectedRunId(runId);
        setSelectedRunDate(runDate);
        setCurrentView('details');
        // Keep track of where we came from for proper back navigation
        if (currentView === 'test-details') {
            setNavigationContext('test-details');
        }
        else {
            setNavigationContext('overview');
        }
    };
    const handleTestClick = (testName) => {
        setSelectedTestName(testName);
        setCurrentView('test-details');
    };
    const handleTestLogClick = (testName, jobName) => {
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
        }
        else {
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
    return (_jsxs("div", { children: [_jsx(Header, { activeTab: activeTab, setActiveTab: setActiveTab, currentView: currentView, onBackToOverview: handleBackToOverview }), _jsx("div", { className: "main-container", children: currentView === 'overview' ? (_jsx(RunOverview, { activeTab: activeTab, onRunClick: handleRunClick, onTestClick: handleTestClick, currentView: "overview", searchFilter: searchFilter, onSearchFilterChange: setSearchFilter })) : currentView === 'test-details' ? (_jsx(TestDetails, { testName: selectedTestName, onRunClick: handleRunClick, onBack: handleBackToOverview, searchFilter: searchFilter, onSearchFilterChange: setSearchFilter })) : currentView === 'test-logs' ? (_jsx(TestLogViewer, { runId: selectedRunId, runDate: selectedRunDate, testName: selectedTestName, jobName: selectedJobName, onBack: handleBackFromTestLogs, githubUrl: `https://github.com/microsoft/openvmm/actions/runs/${selectedRunId}` })) : (_jsx(RunOverview, { activeTab: activeTab, onRunClick: handleRunClick, onTestClick: handleTestClick, currentView: "run-details", selectedRunId: selectedRunId, selectedRunDate: selectedRunDate, onBack: handleBackFromRunDetails, backButtonText: navigationContext === 'test-details' ? 'Test Details' : 'All Runs', searchFilter: searchFilter, onSearchFilterChange: setSearchFilter, onTestLogClick: handleTestLogClick })) })] }));
}
// Mount the app to the #root element when the page loads
const rootElement = document.getElementById('root');
if (rootElement) {
    const root = createRoot(rootElement);
    root.render(_jsx(Main, {}));
}
