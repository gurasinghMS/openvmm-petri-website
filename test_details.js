import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useMemo } from 'react';
import { useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, flexRender, } from '@tanstack/react-table';
import { getAllRuns, getTestResultsFromCache, getUncachedRunsForTest, fetchAndCacheRunDetails, addDataStoreListener, getCachedRunCount } from './dataStore';
import './styles.css';
export function TestDetails({ testName, onRunClick, onBack, searchFilter, onSearchFilterChange }) {
    const [testRuns, setTestRuns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [processedRuns, setProcessedRuns] = useState(0);
    const [totalRuns, setTotalRuns] = useState(0);
    const [loadAllRuns, setLoadAllRuns] = useState(false);
    const [sorting, setSorting] = useState([
        { id: 'createdOn', desc: true } // Default sort by creation time, newest first
    ]);
    useEffect(() => {
        // Reset to show only cached results when test name changes
        setLoadAllRuns(false);
    }, [testName]);
    useEffect(() => {
        const loadTestRuns = async (loadAll = false) => {
            try {
                setLoading(true);
                setError(null);
                // Get all runs to know the total count
                const allRuns = await getAllRuns();
                setTotalRuns(allRuns.length);
                // First, get any cached test results immediately
                const cachedResults = getTestResultsFromCache(testName);
                setTestRuns(cachedResults);
                setProcessedRuns(cachedResults.length);
                // If we have cached results, show them immediately
                if (cachedResults.length > 0) {
                    console.log(`🎯 Found ${cachedResults.length} cached results for test: ${testName}`);
                }
                if (!loadAll) {
                    // Show only cached results (from the initial 50 runs analysis)
                    console.log(`📊 Showing test results from ${cachedResults.length} already analyzed runs`);
                    setLoading(false);
                    return;
                }
                // Get runs that still need to be processed for "analyze all" mode
                const uncachedRuns = getUncachedRunsForTest();
                if (uncachedRuns.length === 0) {
                    // All runs are cached, we're done
                    console.log(`✅ All run data for test "${testName}" was already cached - instant load!`);
                    setLoadAllRuns(true);
                    setLoading(false);
                    return;
                }
                console.log(`🔍 Need to fetch ${uncachedRuns.length} more runs for test: ${testName} (${cachedResults.length} already cached)`);
                console.log(`📦 Will fetch in batches of 25 runs`);
                // Fetch the remaining runs in batches
                await fetchAndCacheRunDetails(uncachedRuns, (completed) => {
                    // Update progress
                    setProcessedRuns(cachedResults.length + completed);
                    // Get updated results from cache as new data comes in
                    const updatedResults = getTestResultsFromCache(testName);
                    setTestRuns(updatedResults);
                });
                // Final update with all results
                const finalResults = getTestResultsFromCache(testName);
                setTestRuns(finalResults);
                setLoadAllRuns(true);
            }
            catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load test run data');
            }
            finally {
                setLoading(false);
            }
        };
        loadTestRuns(loadAllRuns);
        // Subscribe to data store changes to get real-time updates
        const unsubscribe = addDataStoreListener(() => {
            // Update results when new data is cached
            const updatedResults = getTestResultsFromCache(testName);
            setTestRuns(updatedResults);
        });
        return unsubscribe;
    }, [testName, loadAllRuns]);
    // Define columns for the test runs table
    const columns = useMemo(() => [
        {
            accessorKey: 'runNumber',
            header: 'Run',
            cell: info => {
                const runNumber = info.getValue();
                const row = info.row.original;
                return (_jsx("button", { className: "run-link run-number-mono", onClick: () => onRunClick(row.runId, row.createdOn), title: `View details for run ${runNumber}`, children: runNumber }));
            },
            enableSorting: true,
        },
        {
            accessorKey: 'createdOn',
            header: 'Created On',
            cell: info => {
                const date = info.getValue();
                return (_jsxs("span", { className: "date-cell date-bold", children: [date.toLocaleDateString(), " ", date.toLocaleTimeString()] }));
            },
            enableSorting: true,
        },
        {
            accessorKey: 'branchName',
            header: 'Branch',
            enableSorting: true,
            cell: (info) => (_jsx("span", { className: "branch-name-2", children: info.getValue() })),
        },
        {
            accessorKey: 'status',
            header: 'Status',
            cell: info => {
                const status = info.getValue();
                return (_jsx("span", { className: `status-badge status-${status}`, children: status.charAt(0).toUpperCase() + status.slice(1) }));
            },
            enableSorting: true,
        },
        {
            accessorKey: 'githubUrl',
            header: 'GitHub Run',
            cell: info => {
                const url = info.getValue();
                const runNumber = info.row.original.runNumber;
                return (_jsx("a", { href: url, target: "_blank", rel: "noopener noreferrer", className: "github-link run-number-mono github-bold", title: `View GitHub Actions run ${runNumber}`, children: runNumber }));
            },
            enableSorting: false,
        },
    ], [onRunClick]);
    // Create the table instance
    const table = useReactTable({
        data: testRuns,
        columns,
        state: {
            sorting,
            globalFilter: searchFilter,
        },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        debugTable: false,
    });
    if (loading) {
        // Parse the test name to separate architecture and test name
        const testParts = testName.split('/');
        const architecture = testParts[0] || '';
        const testNameOnly = testParts[1] || testName;
        return (_jsxs("div", { className: "test-details-container", children: [_jsxs("div", { className: "test-details-header", children: [_jsxs("div", { className: "header-title-section", children: [_jsx("button", { className: "back-button", onClick: onBack, title: "Back to Tests Overview", children: "\u2190 Back" }), _jsxs("div", { className: "test-title-container", children: [_jsx("div", { className: "test-architecture", children: architecture }), _jsx("div", { className: "test-name-title", children: testNameOnly })] })] }), _jsx("div", { className: "header-search-section", children: _jsx("input", { type: "text", placeholder: "Search test runs...", value: searchFilter, onChange: (e) => onSearchFilterChange(e.target.value), className: "search-input" }) })] }), _jsx("div", { className: "test-details-loading", children: loadAllRuns ? (_jsxs(_Fragment, { children: ["Loading all test run details... (", processedRuns, "/", totalRuns, " runs processed)", testRuns.length > 0 && (_jsxs("div", { className: "test-details-progress", children: ["Found ", testRuns.length, " runs containing this test so far", _jsx("br", {}), _jsx("small", { children: "Using cached data where available, fetching remaining runs in batches of 25" })] }))] })) : (_jsxs(_Fragment, { children: ["Loading test run details from analyzed runs...", testRuns.length > 0 && (_jsxs("div", { className: "test-details-progress", children: ["Found ", testRuns.length, " runs containing this test from ", getCachedRunCount(), " analyzed runs"] }))] })) })] }));
    }
    if (error) {
        // Parse the test name to separate architecture and test name
        const testParts = testName.split('/');
        const architecture = testParts[0] || '';
        const testNameOnly = testParts[1] || testName;
        return (_jsxs("div", { className: "test-details-container", children: [_jsxs("div", { className: "test-details-header", children: [_jsxs("div", { className: "header-title-section", children: [_jsx("button", { className: "back-button", onClick: onBack, title: "Back to Tests Overview", children: "\u2190 Back" }), _jsxs("div", { className: "test-title-container", children: [_jsx("div", { className: "test-architecture", children: architecture }), _jsx("div", { className: "test-name-title", children: testNameOnly })] })] }), _jsx("div", { className: "header-search-section", children: _jsx("input", { type: "text", placeholder: "Search test runs...", value: searchFilter, onChange: (e) => onSearchFilterChange(e.target.value), className: "search-input" }) })] }), _jsxs("div", { className: "test-details-error", children: ["Error: ", error] })] }));
    }
    if (testRuns.length === 0) {
        // Parse the test name to separate architecture and test name
        const testParts = testName.split('/');
        const architecture = testParts[0] || '';
        const testNameOnly = testParts[1] || testName;
        return (_jsxs("div", { className: "test-details-container", children: [_jsxs("div", { className: "test-details-header", children: [_jsxs("div", { className: "header-title-section", children: [_jsx("button", { className: "back-button", onClick: onBack, title: "Back to Tests Overview", children: "\u2190 Back" }), _jsxs("div", { className: "test-title-container", children: [_jsx("div", { className: "test-architecture", children: architecture }), _jsx("div", { className: "test-name-title", children: testNameOnly })] })] }), _jsx("div", { className: "header-search-section", children: _jsx("input", { type: "text", placeholder: "Search test runs...", value: searchFilter, onChange: (e) => onSearchFilterChange(e.target.value), className: "search-input" }) })] }), _jsxs("div", { className: "test-details-empty", children: ["No runs found containing test: ", testName] })] }));
    }
    const passedRuns = testRuns.filter(run => run.status === 'passed').length;
    const failedRuns = testRuns.filter(run => run.status === 'failed').length;
    const unknownRuns = testRuns.filter(run => run.status === 'unknown').length;
    // Parse the test name to separate architecture and test name
    const testParts = testName.split('/');
    const architecture = testParts[0] || '';
    const testNameOnly = testParts[1] || testName;
    return (_jsxs("div", { className: "test-details-container", children: [_jsxs("div", { className: "test-details-header", children: [_jsxs("div", { className: "header-title-section", children: [_jsx("button", { className: "back-button", onClick: onBack, title: "Back to Tests Overview", children: "\u2190 Back" }), _jsxs("div", { className: "test-title-container", children: [_jsx("div", { className: "test-architecture", children: architecture }), _jsx("div", { className: "test-name-title", children: testNameOnly })] }), !loadAllRuns && totalRuns > getCachedRunCount() && (_jsx("button", { className: "load-all-btn", onClick: () => setLoadAllRuns(true), disabled: loading, children: "Analyze all runs" }))] }), _jsxs("div", { className: "header-search-section", children: [_jsx("input", { type: "text", placeholder: "Search test runs...", value: searchFilter, onChange: (e) => onSearchFilterChange(e.target.value), className: "search-input" }), _jsx("div", { className: "results-count", children: !loadAllRuns && totalRuns > getCachedRunCount() && (_jsxs("span", { children: [" From ", getCachedRunCount(), " of ", totalRuns, " analyzed runs"] })) })] })] }), _jsxs("div", { className: "test-details-content", children: [_jsx("div", { className: "test-details-summary", children: _jsxs("div", { className: "summary-stats", children: [_jsxs("span", { className: "stat-item", children: [_jsx("span", { className: "stat-label", children: "Total Runs:" }), _jsx("span", { className: "stat-value stat-mono", children: testRuns.length })] }), _jsxs("span", { className: "stat-item", children: [_jsx("span", { className: "stat-label", children: "Passed:" }), _jsx("span", { className: "stat-value stat-mono passed-count", children: passedRuns })] }), _jsxs("span", { className: "stat-item", children: [_jsx("span", { className: "stat-label", children: "Failed:" }), _jsx("span", { className: "stat-value stat-mono failed-count", children: failedRuns })] }), unknownRuns > 0 && (_jsxs("span", { className: "stat-item", children: [_jsx("span", { className: "stat-label", children: "Unknown:" }), _jsx("span", { className: "stat-value stat-mono unknown-count", children: unknownRuns })] })), _jsxs("span", { className: "stat-item", children: [_jsx("span", { className: "stat-label", children: "Pass Rate:" }), _jsxs("span", { className: "stat-value stat-mono", children: [testRuns.length > 0 ? ((passedRuns / testRuns.length) * 100).toFixed(1) : 0, "%"] })] })] }) }), _jsx("div", { className: "table-container", children: _jsxs("table", { className: "advanced-run-table", children: [_jsx("thead", { children: table.getHeaderGroups().map((headerGroup) => (_jsx("tr", { children: headerGroup.headers.map((header) => (_jsx("th", { className: header.column.getCanSort() ? 'sortable' : '', onClick: header.column.getToggleSortingHandler(), children: _jsxs("div", { className: "header-content", children: [header.isPlaceholder
                                                        ? null
                                                        : flexRender(header.column.columnDef.header, header.getContext()), header.column.getCanSort() && (_jsx("span", { className: "sort-indicator", children: {
                                                            asc: '↑',
                                                            desc: '↓',
                                                        }[header.column.getIsSorted()] ?? '⇅' }))] }) }, header.id))) }, headerGroup.id))) }), _jsx("tbody", { children: table.getRowModel().rows.map((row) => (_jsx("tr", { className: `table-row ${row.original.status === 'passed' ? 'passed-row' : row.original.status === 'failed' ? 'failed-row' : 'unknown-row'}`, children: row.getVisibleCells().map((cell) => (_jsx("td", { children: flexRender(cell.column.columnDef.cell, cell.getContext()) }, cell.id))) }, row.id))) })] }) })] })] }));
}
