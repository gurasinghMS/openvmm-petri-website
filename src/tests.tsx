import './styles/common.css';
import React, { useState, useEffect, useMemo } from 'react';
import { SortingState } from '@tanstack/react-table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchRunData, fetchTestAnalysis } from './fetch';
import { RunDetailsData, TestRunInfo, TestData } from './data_defs';
import { Menu } from './menu.tsx';
import { VirtualizedTable } from './virtualized_table.tsx';
import { Link, useSearchParams } from 'react-router-dom';
import { SearchInput } from './search';
import { createColumns, defaultSorting } from './table_defs/tests';

export function Tests(): React.JSX.Element {
    const [searchParams, setSearchParams] = useSearchParams();
    const branchFromUrl = searchParams.get('branchFilter') || 'main';
    const [branchFilter, setBranchFilterState] = useState<string>(branchFromUrl);
    const [searchFilter, setSearchFilter] = useState<string>('');
    const [runDetailsMap, setRunDetailsMap] = useState<Map<string, RunDetailsData>>(new Map());
    const [fetchedCount, setFetchedCount] = useState<number>(0);
    const [totalToFetch, setTotalToFetch] = useState<number>(0);
    const queryClient = useQueryClient();

    // Sync state with URL on mount and when URL changes
    useEffect(() => {
        setBranchFilterState(branchFromUrl);
    }, [branchFromUrl]);

    // Update both state and URL when branch filter changes
    const setBranchFilter = (branch: string) => {
        setBranchFilterState(branch);
        const newParams = new URLSearchParams(searchParams);
        newParams.set('branchFilter', branch);
        setSearchParams(newParams, { replace: true });
    };

    // Fetch the relevant data
    const { data: runs = [] } = useQuery({
        queryKey: ['runs'],
        queryFn: (context) => fetchRunData(context.client),
        staleTime: 2 * 60 * 1000, // refetch every 2 minutes
        gcTime: Infinity, // never garbage collect
        refetchInterval: 2 * 60 * 1000, // automatically refetch every 2 minutes
    });

    // Filter runs based on branch selection
    const filteredRuns = useMemo(() => {
        return runs.filter(run => run.metadata.ghBranch === branchFilter);
    }, [runs, branchFilter]);

    // Fetch run details for each filtered run
    useEffect(() => {
        const fetchAllRunDetails = async () => {
            setFetchedCount(0);
            setTotalToFetch(filteredRuns.length);

            // Fetch all run details using the centralized function
            const newRunDetailsMap = await fetchTestAnalysis(
                filteredRuns,
                queryClient,
                (fetched, _total) => {
                    setFetchedCount(fetched);
                }
            );

            setRunDetailsMap(newRunDetailsMap);
        };

        fetchAllRunDetails();
    }, [filteredRuns, queryClient]);

    // Create mapping of testName -> TestRunInfo[]
    const testMapping = useMemo(() => {
        const mapping = new Map<string, TestRunInfo[]>();

        runDetailsMap.forEach((runDetails) => {
            runDetails.tests.forEach(test => {
                const testName = test.name;
                const testRunInfo: TestRunInfo = {
                    runNumber: runDetails.runNumber,
                    status: test.status,
                };

                if (!mapping.has(testName)) {
                    mapping.set(testName, []);
                }
                mapping.get(testName)!.push(testRunInfo);
            });
        });

        return mapping;
    }, [runDetailsMap]);

    // Convert test mapping to table data
    const tableData = useMemo<TestData[]>(() => {
        const data: TestData[] = [];

        testMapping.forEach((runInfos, testName) => {
            const failedCount = runInfos.filter(info => info.status === 'failed').length;
            const split = testName.split('/');
            const totalCount = runInfos.length;

            data.push({
                architecture: split[0],
                name: split[1],
                failedCount,
                totalCount,
            });
        });

        return data;
    }, [testMapping]);

    // Get the table definition (columns and default sorting)
    const [sorting, setSorting] = useState<SortingState>(defaultSorting);
    const columns = useMemo(() => createColumns(), []);

    // For now, we'll use the number of unique tests as the result count
    const resultCount = testMapping.size;

    return (
        <div className="common-page-display">
            <div className="common-page-header">
                <TestsHeader
                    branchFilter={branchFilter}
                    setBranchFilter={setBranchFilter}
                    searchFilter={searchFilter}
                    setSearchFilter={setSearchFilter}
                    resultCount={resultCount}
                    fetchedCount={fetchedCount}
                    totalToFetch={totalToFetch}
                />
            </div>
            <VirtualizedTable
                data={tableData}
                columns={columns}
                sorting={sorting}
                columnWidthMap={{ architecture: 140, name: 600, failedCount: 80, totalCount: 80, status: 80 }}
                onSortingChange={setSorting}
            />
        </div>
    );
}

interface TestsHeaderProps {
    branchFilter: string;
    setBranchFilter: (branch: string) => void;
    searchFilter: string;
    setSearchFilter: (filter: string) => void;
    resultCount: number;
    fetchedCount: number;
    totalToFetch: number;
}

export function TestsHeader({
    branchFilter,
    setBranchFilter,
    searchFilter,
    setSearchFilter,
    resultCount,
    fetchedCount,
    totalToFetch,
}: TestsHeaderProps): React.JSX.Element {
    return (
        <>
            <div className="common-header-left">
                <div className="common-header-title">
                    <Menu />
                    <h3>
                        <Link to="/tests" className="common-header-path">Tests</Link>
                    </h3>
                </div>
                <div className="common-header-filter-buttons">
                    <button
                        className={`common-header-filter-btn ${branchFilter === 'main' ? 'active' : ''}`}
                        onClick={() => setBranchFilter('main')}
                    >
                        main
                    </button>
                </div>
                {fetchedCount != totalToFetch && (
                    <div className="header-loading-indicator">
                        <div className="header-loading-spinner"></div>
                        <div className="header-loading-text">
                            Analysed {fetchedCount}/{totalToFetch}
                        </div>
                    </div>
                )}
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
