import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './styles/common.css';

interface SearchInputProps {
    value: string;
    onChange: (value: string) => void;
    style?: React.CSSProperties;
    inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function SearchInput({ value, onChange, style, inputRef }: SearchInputProps): React.JSX.Element {
    const location = useLocation();
    const navigate = useNavigate();
    const isInitialMount = useRef(true);

    // On mount: read search parameter from URL and update caller's filter
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const searchParam = params.get('search');
        if (searchParam !== null && searchParam !== value) {
            onChange(searchParam);
        }
        isInitialMount.current = false;
    }, []); // Only run on mount

    // When value changes (after initial mount), update the URL
    useEffect(() => {
        if (isInitialMount.current) return; // Skip on initial mount

        const params = new URLSearchParams(location.search);
        if (value) {
            params.set('search', value);
        } else {
            params.delete('search');
        }

        const newSearch = params.toString();
        const newPath = newSearch ? `${location.pathname}?${newSearch}` : location.pathname;

        // Only navigate if the URL actually changed
        if (location.pathname + location.search !== newPath) {
            navigate(newPath, { replace: true });
        }
    }, [value, location.pathname, navigate, location.search]);

    const handleChange = (newValue: string) => {
        onChange(newValue);
    };

    return (
        <div style={{ position: 'relative', display: 'inline-block' }}>
            <input
                ref={inputRef}
                value={value}
                onChange={(e) => handleChange(e.target.value)}
                placeholder="Filter ..."
                className="common-search-input"
                style={{ paddingRight: '28px', ...style }}
            />
            {value && (
                <button
                    onClick={() => handleChange('')}
                    style={{
                        position: 'absolute',
                        right: '6px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        fontSize: '16px',
                        color: '#888',
                        cursor: 'pointer',
                        padding: 0,
                        lineHeight: 1
                    }}
                    title="Clear filter"
                >
                    ×
                </button>
            )}
        </div>
    );
}
