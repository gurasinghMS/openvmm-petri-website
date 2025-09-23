import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useMemo } from 'react';
import { useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, flexRender, } from '@tanstack/react-table';
import { getAllRuns, fetchAndCacheRunDetails, addDataStoreListener, getRunDetails, getTestStatsFromCache, getCachedRunCount, getAnalysisState, } from './dataStore';
import { TestsOverview } from './tests_overview';
import { RunDetailsView } from './run_details';
import './styles.css';
export function RunOverview({ activeTab, onRunClick, onTestClick, onTestLogClick, currentView, selectedRunId, selectedRunDate, onBack, backButtonText = "All Runs", }) {
    const [runs, setRuns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [branchFilter, setBranchFilter] = useState('all');
    // Test data state - now using persistent state from dataStore
    const [testStats, setTestStats] = useState(new Map());
    const [testDataError, setTestDataError] = useState(null);
    const [testDataLoaded, setTestDataLoaded] = useState(false);
    const [sorting, setSorting] = useState([
        { id: 'creationTime', desc: true } // Default sort by creation time, newest first
    ]);
    const [globalFilter, setGlobalFilter] = useState('');
    // Tests page state
    const [testSearchFilter, setTestSearchFilter] = useState('');
    const [testArchitectureFilter, setTestArchitectureFilter] = useState('all');
    // Run details page state
    const [runDetailsSearchFilter, setRunDetailsSearchFilter] = useState('');
    const [currentRunDetails, setCurrentRunDetails] = useState(null);
    useEffect(() => {
        const loadRuns = async () => {
            try {
                setLoading(true);
                const data = await getAllRuns();
                setRuns(data);
            }
            catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to fetch run data');
            }
            finally {
                setLoading(false);
            }
        };
        loadRuns();
    }, []);
    // Preload the most recent 50 runs immediately after runs are loaded
    useEffect(() => {
        const preloadRecentRuns = async () => {
            if (runs.length > 0 && !testDataLoaded) {
                console.log('🚀 Preloading most recent 50 runs in background...');
                // Get the 50 most recent runs
                const sortedRuns = [...runs].sort((a, b) => b.creationTime.getTime() - a.creationTime.getTime());
                const recentRuns = sortedRuns.slice(0, 50);
                const runNumbers = recentRuns.map(run => run.name.replace('runs/', ''));
                console.log('📋 Preloading run numbers:');
                recentRuns.forEach((run, index) => {
                    const runNumber = run.name.replace('runs/', '');
                    console.log(`  ${index + 1}. Run ${runNumber} (created: ${run.creationTime.toISOString()})`);
                });
                try {
                    // Fetch and cache the run details in the background
                    await fetchAndCacheRunDetails(runNumbers, (completed, total) => {
                        console.log(`📊 Preload progress: ${completed}/${total} runs cached`);
                    });
                    console.log('✅ Preloading complete! Tests Overview will now be instant.');
                }
                catch (error) {
                    console.warn('⚠️ Preloading failed, but will continue normally:', error);
                }
            }
        };
        preloadRecentRuns();
    }, [runs.length, testDataLoaded]);
    // Load test data only when needed and not already loaded
    useEffect(() => {
        if (activeTab === 'tests' && runs.length > 0 && !testDataLoaded && testStats.size === 0) {
            loadTestData(false); // Start with recent runs
        }
    }, [activeTab, runs.length, testDataLoaded, testStats.size]);
    // Add dataStore listener to update test stats in real-time
    useEffect(() => {
        const unsubscribe = addDataStoreListener(() => {
            // Update test stats from cache whenever dataStore changes
            const newTestStats = getTestStatsFromCache();
            if (newTestStats.size > 0) {
                setTestStats(newTestStats);
                if (!testDataLoaded && newTestStats.size > 0) {
                    setTestDataLoaded(true);
                }
            }
        });
        // Also update immediately if there's already cached data
        const currentTestStats = getTestStatsFromCache();
        if (currentTestStats.size > 0) {
            setTestStats(currentTestStats);
            if (!testDataLoaded) {
                setTestDataLoaded(true);
            }
        }
        return unsubscribe;
    }, [testDataLoaded, runs.length]);
    // Load run details when selectedRunId changes
    useEffect(() => {
        if (currentView === 'run-details' && selectedRunId) {
            const loadRunDetails = async () => {
                try {
                    const details = await getRunDetails(selectedRunId);
                    setCurrentRunDetails(details);
                }
                catch (error) {
                    console.error('Failed to load run details for header:', error);
                    setCurrentRunDetails(null);
                }
            };
            loadRunDetails();
        }
        else {
            setCurrentRunDetails(null);
        }
    }, [currentView, selectedRunId]);
    const loadTestData = async (loadAll) => {
        const analysisState = getAnalysisState();
        if (analysisState.isLoading)
            return; // Prevent multiple simultaneous loads
        try {
            setTestDataError(null);
            // Determine which runs to load - get the most recent by creation time
            const sortedRuns = [...runs].sort((a, b) => b.creationTime.getTime() - a.creationTime.getTime());
            const runsToLoad = loadAll ? sortedRuns : sortedRuns.slice(0, 50);
            console.log(`Starting to fetch details for ${loadAll ? 'all' : 'most recent'} ${runsToLoad.length} runs using unified data store...`);
            // Extract run numbers for the data store
            const runNumbers = runsToLoad.map(run => run.name.replace('runs/', ''));
            // Use the data store to fetch/cache run details with progress tracking
            // The dataStore listener will automatically update testStats when data arrives
            await fetchAndCacheRunDetails(runNumbers, undefined, loadAll);
            // Get final stats from the dataStore (the listener will have updated them too)
            const finalStats = getTestStatsFromCache();
            setTestStats(finalStats);
            setTestDataLoaded(true);
            console.log(`Completed fetching details for ${runsToLoad.length} runs. Found ${finalStats.size} unique tests.`);
        }
        catch (err) {
            setTestDataError(err instanceof Error ? err.message : 'Failed to fetch run details');
            console.error('Error loading run details:', err);
        }
    };
    // Filter runs based on branch selection
    const filteredRuns = useMemo(() => {
        if (branchFilter === 'all') {
            return runs;
        }
        return runs.filter(run => run.metadata.ghBranch === branchFilter);
    }, [runs, branchFilter]);
    const columns = useMemo(() => [
        {
            accessorKey: 'name',
            header: 'Run',
            enableSorting: true,
            cell: (info) => {
                const runId = info.getValue().replace('runs/', '');
                const rowData = info.row.original;
                return (_jsx("a", { href: "#", onClick: (e) => {
                        e.preventDefault();
                        onRunClick?.(runId, rowData.creationTime);
                    }, className: "run-name-link", children: runId }));
            },
            sortingFn: (rowA, rowB, columnId) => {
                const a = rowA.getValue(columnId);
                const b = rowB.getValue(columnId);
                return a.localeCompare(b);
            },
        },
        {
            accessorKey: 'creationTime',
            header: 'Created',
            enableSorting: true,
            cell: (info) => (_jsx("span", { className: "created-date", children: info.getValue().toLocaleString() })),
            sortingFn: (rowA, rowB, columnId) => {
                const a = rowA.getValue(columnId);
                const b = rowB.getValue(columnId);
                return a.getTime() - b.getTime();
            },
        },
        {
            id: 'status',
            header: 'Status',
            enableSorting: true,
            accessorFn: (row) => row.metadata.petriFailed === 0 ? 'passed' : 'failed',
            cell: (info) => {
                const status = info.getValue();
                return (_jsx("div", { className: "status-cell", children: _jsx("span", { className: status === 'passed' ? 'status-pass' : 'status-fail' }) }));
            },
        },
        {
            accessorKey: 'metadata.petriPassed',
            header: 'Passed',
            enableSorting: true,
            cell: (info) => (_jsx("span", { className: "passed-count", children: info.getValue() })),
        },
        {
            accessorKey: 'metadata.petriFailed',
            header: 'Failed',
            enableSorting: true,
            cell: (info) => (_jsx("span", { className: "failed-count", children: info.getValue() })),
        },
        {
            id: 'total',
            header: 'Total',
            enableSorting: true,
            accessorFn: (row) => row.metadata.petriPassed + row.metadata.petriFailed,
            cell: (info) => (_jsx("span", { className: "total-count", children: info.getValue() })),
        },
        {
            accessorKey: 'metadata.ghBranch',
            header: 'Branch',
            enableSorting: true,
            cell: (info) => (_jsx("span", { className: "branch-name", children: info.getValue() })),
        },
        {
            accessorKey: 'metadata.ghPr',
            header: 'PR',
            enableSorting: true,
            accessorFn: (row) => {
                const pr = row.metadata.ghPr;
                const prTitle = row.metadata.prTitle;
                // Combine PR number and title for searching
                return pr ? `${pr} ${prTitle || ''}`.trim() : '';
            },
            cell: (info) => {
                const row = info.row.original;
                const pr = row.metadata.ghPr;
                const prTitle = row.metadata.prTitle;
                return pr ? (_jsx("div", { className: "pr-cell", children: _jsxs("a", { href: `https://github.com/microsoft/openvmm/pull/${pr}`, target: "_blank", rel: "noopener noreferrer", className: "pr-combined-link", title: prTitle ? `#${pr} ${prTitle}` : `PR #${pr}`, children: ["#", pr, prTitle ? ` ${prTitle}` : ''] }) })) : (_jsx("span", { className: "no-pr", children: "-" }));
            },
            sortingFn: (rowA, rowB) => {
                const a = rowA.original.metadata.ghPr;
                const b = rowB.original.metadata.ghPr;
                if (!a && !b)
                    return 0;
                if (!a)
                    return 1;
                if (!b)
                    return -1;
                return parseInt(a) - parseInt(b);
            },
        },
        {
            accessorKey: 'name',
            header: 'GH Run',
            enableSorting: true,
            cell: (info) => {
                const runId = info.getValue().replace('runs/', '');
                return (_jsx("a", { href: `https://github.com/microsoft/openvmm/actions/runs/${runId}`, target: "_blank", rel: "noopener noreferrer", className: "run-name-link", children: runId }));
            },
            sortingFn: (rowA, rowB, columnId) => {
                const a = rowA.getValue(columnId);
                const b = rowB.getValue(columnId);
                return a.localeCompare(b);
            },
        },
    ], []);
    const table = useReactTable({
        data: filteredRuns,
        columns,
        state: {
            sorting,
            globalFilter,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setGlobalFilter,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        enableSorting: true,
        enableSortingRemoval: false,
        debugTable: false,
    });
    if (loading) {
        return _jsx("div", { className: "run-overview-loading", children: "Loading run data..." });
    }
    if (error) {
        return _jsxs("div", { className: "run-overview-error", children: ["Error: ", error] });
    }
    return (_jsxs("div", { className: "run-overview", children: [_jsxs("div", { className: "run-overview-header", children: [currentView === 'overview' && activeTab === 'runs' && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "header-left-section", children: [_jsx("div", { className: "header-title-section", children: _jsx("h3", { children: "Runs" }) }), _jsxs("div", { className: "branch-filter-buttons", children: [_jsx("button", { className: `branch-filter-btn ${branchFilter === 'all' ? 'active' : ''}`, onClick: () => setBranchFilter('all'), children: "All" }), _jsx("button", { className: `branch-filter-btn ${branchFilter === 'main' ? 'active' : ''}`, onClick: () => setBranchFilter('main'), children: "main" }), _jsx("button", { className: `branch-filter-btn ${branchFilter === 'release/2505' ? 'active' : ''}`, onClick: () => setBranchFilter('release/2505'), children: "release/2505" })] })] }), _jsxs("div", { className: "table-controls", children: [_jsx("input", { value: globalFilter ?? '', onChange: (e) => setGlobalFilter(e.target.value), placeholder: "Search all columns...", className: "search-input" }), _jsxs("span", { className: "results-count", children: [table.getFilteredRowModel().rows.length, " runs"] })] })] })), currentView === 'overview' && activeTab === 'tests' && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "header-left-section", children: [_jsx("div", { className: "header-title-section", children: _jsx("h3", { children: "Tests" }) }), testStats.size > 0 && (_jsx("div", { className: "architecture-filter-section", children: _jsxs("select", { value: testArchitectureFilter, onChange: (e) => setTestArchitectureFilter(e.target.value), className: "architecture-filter-select", children: [_jsx("option", { value: "all", children: "All Architectures" }), Array.from(new Set(Array.from(testStats.values()).map(test => test.testName.split('/')[0]))).sort().map(arch => (_jsx("option", { value: arch, children: arch }, arch)))] }) })), !getAnalysisState().loadAllRuns && getCachedRunCount() < runs.length && (_jsx("button", { className: "load-all-btn", onClick: () => loadTestData(true), disabled: getAnalysisState().isLoading, children: "Analyze all runs" }))] }), _jsxs("div", { className: "table-controls", children: [_jsx("input", { value: testSearchFilter, onChange: (e) => setTestSearchFilter(e.target.value), placeholder: "Search tests...", className: "search-input" }), _jsxs("div", { className: "results-count", children: [testStats.size, " tests", !getAnalysisState().loadAllRuns && getCachedRunCount() < runs.length && (_jsxs("span", { children: [" \u2022 Analyzed ", getCachedRunCount(), " of ", runs.length, " runs"] }))] })] })] })), currentView === 'run-details' && selectedRunId && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "header-left-section", children: [_jsxs("button", { className: "back-button dark-grey", onClick: onBack, title: `Back to ${backButtonText.toLowerCase()}`, children: ["\u2190 ", backButtonText] }), _jsxs("div", { className: "header-title-section", children: [_jsxs("div", { className: "run-title-container", children: [_jsx("h3", { children: selectedRunId }), selectedRunDate && (_jsx("div", { className: "run-date-subtitle", children: selectedRunDate.toLocaleDateString('en-US', {
                                                            year: 'numeric',
                                                            month: 'short',
                                                            day: 'numeric',
                                                            hour: '2-digit',
                                                            minute: '2-digit'
                                                        }) }))] }), currentRunDetails && (_jsxs("div", { className: "run-stats", children: [_jsxs("span", { className: "stat-item", children: ["Total: ", _jsx("strong", { children: currentRunDetails.tests?.length || 0 })] }), _jsxs("span", { className: "stat-item passed", children: ["Passed: ", _jsx("strong", { children: currentRunDetails.tests?.filter(t => t.status === 'passed').length || 0 })] }), _jsxs("span", { className: "stat-item failed", children: ["Failed: ", _jsx("strong", { children: currentRunDetails.tests?.filter(t => t.status === 'failed').length || 0 })] })] }))] })] }), _jsxs("div", { className: "table-controls", children: [_jsx("input", { value: runDetailsSearchFilter, onChange: (e) => setRunDetailsSearchFilter(e.target.value), placeholder: "Search tests...", className: "search-input" }), _jsx("button", { onClick: () => window.open(`https://github.com/microsoft/openvmm/actions/runs/${selectedRunId}`, '_blank'), className: "github-button", children: "GitHub Run" })] })] }))] }), _jsxs("div", { className: "run-overview-content", children: [currentView === 'overview' && activeTab === 'runs' && (_jsx("div", { className: "table-container", children: _jsxs("table", { className: "advanced-run-table", children: [_jsx("thead", { children: table.getHeaderGroups().map((headerGroup) => (_jsx("tr", { children: headerGroup.headers.map((header) => (_jsx("th", { className: header.column.getCanSort() ? 'sortable' : '', onClick: header.column.getToggleSortingHandler(), children: _jsxs("div", { className: "header-content", children: [header.isPlaceholder
                                                        ? null
                                                        : flexRender(header.column.columnDef.header, header.getContext()), header.column.getCanSort() && (_jsx("span", { className: "sort-indicator", children: {
                                                            asc: '↑',
                                                            desc: '↓',
                                                        }[header.column.getIsSorted()] ?? '⇅' }))] }) }, header.id))) }, headerGroup.id))) }), _jsx("tbody", { children: table.getRowModel().rows.map((row) => (_jsx("tr", { className: `table-row ${row.original.metadata.petriFailed > 0 ? 'failed-row' : 'passed-row'}`, children: row.getVisibleCells().map((cell) => (_jsx("td", { children: flexRender(cell.column.columnDef.cell, cell.getContext()) }, cell.id))) }, row.id))) })] }) })), currentView === 'overview' && activeTab === 'tests' && (_jsx(TestsOverview, { runs: runs, testStats: testStats, loading: getAnalysisState().isLoading, error: testDataError, processedRuns: getCachedRunCount(), totalRuns: getAnalysisState().targetRunCount || runs.length, loadAllRuns: getAnalysisState().loadAllRuns, onLoadAll: () => loadTestData(true), searchFilter: testSearchFilter, architectureFilter: testArchitectureFilter, onTestClick: onTestClick })), currentView === 'run-details' && selectedRunId && (_jsx(RunDetailsView, { runId: selectedRunId, searchFilter: runDetailsSearchFilter, onTestLogClick: onTestLogClick }))] })] }));
}
