import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './styles/common.css';

interface SearchInputProps {
    style?: React.CSSProperties;
    inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function SearchInput({ style, inputRef }: SearchInputProps): React.JSX.Element {
    const location = useLocation();
    const navigate = useNavigate();

    // Read initial value from URL params
    const getSearchParam = (): string => {
        const params = new URLSearchParams(location.search);
        return params.get('search') ?? '';
    };

    const [value, setValue] = useState<string>(getSearchParam());

    // Sync with URL when location changes
    useEffect(() => {
        setValue(getSearchParam());
    }, [location.search]);

    // Update URL when value changes
    const handleChange = (newValue: string) => {
        setValue(newValue);
        const params = new URLSearchParams(location.search);
        if (newValue) {
            params.set('search', newValue);
        } else {
            params.delete('search');
        }
        navigate(`${location.pathname}?${params.toString()}`, { replace: true });
    };

    // Initialize search param if it doesn't exist
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        if (!params.has('search')) {
            params.set('search', '');
            navigate(`${location.pathname}?${params.toString()}`, { replace: true });
        }
    }, []);

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
