import React from 'react';
import './styles.css';

interface HeaderProps {
  activeTab: 'runs' | 'tests';
  setActiveTab: (tab: 'runs' | 'tests') => void;
  currentView: 'overview' | 'details' | 'test-details' | 'test-logs';
  onBackToOverview?: () => void;
}

// Header component with dark grey background and white text
export function Header({ activeTab, setActiveTab, currentView, onBackToOverview }: HeaderProps): React.JSX.Element {
  const handleTabClick = (tab: 'runs' | 'tests') => {
    if ((currentView === 'details' || currentView === 'test-details' || currentView === 'test-logs') && onBackToOverview) {
      // If we're in details view, go back to overview first
      onBackToOverview();
    }
    // Set the active tab
    setActiveTab(tab);
  };

  // Don't highlight any tab when in details views
  const getTabClass = (tab: 'runs' | 'tests') => {
    if (currentView === 'details' || currentView === 'test-details') {
      return 'tab-btn'; // No active class when in details view
    }
    return `tab-btn ${activeTab === tab ? 'active' : ''}`;
  };

  return (
    <div className="header-bar">
      <div className="header-left">
        <div className="header-title">
          Petri Test Viewer
        </div>
        <div className="tab-navigation">
          <button
            className={getTabClass('runs')}
            onClick={() => handleTabClick('runs')}
          >
            Runs
          </button>
          <button
            className={getTabClass('tests')}
            onClick={() => handleTabClick('tests')}
          >
            Tests
          </button>
        </div>
      </div>
      <div className="header-buttons">
        <a href="https://github.com/microsoft/openvmm" target="_blank" rel="noopener noreferrer" className="header-button">Repo</a>
        <a href="http://openvmm.dev/" target="_blank" rel="noopener noreferrer" className="header-button">Guide</a>
      </div>
    </div>
  );
}