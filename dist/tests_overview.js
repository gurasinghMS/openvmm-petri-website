import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useMemo } from 'react';
import { useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, flexRender, } from '@tanstack/react-table';
import './styles.css';
export function TestsOverview({ testStats, loading, error, processedRuns, totalRuns, loadAllRuns, searchFilter, architectureFilter, onTestClick }) {
    const [sorting, setSorting] = useState([
        { id: 'failed', desc: true } // Default sort by failed count descending
    ]);
    // Define columns for the tests table
    const columns = useMemo(() => [
        {
            id: 'architecture',
            header: 'Architecture',
            accessorFn: (row) => {
                const parts = row.testName.split('/');
                return parts[0] || '';
            },
            cell: info => _jsx("span", { className: "architecture-name", children: info.getValue() }),
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
                const testName = info.getValue();
                const fullTestName = info.row.original.testName;
                return onTestClick ? (_jsx("div", { className: "test-name-link", onClick: () => onTestClick(fullTestName), title: `View details for test: ${fullTestName}`, children: testName.toString() })) : (_jsx("span", { className: "test-name", children: testName }));
            },
            enableSorting: true,
        },
        {
            accessorKey: 'passed',
            header: 'Passed',
            cell: info => _jsx("span", { className: "passed-count", children: info.getValue() }),
            enableSorting: true,
        },
        {
            accessorKey: 'failed',
            header: 'Failed',
            cell: info => _jsx("span", { className: "failed-count", children: info.getValue() }),
            enableSorting: true,
        },
        {
            accessorKey: 'total',
            header: 'Total',
            cell: info => _jsx("span", { className: "total-count", children: info.getValue() }),
            enableSorting: true,
        },
        {
            accessorKey: 'passRate',
            header: 'Pass Rate',
            cell: info => {
                const rate = info.getValue();
                return (_jsxs("span", { className: `rate-badge rate-${Math.floor(rate / 10) * 10}`, children: [rate.toFixed(1), "%"] }));
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
        return (_jsxs("div", { className: "flake-loading", children: ["Loading ", loadAllRuns ? 'all' : 'recent', " test details... (", processedRuns, "/", totalRuns, " runs processed)", testStats.size > 0 && (_jsxs("div", { className: "flake-progress", children: ["Found ", testStats.size, " unique tests so far"] }))] }));
    }
    if (error) {
        return (_jsxs("div", { className: "flake-error", children: ["Error: ", error] }));
    }
    return (_jsx("div", { className: "table-container", children: _jsxs("table", { className: "advanced-run-table", children: [_jsx("thead", { children: table.getHeaderGroups().map((headerGroup) => (_jsx("tr", { children: headerGroup.headers.map((header) => (_jsx("th", { className: header.column.getCanSort() ? 'sortable' : '', onClick: header.column.getToggleSortingHandler(), children: _jsxs("div", { className: "header-content", children: [header.isPlaceholder
                                        ? null
                                        : flexRender(header.column.columnDef.header, header.getContext()), header.column.getCanSort() && (_jsx("span", { className: "sort-indicator", children: {
                                            asc: '↑',
                                            desc: '↓',
                                        }[header.column.getIsSorted()] ?? '⇅' }))] }) }, header.id))) }, headerGroup.id))) }), _jsx("tbody", { children: table.getRowModel().rows.map((row) => (_jsx("tr", { className: `table-row ${row.original.passRate < 100 ? 'failed-row' : 'passed-row'}`, children: row.getVisibleCells().map((cell) => (_jsx("td", { className: cell.column.id === 'passRate' ? 'pass-rate' : undefined, children: flexRender(cell.column.columnDef.cell, cell.getContext()) }, cell.id))) }, row.id))) })] }) }));
}
