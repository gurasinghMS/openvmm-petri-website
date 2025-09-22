import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import './styles.css';
// Header component with dark grey background and white text
export function Header({ activeTab, setActiveTab, currentView, onBackToOverview }) {
    const handleTabClick = (tab) => {
        if ((currentView === 'details' || currentView === 'test-details' || currentView === 'test-logs') && onBackToOverview) {
            // If we're in details view, go back to overview first
            onBackToOverview();
        }
        // Set the active tab
        setActiveTab(tab);
    };
    // Don't highlight any tab when in details views
    const getTabClass = (tab) => {
        if (currentView === 'details' || currentView === 'test-details') {
            return 'tab-btn'; // No active class when in details view
        }
        return `tab-btn ${activeTab === tab ? 'active' : ''}`;
    };
    return (_jsxs("div", { className: "header-bar", children: [_jsxs("div", { className: "header-left", children: [_jsx("div", { className: "header-title", children: "Petri Test Viewer" }), _jsxs("div", { className: "tab-navigation", children: [_jsx("button", { className: getTabClass('runs'), onClick: () => handleTabClick('runs'), children: "Runs" }), _jsx("button", { className: getTabClass('tests'), onClick: () => handleTabClick('tests'), children: "Tests" })] })] }), _jsxs("div", { className: "header-buttons", children: [_jsx("a", { href: "https://github.com/microsoft/openvmm", target: "_blank", rel: "noopener noreferrer", className: "header-button", children: "Repo" }), _jsx("a", { href: "http://openvmm.dev/", target: "_blank", rel: "noopener noreferrer", className: "header-button", children: "Guide" })] })] }));
}
