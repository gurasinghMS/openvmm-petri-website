import React, { useState, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  ColumnDef,
  flexRender,
  SortingState,
} from '@tanstack/react-table';
import { RunData } from './fetch';
import { TestStats } from './dataStore';
import './styles.css';

interface TestsOverviewProps {
  runs: RunData[];
  testStats: Map<string, TestStats>;
  loading: boolean;
  error: string | null;
  processedRuns: number;
  totalRuns: number;
  loadAllRuns: boolean;
  onLoadAll: () => void;
  searchFilter: string;
  architectureFilter: string;
  onTestClick?: (testName: string) => void;
}

export function TestsOverview({ 
  testStats, 
  loading, 
  error, 
  processedRuns, 
  totalRuns, 
  loadAllRuns, 
  searchFilter,
  architectureFilter,
  onTestClick
}: TestsOverviewProps): React.JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'failed', desc: true } // Default sort by failed count descending
  ]);

  // Define columns for the tests table
  const columns = useMemo<ColumnDef<TestStats>[]>(() => [
    {
      id: 'architecture',
      header: 'Architecture',
      accessorFn: (row) => {
        const parts = row.testName.split('/');
        return parts[0] || '';
      },
      cell: info => <span className="architecture-name">{info.getValue() as string}</span>,
      enableSorting: true,
    },
    {
      id: 'testName',
      header: 'Name',
      accessorFn: (row) => {
        const parts = row.testName.split('/');
        return parts[1] || '';
      },
      cell: info => {
        const testName = info.getValue() as string;
        const fullTestName = info.row.original.testName;
        return onTestClick ? (
          <div 
            className="test-name-link"
            onClick={() => onTestClick(fullTestName)}
            title={`View details for test: ${fullTestName}`}
          >
            {testName.toString()}
          </div>
        ) : (
          <span className="test-name">{testName}</span>
        );
      },
      enableSorting: true,
    },
    {
      accessorKey: 'passed',
      header: 'Passed',
      cell: info => <span className="passed-count">{info.getValue() as number}</span>,
      enableSorting: true,
    },
    {
      accessorKey: 'failed',
      header: 'Failed',
      cell: info => <span className="failed-count">{info.getValue() as number}</span>,
      enableSorting: true,
    },
    {
      accessorKey: 'total',
      header: 'Total',
      cell: info => <span className="total-count">{info.getValue() as number}</span>,
      enableSorting: true,
    },
    {
      accessorKey: 'passRate',
      header: 'Pass Rate',
      cell: info => {
        const rate = info.getValue() as number;
        return (
          <span className={`rate-badge rate-${Math.floor(rate / 10) * 10}`}>
            {rate.toFixed(1)}%
          </span>
        );
      },
      enableSorting: true,
    },
  ], []);

  // Convert testStats Map to array for the table
  const allTests = useMemo(() => Array.from(testStats.values()), [testStats]);

  // Filter tests by architecture
  const filteredTests = useMemo(() => {
    if (architectureFilter === 'all') {
      return allTests;
    }
    return allTests.filter(test => {
      const architecture = test.testName.split('/')[0];
      return architecture === architectureFilter;
    });
  }, [allTests, architectureFilter]);

  // Create the table instance
  const table = useReactTable({
    data: filteredTests,
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
    return (
      <div className="flake-loading">
        Loading {loadAllRuns ? 'all' : 'recent'} test details... ({processedRuns}/{totalRuns} runs processed)
        {testStats.size > 0 && (
          <div className="flake-progress">
            Found {testStats.size} unique tests so far
          </div>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flake-error">Error: {error}</div>
    );
  }

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
              className={`table-row ${row.original.passRate < 100 ? 'failed-row' : 'passed-row'}`}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className={cell.column.id === 'passRate' ? 'pass-rate' : undefined}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}