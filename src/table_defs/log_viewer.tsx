import { ColumnDef } from '@tanstack/react-table';
import { ProcessedLogEntry } from '../fetch';

interface LogEntry extends ProcessedLogEntry { }

export function createColumns(
    setModalContent: (content: { type: 'image' | 'text' | 'iframe', content: string } | null) => void
): ColumnDef<LogEntry>[] {
    return [
        {
            accessorKey: 'relative',
            header: 'Timestamp',
            cell: (info) => (
                <span title={info.row.original.timestamp}>
                    {info.getValue() as string}
                </span>
            ),
            enableSorting: true,
        },
        {
            accessorKey: 'severity',
            header: 'Severity',
            enableSorting: false,
        },
        {
            accessorKey: 'source',
            header: 'Source',
            enableSorting: false,
        },
        {
            id: 'message',
            accessorFn: (row) => row.messageText, // Use text for sorting/filtering
            header: 'Message',
            cell: (info) => (
                <div dangerouslySetInnerHTML={{ __html: info.row.original.messageHtml }} />
            ),
            enableSorting: false, // Disable sorting for complex HTML content
        },
        {
            id: 'screenshot',
            header: 'Screenshot',
            cell: (info) => {
                const screenshot = info.row.original.screenshot;
                return screenshot ? (
                    <img
                        src={screenshot}
                        alt="Screenshot"
                        style={{
                            maxWidth: '100px',
                            maxHeight: '50px',
                            cursor: 'pointer',
                            objectFit: 'contain'
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            setModalContent({ type: 'image', content: screenshot });
                        }}
                    />
                ) : '';
            },
            enableSorting: false,
        }
    ];
}
