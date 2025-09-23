import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
export function AdvancedSearch({ query, onQueryChange, onToggleAdvanced }) {
    const addRule = () => {
        const newRule = {
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
    const removeRule = (ruleId) => {
        onQueryChange({
            ...query,
            rules: query.rules.filter(rule => rule.id !== ruleId),
        });
    };
    const updateRule = (ruleId, updates) => {
        onQueryChange({
            ...query,
            rules: query.rules.map(rule => rule.id === ruleId ? { ...rule, ...updates } : rule),
        });
    };
    const toggleCombinator = () => {
        onQueryChange({
            ...query,
            combinator: query.combinator === 'AND' ? 'OR' : 'AND',
        });
    };
    return (_jsxs("div", { className: "advanced-search-container", children: [_jsxs("div", { className: "search-header", children: [_jsx("h4", { children: "Advanced Search" }), _jsx("button", { type: "button", className: "toggle-search-button", onClick: onToggleAdvanced, title: "Switch to simple search", children: "Simple Search" })] }), _jsxs("div", { className: "query-builder-container", children: [_jsxs("div", { className: "combinator-section", children: [_jsx("label", { children: "Match: " }), _jsxs("button", { type: "button", className: `combinator-button ${query.combinator.toLowerCase()}`, onClick: toggleCombinator, title: "Click to toggle between AND/OR", children: [query.combinator === 'AND' ? 'ALL' : 'ANY', " of the following conditions"] })] }), _jsxs("div", { className: "rules-container", children: [query.rules.map((rule, index) => (_jsxs("div", { className: "search-rule", children: [_jsxs("div", { className: "rule-number", children: [index + 1, "."] }), _jsx("select", { value: rule.field, onChange: (e) => updateRule(rule.id, { field: e.target.value }), className: "field-select", children: fieldOptions.map(option => (_jsx("option", { value: option.value, children: option.label }, option.value))) }), _jsx("select", { value: rule.operator, onChange: (e) => updateRule(rule.id, { operator: e.target.value }), className: "operator-select", children: operatorOptions.map(option => (_jsx("option", { value: option.value, children: option.label }, option.value))) }), rule.field === 'severity' && (rule.operator === 'equals' || rule.operator === 'doesNotEqual') ? (_jsxs("select", { value: rule.value, onChange: (e) => updateRule(rule.id, { value: e.target.value }), className: "value-select", children: [_jsx("option", { value: "", children: "Select severity..." }), severityOptions.map(severity => (_jsx("option", { value: severity, children: severity }, severity)))] })) : (_jsx("input", { type: "text", value: rule.value, onChange: (e) => updateRule(rule.id, { value: e.target.value }), placeholder: "Enter value...", className: "value-input" })), _jsx("button", { type: "button", onClick: () => removeRule(rule.id), className: "remove-rule-button", title: "Remove this rule", children: "\u2715" })] }, rule.id))), _jsx("button", { type: "button", onClick: addRule, className: "add-rule-button", children: "+ Add Rule" })] })] })] }));
}
// Function to evaluate a query against a log entry
export function evaluateQuery(logEntry, query) {
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
    }
    else {
        return allResults.some(result => result);
    }
}
function evaluateRule(logEntry, rule) {
    if (!rule.field || !rule.operator || rule.value === undefined || rule.value === null || rule.value === '') {
        return true; // Invalid or empty rules match everything
    }
    // Get the actual value from the log entry
    let logValue;
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
            }
            catch (e) {
                // Invalid regex, return false
                return false;
            }
        default:
            return false;
    }
}
// Default query structure
export const defaultQuery = {
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
