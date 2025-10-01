import React from 'react';
import './styles/header.css';
import { useNavigate } from 'react-router-dom';

// Header component with dark grey background and white text
export function Header(): React.JSX.Element {
  const navigate = useNavigate();
  const currentPath = window.location.pathname;

  function getTabClass(tab: 'runs' | 'tests') {
    const isActive =
      (tab === 'runs' && currentPath.endsWith('/runs')) ||
      (tab === 'tests' && currentPath.endsWith('/tests'));
    return isActive ? 'header-tab active' : 'header-tab';
  }

  return (
    <div className="header-bar">
      <div className="header-left">
        <div className="header-title">
          Petri Test Viewer
        </div>
        <div className="tab-navigation">
          <div
            className={getTabClass('runs')}
            onClick={() => navigate('runs')}
          >
            Runs
          </div>
          <div
            className={getTabClass('tests')}
            onClick={() => navigate('tests')}
          >
            Tests
          </div>
        </div>
      </div>
      <div className="header-buttons">
        <a href="https://github.com/microsoft/openvmm" target="_blank" rel="noopener noreferrer" className="header-button">Repo</a>
        <a href="http://openvmm.dev/" target="_blank" rel="noopener noreferrer" className="header-button">Guide</a>
      </div>
    </div>
  );
}