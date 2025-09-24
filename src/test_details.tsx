import React, { useState, useEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  ColumnDef,
  flexRender,
  SortingState,
} from '@tanstack/react-table';
import { 
  getTestResultsFromCache, 
  addDataStoreListener
} from './dataStore';
import './styles.css';

interface TestRunResult {
  runNumber: string;
  runId: string;
  createdOn: Date;
  branchName: string;
  status: 'passed' | 'failed' | 'unknown';
  githubUrl: string;
}

interface TestDetailsProps {
  testName: string;
  onRunClick: (runId: string, runDate?: Date) => void;
  onBack: () => void;
  searchFilter: string;
  onSearchFilterChange: (filter: string) => void;
}

export function TestDetails({ 
  testName, 
  onRunClick, 
  onBack, 
  searchFilter,
  onSearchFilterChange
}: TestDetailsProps): React.JSX.Element {
  const [testRuns, setTestRuns] = useState<TestRunResult[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'createdOn', desc: true } // Default sort by creation time, newest first
  ]);

  useEffect(() => {
    const loadTestRuns = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Get cached test results (only from main/release branches)
        const cachedResults = getTestResultsFromCache(testName);
        setTestRuns(cachedResults);
        
        console.log(`🎯 Found ${cachedResults.length} cached results for test: ${testName} from main/release branches`);
        
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load test run data');
      } finally {
        setLoading(false);
      }
    };

    loadTestRuns();
    
    // Subscribe to data store changes to get real-time updates
    const unsubscribe = addDataStoreListener(() => {
      // Update results when new data is cached
      const updatedResults = getTestResultsFromCache(testName);
      setTestRuns(updatedResults);
    });
    
    return unsubscribe;
  }, [testName]);

  // Define columns for the test runs table
  const columns = useMemo<ColumnDef<TestRunResult>[]>(() => [
    {
      accessorKey: 'runNumber',
      header: 'Run',
      cell: info => {
        const runNumber = info.getValue() as string;
        const row = info.row.original;
        return (
          <button 
            className="run-link run-number-mono"
            onClick={() => onRunClick(row.runId, row.createdOn)}
            title={`View details for run ${runNumber}`}
          >
            {runNumber}
          </button>
        );
      },
      enableSorting: true,
    },
    {
      accessorKey: 'createdOn',
      header: 'Created On',
      cell: info => {
        const date = info.getValue() as Date;
        return (
          <span className="date-cell date-bold">
            {date.toLocaleDateString()} {date.toLocaleTimeString()}
          </span>
        );
      },
      enableSorting: true,
    },
    {
      accessorKey: 'branchName',
      header: 'Branch',
      enableSorting: true,
      cell: (info) => (
        <span className="branch-name-2">{info.getValue<string>()}</span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: info => {
        const status = info.getValue() as string;
        return (
          <span className={`status-badge status-${status}`}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
        );
      },
      enableSorting: true,
    },
    {
      accessorKey: 'githubUrl',
      header: 'GitHub Run',
      cell: info => {
        const url = info.getValue() as string;
        const runNumber = info.row.original.runNumber;
        return (
          <a 
            href={url} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="github-link run-number-mono github-bold"
            title={`View GitHub Actions run ${runNumber}`}
          >
            {runNumber}
          </a>
        );
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

  // If loading and no test runs yet, show initial loading screen
  if (loading && testRuns.length === 0) {
    // Parse the test name to separate architecture and test name
    const testParts = testName.split('/');
    const architecture = testParts[0] || '';
    const testNameOnly = testParts[1] || testName;

    return (
      <div className="test-details-container">
        <div className="test-details-header">
          <div className="header-title-section">
            <button className="back-button" onClick={onBack} title="Back to Tests Overview">
              ← Back
            </button>
            <div className="test-title-container">
              <div className="test-architecture">{architecture}</div>
              <div className="test-name-title">{testNameOnly}</div>
            </div>
          </div>
          <div className="header-search-section">
            <input
              type="text"
              placeholder="Search test runs..."
              value={searchFilter}
              onChange={(e) => onSearchFilterChange(e.target.value)}
              className="search-input"
            />
          </div>
        </div>
        <div className="test-details-loading">
          Loading test run details from analyzed runs...
        </div>
      </div>
    );
  }

  if (error) {
    // Parse the test name to separate architecture and test name
    const testParts = testName.split('/');
    const architecture = testParts[0] || '';
    const testNameOnly = testParts[1] || testName;

    return (
      <div className="test-details-container">
        <div className="run-overview-header">
          <div className="header-title-section">
            <button className="back-button" onClick={onBack} title="Back to Tests Overview">
              ← Back
            </button>
            <div className="test-title-container">
              <div className="test-architecture">{architecture}</div>
              <div className="test-name-title">{testNameOnly}</div>
            </div>
          </div>
          <div className="header-search-section">
            <input
              type="text"
              placeholder="Search test runs..."
              value={searchFilter}
              onChange={(e) => onSearchFilterChange(e.target.value)}
              className="search-input"
            />
          </div>
        </div>
        <div className="test-details-error">Error: {error}</div>
      </div>
    );
  }

  if (testRuns.length === 0) {
    // Parse the test name to separate architecture and test name
    const testParts = testName.split('/');
    const architecture = testParts[0] || '';
    const testNameOnly = testParts[1] || testName;

    return (
      <div className="test-details-container">
        <div className="run-overview-header">
          <div className="header-title-section">
            <button className="back-button" onClick={onBack} title="Back to Tests Overview">
              ← Back
            </button>
            <div className="test-title-container">
              <div className="test-architecture">{architecture}</div>
              <div className="test-name-title">{testNameOnly}</div>
            </div>
          </div>
          <div className="header-search-section">
            <input
              type="text"
              placeholder="Search test runs..."
              value={searchFilter}
              onChange={(e) => onSearchFilterChange(e.target.value)}
              className="search-input"
            />
          </div>
        </div>
        <div className="test-details-empty">
          No runs found containing test: {testName}
        </div>
      </div>
    );
  }

  const passedRuns = testRuns.filter(run => run.status === 'passed').length;
  const failedRuns = testRuns.filter(run => run.status === 'failed').length;
  const unknownRuns = testRuns.filter(run => run.status === 'unknown').length;

  // Parse the test name to separate architecture and test name
  const testParts = testName.split('/');
  const architecture = testParts[0] || '';
  const testNameOnly = testParts[1] || testName;

  return (
    <div className="test-details-container">
      <div className="run-overview-header">
        <div className="header-title-section">
          <button className="back-button" onClick={onBack} title="Back to Tests Overview">
            ← Back
          </button>
          <div className="test-title-container">
            <div className="test-architecture">{architecture}</div>
            <div className="test-name-title">{testNameOnly}</div>
          </div>
        </div>
        <div className="header-search-section">
          <input
            type="text"
            placeholder="Search test runs..."
            value={searchFilter}
            onChange={(e) => onSearchFilterChange(e.target.value)}
            className="search-input"
          />
        </div>
      </div>
      
      <div className="test-details-content">
        <div className="test-details-summary">
          <div className="summary-stats">
            <span className="stat-item">
              <span className="stat-label">Total Runs:</span>
              <span className="stat-value stat-mono">{testRuns.length}</span>
            </span>
            <span className="stat-item">
              <span className="stat-label">Passed:</span>
              <span className="stat-value stat-mono passed-count">{passedRuns}</span>
            </span>
            <span className="stat-item">
              <span className="stat-label">Failed:</span>
              <span className="stat-value stat-mono failed-count">{failedRuns}</span>
            </span>
            {unknownRuns > 0 && (
              <span className="stat-item">
                <span className="stat-label">Unknown:</span>
                <span className="stat-value stat-mono unknown-count">{unknownRuns}</span>
              </span>
            )}
            <span className="stat-item">
              <span className="stat-label">Pass Rate:</span>
              <span className="stat-value stat-mono">
                {testRuns.length > 0 ? ((passedRuns / testRuns.length) * 100).toFixed(1) : 0}%
              </span>
            </span>
          </div>
        </div>

        <div className="table-container">
          <table className="advanced-run-table">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className={header.column.getCanSort() ? 'sortable' : ''}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="header-content">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())
                        }
                        {header.column.getCanSort() && (
                          <span className="sort-indicator">
                            {{
                              asc: '↑',
                              desc: '↓',
                            }[header.column.getIsSorted() as string] ?? '⇅'}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr 
                  key={row.id} 
                  className={`table-row ${row.original.status === 'passed' ? 'passed-row' : row.original.status === 'failed' ? 'failed-row' : 'unknown-row'}`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}