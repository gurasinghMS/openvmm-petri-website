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
import { RunDetails, TestResult } from './fetch';
import { getRunDetails } from './dataStore';
import './styles.css';

interface RunDetailsProps {
  runId: string;
  searchFilter: string;
  onTestLogClick?: (testName: string, jobName: string) => void;
}

// Helper function to format date for display
function formatRunDate(date: Date | undefined): string {
  if (!date || isNaN(date.getTime())) return '';
  
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function RunDetailsView({ runId, searchFilter, onTestLogClick }: RunDetailsProps): React.JSX.Element {
  const [runDetails, setRunDetails] = useState<RunDetails | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'status', desc: false } // Sort by status ascending, failed tests first
  ]);

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
    if (!searchFilter) return runDetails.tests;
    
    return runDetails.tests.filter(test => 
      test.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      test.status.toLowerCase().includes(searchFilter.toLowerCase())
    );
  }, [runDetails?.tests, searchFilter]);

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
                        {header.column.getIsSorted() === 'asc' ? ' ↑' : 
                         header.column.getIsSorted() === 'desc' ? ' ↓' : ' ↕'}
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
            <tr key={row.id} className={`table-row ${row.original.status === 'failed' ? 'failed-row' : 'passed-row'}`}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {filteredTests.length === 0 && totalTests > 0 && (
        <div className="no-results">
          No tests match your search criteria.
        </div>
      )}
    </div>
  );
}