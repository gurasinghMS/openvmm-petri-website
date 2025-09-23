import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useMemo } from 'react';
import { useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, flexRender, } from '@tanstack/react-table';
import { getRunDetails } from './dataStore';
import './styles.css';
export function RunDetailsView({ runId, searchFilter, onTestLogClick }) {
    const [runDetails, setRunDetails] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [sorting, setSorting] = useState([
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
            }
            catch (err) {
                console.error(`❌ Error getting run details for ${runId}:`, err);
                setError(err instanceof Error ? err.message : 'Failed to fetch run details');
            }
            finally {
                setLoading(false);
            }
        };
        loadRunDetails();
    }, [runId]);
    // Define columns for the test results table
    const columns = useMemo(() => [
        {
            id: 'architecture',
            header: 'Architecture',
            accessorFn: (row) => {
                const parts = row.name.split('/');
                return parts.length > 1 ? parts[0] : 'Other';
            },
            cell: info => _jsx("span", { className: "architecture-name", children: info.getValue() }),
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
                const testName = info.getValue();
                const fullTestName = info.row.original.name;
                const jobName = fullTestName.split('/')[0]; // Extract job name from full test name
                return onTestLogClick ? (_jsx("button", { className: "test-name-link", onClick: () => onTestLogClick(fullTestName, jobName), title: `View logs for test: ${fullTestName}`, children: testName })) : (_jsx("span", { className: "test-name", children: testName }));
            },
            enableSorting: true,
        },
        {
            accessorKey: 'status',
            header: 'Status',
            enableSorting: true,
            cell: (info) => {
                const status = info.getValue();
                return (_jsx("div", { className: "status-cell", children: _jsx("span", { className: `status-dot ${status === 'passed' ? 'status-pass' : 'status-fail'}`, children: "\u25CF" }) }));
            },
        },
    ], [onTestLogClick]);
    // Filter tests based on search term
    const filteredTests = useMemo(() => {
        if (!runDetails?.tests)
            return [];
        if (!searchFilter)
            return runDetails.tests;
        return runDetails.tests.filter(test => test.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
            test.status.toLowerCase().includes(searchFilter.toLowerCase()));
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
        return (_jsx("div", { className: "loading-message", children: "Loading run details..." }));
    }
    // Error state
    if (error) {
        return (_jsxs("div", { className: "error-message", children: ["Error: ", error] }));
    }
    const totalTests = runDetails?.tests?.length || 0;
    return (_jsxs("div", { className: "table-container", children: [_jsxs("table", { className: "advanced-run-table", children: [_jsx("thead", { children: table.getHeaderGroups().map((headerGroup) => (_jsx("tr", { children: headerGroup.headers.map((header) => (_jsx("th", { className: header.column.getCanSort() ? 'sortable' : '', onClick: header.column.getToggleSortingHandler(), children: _jsxs("div", { className: "header-content", children: [header.isPlaceholder
                                            ? null
                                            : flexRender(header.column.columnDef.header, header.getContext()), header.column.getCanSort() && (_jsx("span", { className: "sort-indicator", children: header.column.getIsSorted() === 'asc' ? ' ↑' :
                                                header.column.getIsSorted() === 'desc' ? ' ↓' : ' ↕' }))] }) }, header.id))) }, headerGroup.id))) }), _jsx("tbody", { children: table.getRowModel().rows.map((row) => (_jsx("tr", { className: `table-row ${row.original.status === 'failed' ? 'failed-row' : 'passed-row'}`, children: row.getVisibleCells().map((cell) => (_jsx("td", { children: flexRender(cell.column.columnDef.cell, cell.getContext()) }, cell.id))) }, row.id))) })] }), filteredTests.length === 0 && totalTests > 0 && (_jsx("div", { className: "no-results", children: "No tests match your search criteria." }))] }));
}
