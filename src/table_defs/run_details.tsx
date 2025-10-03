import { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { TestResult } from '../data_defs';
import '../styles/run_details.css';

export const defaultSorting = [
    { id: 'status', desc: false } // Sort by status ascending, failed tests first
];

// Define columns for the test results table
export const createColumns = (runId: string): ColumnDef<TestResult>[] => [
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
            const testName = info.getValue() as string; // portion after first '/'
            const fullTestName = info.row.original.name; // architecture/testName...
            const [architecturePart, ...restParts] = fullTestName.split('/');
            const encodedArchitecture = encodeURIComponent(architecturePart);
            const encodedRemainder = encodeURIComponent(restParts.join('/'));
            return (
                <Link
                    to={`/runs/${runId}/${encodedArchitecture}/${encodedRemainder}`}
                    state={{ testResult: info.row.original }}
                    className="run-name-link"
                    title={`View inspect for test: ${fullTestName}`}
                >
                    {testName}
                </Link>
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
                <div className="common-status-cell">
                    <span className={status === 'passed' ? 'common-status-pass' : 'common-status-fail'}>
                    </span>
                </div>
            );
        },
    },
];
