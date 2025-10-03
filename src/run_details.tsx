import './styles/common.css';
import React, { useState, useEffect, useMemo } from 'react';
import { SortingState } from '@tanstack/react-table';
import { RunDetailsData, TestResult } from './data_defs';
import { Menu } from './menu';
import { VirtualizedTable } from './virtualized_table';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { fetchRunDetails } from './fetch';
import { SearchInput } from './search';
import { createColumns, defaultSorting } from './table_defs/run_details';

interface RunDetailsProps {
  runId: string;
}

export function RunDetails({ runId }: RunDetailsProps): React.JSX.Element {
  const [runDetails, setRunDetails] = useState<RunDetailsData | null>(null);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [sorting, setSorting] = useState<SortingState>(defaultSorting);

  const queryClient = useQueryClient();
  useEffect(() => {
    queryClient
      .fetchQuery({
        queryKey: ['runDetails', runId],
        queryFn: () => fetchRunDetails(runId, queryClient),
        staleTime: Infinity, // never goes stale because this data should never change
        gcTime: 20 * 60 * 1000, // still garbage collect after 20 minutes unused
      })
      .then(setRunDetails);
  }, [queryClient, runId]);

  // Define columns for the test results table
  const columns = useMemo(() => createColumns(runId), [runId]);

  // Conditional AND wildcard search
  const filteredTests = useMemo(() => filterTests(runDetails?.tests, searchFilter), [runDetails?.tests, searchFilter]);

  return (
    <div className="common-page-display">
      <div className="common-page-header">
        <RunDetailsHeader
          resultCount={filteredTests.length}
          runId={runId}
          searchFilter={searchFilter}
          setSearchFilter={setSearchFilter}
        />
      </div>
      <VirtualizedTable<TestResult>
        data={filteredTests}
        columns={columns}
        sorting={sorting}
        onSortingChange={setSorting}
        columnWidthMap={{ architecture: 140, testName: 600, status: 80 }}
        estimatedRowHeight={44}
        getRowClassName={(row) => row.original.status === 'failed' ? 'failed-row' : 'passed-row'}
      />
    </div>
  );
}

interface RunDetailsHeaderProps {
  resultCount: number;
  runId: string;
  searchFilter: string;
  setSearchFilter: (filter: string) => void;
}

function RunDetailsHeader({ resultCount, runId, searchFilter, setSearchFilter }: RunDetailsHeaderProps): React.JSX.Element {
  return (
    <>
      <div className="common-header-left">
        <div className="common-header-title">
          <Menu />
          <h3>
            <Link to="/runs" className="common-header-path">Runs</Link>
            <span>/</span>
            <Link to={`/runs/${runId}`} className="common-header-path">{runId}</Link>
          </h3>
        </div>
      </div>
      <div className="common-header-right">
        <SearchInput value={searchFilter} onChange={setSearchFilter} />
        <span className="common-result-count">
          {resultCount} tests
        </span>
      </div>
    </>
  );
}

/**
 * filterTests filters the list of tests based on search terms.
 * 
 * - Search string is split into terms (by whitespace), and each test is checked
 *   to see if ALL terms are present.
 * - The searchable fields include: test name and status.
 * - The filtering is case-insensitive.
 */
function filterTests(tests: TestResult[] | undefined, searchFilter: string): TestResult[] {
  if (!tests) return [];
  const terms = searchFilter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return tests;
  return tests.filter(test => {
    // Search in name and status fields
    const haystack = `${test.name} ${test.status}`.toLowerCase();
    return terms.every(term => haystack.includes(term));
  });
}