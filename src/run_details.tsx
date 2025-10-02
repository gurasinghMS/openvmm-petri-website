import React, { useState, useEffect, useMemo } from 'react';
import {
  SortingState,
} from '@tanstack/react-table';
import { RunDetails, TestResult } from './fetch';
import { Menu } from './menu';
import { VirtualizedTable } from './virtualized_table';
import { Link } from 'react-router-dom';
import './styles/common.css';
import './styles/runs.css';
import './styles/run_details.css'
import { useQueryClient } from '@tanstack/react-query';
import { fetchRunDetails } from './fetch';
import { SearchInput } from './search';
import { createColumns } from './table_defs/run_details';

interface RunDetailsProps {
  runId: string;
}

interface RunDetailsHeaderProps {
  resultCount: number;
  totalCount: number;
  runId: string;
  searchFilter: string;
  setSearchFilter: (filter: string) => void;
}

function RunDetailsHeader({ resultCount, totalCount, runId, searchFilter, setSearchFilter }: RunDetailsHeaderProps): React.JSX.Element {
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
      <div className="runs-header-right-section">
        <SearchInput value={searchFilter} onChange={setSearchFilter} />
        <span className="common-result-count">
          {resultCount} tests
        </span>
      </div>
    </>
  );
}

export function RunDetailsView({ runId }: RunDetailsProps): React.JSX.Element {
  const [runDetails, setRunDetails] = useState<RunDetails | null>(null);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'status', desc: false } // Sort by status ascending, failed tests first
  ]);

  const queryClient = useQueryClient();

  useEffect(() => {
    queryClient
      .fetchQuery({
        queryKey: ['runDetails', runId],
        // Pass queryClient down so petri.jsonl / petri.passed files discovered during listing get prefetched & cached
        queryFn: () => fetchRunDetails(runId, queryClient),
        staleTime: Infinity, // never goes stale
        gcTime: 15 * 60 * 1000, // still garbage collect after 15 minutes unused
      })
      .then(setRunDetails);
  }, [queryClient, runId]);

  // Define columns for the test results table
  const columns = useMemo(() => createColumns(runId), [runId]);

  // Conditional AND wildcard search
  const filteredTests = useMemo(() => {
    if (!runDetails?.tests) return [];
    const terms = searchFilter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return runDetails.tests;
    return runDetails.tests.filter(test => {
      // Search in name and status fields
      const haystack = `${test.name} ${test.status}`.toLowerCase();
      return terms.every(term => haystack.includes(term));
    });
  }, [runDetails?.tests, searchFilter]);

  const totalTests = runDetails?.tests?.length || 0;

  return (
    <div className="common-page-display">
      <div className="common-page-header">
        <RunDetailsHeader
          resultCount={filteredTests.length}
          totalCount={totalTests}
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