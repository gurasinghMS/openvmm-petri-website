import React, { useState } from 'react';

export interface LogEntry {
  timestamp: string;
  relative: string;
  severity: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
  source: string;
  message: string;
  attachment?: string;
  screenshot?: string;
}

export interface SearchRule {
  id: string;
  field: 'severity' | 'source' | 'message' | 'relative';
  operator: 'contains' | 'doesNotContain' | 'equals' | 'doesNotEqual' | 'beginsWith' | 'endsWith' | 'regex';
  value: string;
}

export interface SearchGroup {
  id: string;
  combinator: 'AND' | 'OR';
  rules: SearchRule[];
  groups: SearchGroup[];
}

export interface AdvancedSearchProps {
  query: SearchGroup;
  onQueryChange: (query: SearchGroup) => void;
  onToggleAdvanced: () => void;
}

const fieldOptions = [
  { value: 'severity', label: 'Severity' },
  { value: 'source', label: 'Source' },
  { value: 'message', label: 'Message' },
  { value: 'relative', label: 'Relative Time' },
];

const operatorOptions = [
  { value: 'contains', label: 'contains' },
  { value: 'doesNotContain', label: 'does not contain' },
  { value: 'equals', label: 'equals' },
  { value: 'doesNotEqual', label: 'does not equal' },
  { value: 'beginsWith', label: 'begins with' },
  { value: 'endsWith', label: 'ends with' },
  { value: 'regex', label: 'matches regex' },
];

const severityOptions = ['ERROR', 'WARN', 'INFO', 'DEBUG'];

export function AdvancedSearch({ query, onQueryChange, onToggleAdvanced }: AdvancedSearchProps) {
  const addRule = () => {
    const newRule: SearchRule = {
      id: `rule_${Date.now()}`,
      field: 'message',
      operator: 'contains',
      value: '',
    };
    
    onQueryChange({
      ...query,
      rules: [...query.rules, newRule],
    });
  };

  const removeRule = (ruleId: string) => {
    onQueryChange({
      ...query,
      rules: query.rules.filter(rule => rule.id !== ruleId),
    });
  };

  const updateRule = (ruleId: string, updates: Partial<SearchRule>) => {
    onQueryChange({
      ...query,
      rules: query.rules.map(rule => 
        rule.id === ruleId ? { ...rule, ...updates } : rule
      ),
    });
  };

  const toggleCombinator = () => {
    onQueryChange({
      ...query,
      combinator: query.combinator === 'AND' ? 'OR' : 'AND',
    });
  };

  return (
    <div className="advanced-search-container">
      <div className="search-header">
        <h4>Advanced Search</h4>
        <button
          type="button"
          className="toggle-search-button"
          onClick={onToggleAdvanced}
          title="Switch to simple search"
        >
          Simple Search
        </button>
      </div>
      
      <div className="query-builder-container">
        <div className="combinator-section">
          <label>Match: </label>
          <button
            type="button"
            className={`combinator-button ${query.combinator.toLowerCase()}`}
            onClick={toggleCombinator}
            title="Click to toggle between AND/OR"
          >
            {query.combinator === 'AND' ? 'ALL' : 'ANY'} of the following conditions
          </button>
        </div>

        <div className="rules-container">
          {query.rules.map((rule, index) => (
            <div key={rule.id} className="search-rule">
              <div className="rule-number">{index + 1}.</div>
              
              <select
                value={rule.field}
                onChange={(e) => updateRule(rule.id, { field: e.target.value as SearchRule['field'] })}
                className="field-select"
              >
                {fieldOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <select
                value={rule.operator}
                onChange={(e) => updateRule(rule.id, { operator: e.target.value as SearchRule['operator'] })}
                className="operator-select"
              >
                {operatorOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              {rule.field === 'severity' && (rule.operator === 'equals' || rule.operator === 'doesNotEqual') ? (
                <select
                  value={rule.value}
                  onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                  className="value-select"
                >
                  <option value="">Select severity...</option>
                  {severityOptions.map(severity => (
                    <option key={severity} value={severity}>
                      {severity}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={rule.value}
                  onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                  placeholder="Enter value..."
                  className="value-input"
                />
              )}

              <button
                type="button"
                onClick={() => removeRule(rule.id)}
                className="remove-rule-button"
                title="Remove this rule"
              >
                ✕
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={addRule}
            className="add-rule-button"
          >
            + Add Rule
          </button>
        </div>
      </div>
    </div>
  );
}

// Function to evaluate a query against a log entry
export function evaluateQuery(logEntry: LogEntry, query: SearchGroup): boolean {
  if (query.rules.length === 0 && query.groups.length === 0) {
    return true; // Empty query matches everything
  }

  const ruleResults = query.rules.map(rule => evaluateRule(logEntry, rule));
  const groupResults = query.groups.map(group => evaluateQuery(logEntry, group));
  
  const allResults = [...ruleResults, ...groupResults];
  
  if (allResults.length === 0) {
    return true;
  }

  if (query.combinator === 'AND') {
    return allResults.every(result => result);
  } else {
    return allResults.some(result => result);
  }
}

function evaluateRule(logEntry: LogEntry, rule: SearchRule): boolean {
  if (!rule.field || !rule.operator || rule.value === undefined || rule.value === null || rule.value === '') {
    return true; // Invalid or empty rules match everything
  }

  // Get the actual value from the log entry
  let logValue: string;
  switch (rule.field) {
    case 'severity':
      logValue = logEntry.severity;
      break;
    case 'source':
      logValue = logEntry.source;
      break;
    case 'message':
      logValue = logEntry.message;
      break;
    case 'relative':
      logValue = logEntry.relative;
      break;
    default:
      return false;
  }

  // Convert to strings and make case-insensitive for most comparisons
  const logValueLower = logValue.toLowerCase();
  const searchValueLower = String(rule.value).toLowerCase();

  // Apply the operator
  switch (rule.operator) {
    case 'contains':
      return logValueLower.includes(searchValueLower);
    
    case 'doesNotContain':
      return !logValueLower.includes(searchValueLower);
    
    case 'equals':
      return logValueLower === searchValueLower;
    
    case 'doesNotEqual':
      return logValueLower !== searchValueLower;
    
    case 'beginsWith':
      return logValueLower.startsWith(searchValueLower);
    
    case 'endsWith':
      return logValueLower.endsWith(searchValueLower);
    
    case 'regex':
      try {
        const regex = new RegExp(String(rule.value), 'i'); // Case-insensitive regex
        return regex.test(logValue);
      } catch (e) {
        // Invalid regex, return false
        return false;
      }
    
    default:
      return false;
  }
}

// Default query structure
export const defaultQuery: SearchGroup = {
  id: 'root',
  combinator: 'AND',
  rules: [
    {
      id: 'rule_default',
      field: 'message',
      operator: 'contains',
      value: '',
    },
  ],
  groups: [],
};