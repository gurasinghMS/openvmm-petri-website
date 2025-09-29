import React, { useState, useEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  ColumnDef,
  SortingState,
} from '@tanstack/react-table';
import { RunDetails, TestResult } from './fetch';
import { getRunDetails } from './dataStore';
import { Hamburger } from './hamburger';
import { VirtualizedTable } from './VirtualizedTable';
import { Link } from 'react-router-dom';
import './styles/common.css';
import './styles/runs.css';
import './styles/run_details.css'

interface RunDetailsProps {
  runId: string;
  searchFilter: string; // initial or controlled filter value
  setSearchFilter?: (val: string) => void; // optional external setter
  onTestLogClick?: (testName: string, jobName: string) => void;
}

interface RunDetailsHeaderProps {
  filter: string;
  setFilter: (val: string) => void;
  resultCount: number;
  totalCount: number;
  runId: string;
}

function RunDetailsHeader({ filter, setFilter, resultCount, totalCount, runId }: RunDetailsHeaderProps): React.JSX.Element {
  return (
    <>
      <div className="runs-header-left-section">
        <div className="runs-header-title-section" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Hamburger />
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <Link to="/runs" className="common-page-path" style={{ color: 'inherit' }}>Runs</Link>
            <span style={{ opacity: 0.65 }}>/</span>
            <Link to={`/runs/${runId}`} className="common-page-path" style={{ color: 'inherit' }}>{runId}</Link>
          </h3>
        </div>
      </div>
      <div className="runs-header-right-section">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search tests..."
          className="common-search-input"
        />
        <span className="results-count" title={`${resultCount} of ${totalCount} tests visible`}>
          {resultCount}/{totalCount} tests
        </span>
      </div>
    </>
  );
}

export function RunDetailsView({ runId, searchFilter, setSearchFilter, onTestLogClick }: RunDetailsProps): React.JSX.Element {
  const [runDetails, setRunDetails] = useState<RunDetails | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'status', desc: false } // Sort by status ascending, failed tests first
  ]);
  // Local filter state (falls back to external setter if provided)
  const [internalFilter, setInternalFilter] = useState<string>(searchFilter || '');

  useEffect(() => {
    // sync if parent changes
    setInternalFilter(searchFilter || '');
  }, [searchFilter]);

  useEffect(() => {
    const loadRunDetails = async () => {
      try {
        setLoading(true);
        setError(null);
        console.log(`🔍 Getting run details for run ID: ${runId}`);
        const details = await getRunDetails(runId);
        console.log(`✅ Successfully got run details:`, details);
        console.log(`📊 Total tests found: ${details.tests?.length || 0}`);
        console.log(`📋 Test results:`, details.tests);
        setRunDetails(details);
      } catch (err) {
        console.error(`❌ Error getting run details for ${runId}:`, err);
        setError(err instanceof Error ? err.message : 'Failed to fetch run details');
      } finally {
        setLoading(false);
      }
    };

    loadRunDetails();
  }, [runId]);

  // Define columns for the test results table
  const columns = useMemo<ColumnDef<TestResult>[]>(() => [
    {
      id: 'architecture',
      header: 'Architecture',
      accessorFn: (row) => {
        const parts = row.name.split('/');
        return parts.length > 1 ? parts[0] : 'Other';
      },
      cell: info => <span className="architecture-name">{info.getValue() as string}</span>,
      enableSorting: true,
    },
    {
      id: 'testName',
      header: 'Test Name',
      accessorFn: (row) => {
        const parts = row.name.split('/');
        return parts.length > 1 ? parts.slice(1).join('/') : row.name;
      },
      cell: info => {
        const testName = info.getValue() as string;
        const fullTestName = info.row.original.name;
        const jobName = fullTestName.split('/')[0]; // Extract job name from full test name

        return onTestLogClick ? (
          <button
            className="test-name-link"
            onClick={() => onTestLogClick(fullTestName, jobName)}
            title={`View logs for test: ${fullTestName}`}
          >
            {testName}
          </button>
        ) : (
          <span className="test-name">{testName}</span>
        );
      },
      enableSorting: true,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      enableSorting: true,
      cell: (info) => {
        const status = info.getValue<string>();
        return (
          <div className="status-cell">
            <span className={`status-dot ${status === 'passed' ? 'status-pass' : 'status-fail'}`}>
              ●
            </span>
          </div>
        );
      },
    },
  ], [onTestLogClick]);

  // Filter tests based on search term
  const filteredTests = useMemo(() => {
    if (!runDetails?.tests) return [];
    if (!internalFilter) return runDetails.tests;
    return runDetails.tests.filter(test =>
      test.name.toLowerCase().includes(internalFilter.toLowerCase()) ||
      test.status.toLowerCase().includes(internalFilter.toLowerCase())
    );
  }, [runDetails?.tests, internalFilter]);

  // Create the table
  const table = useReactTable({
    data: filteredTests,
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableSorting: true,
    enableSortingRemoval: false,
  });

  // Loading state
  if (loading) {
    return (
      <div className="loading-message">Loading run details...</div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="error-message">Error: {error}</div>
    );
  }

  const totalTests = runDetails?.tests?.length || 0;

  return (
    <div className="common-page-display">
      <div className="common-page-header">
        <RunDetailsHeader
          filter={internalFilter}
          setFilter={(val) => {
            setInternalFilter(val);
            setSearchFilter?.(val);
          }}
          resultCount={filteredTests.length}
          totalCount={totalTests}
          runId={runId}
        />
      </div>
      <VirtualizedTable<TestResult>
        table={table}
        columnWidthMap={{ architecture: 140, testName: 600, status: 80 }}
        estimatedRowHeight={44}
        getRowClassName={(row) => row.original.status === 'failed' ? 'failed-row' : 'passed-row'}
      />
      {filteredTests.length === 0 && totalTests > 0 && (
        <div className="no-results" style={{ padding: '1rem' }}>
          No tests match your search criteria.
        </div>
      )}
    </div>
  );
}