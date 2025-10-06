import { ColumnDef } from '@tanstack/react-table';
import { TestData } from '../data_defs';
import '../styles/tests.css';
import '../styles/common.css';

export const defaultSorting = [
    { id: 'failedCount', desc: true }
];

export const columnWidthMap = {
    architecture: 200,
    failedCount: 80,
    totalCount: 80,
    status: 80
};

// Define the columns for the tests table
export const createColumns = (): ColumnDef<TestData>[] => {
    return [
        {
            id: 'architecture',
            accessorKey: 'architecture',
            header: 'Architecture',
            enableSorting: true,
            cell: (info) => (
                <div className="architecture-name" title={info.getValue() as string}>
                    {info.getValue() as string}
                </div>
            ),
            sortingFn: (rowA, rowB, columnId) => {
                const a = rowA.getValue(columnId) as string;
                const b = rowB.getValue(columnId) as string;
                return a.localeCompare(b);
            },
        },
        {
            accessorKey: 'name',
            header: 'Test Name',
            enableSorting: true,
            cell: (info) => {
                const name = info.getValue() as string;
                return (< div className="test-name" title={name} >
                    {name}
                </div >)

            },
            sortingFn: (rowA, rowB, columnId) => {
                const a = rowA.getValue(columnId) as string;
                const b = rowB.getValue(columnId) as string;
                return a.localeCompare(b);
            },
        },
        {
            accessorKey: 'failedCount',
            header: 'Failed',
            enableSorting: true,
            cell: (info) => (
                <div className="common-failed-count">{info.getValue<number>()}</div>
            ),
        },
        {
            accessorKey: 'totalCount',
            header: 'Total',
            enableSorting: true,
            cell: (info) => (
                <div className="common-total-count">{info.getValue<number>()}</div>
            ),
        },
        {
            id: 'status',
            header: 'Status',
            enableSorting: true,
            accessorFn: (row) => row.failedCount === 0 ? 'passed' : 'failed',
            cell: (info) => {
                const status = info.getValue<string>();
                return (
                    <div className="common-status-cell">
                        <div className={status === 'passed' ? 'common-status-pass' : 'common-status-fail'}>
                        </div>
                    </div>
                );
            },
        },
    ];
};
