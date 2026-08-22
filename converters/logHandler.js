/**
 * Log Handler
 * Records all user actions, conversions, downloads, and errors
 */

const path = require('path');
const fs = require('fs');

// In-memory log storage (also persisted to file)
let logs = [];
const MAX_LOGS = 500;

// Log file path
let logFilePath = null;

/**
 * Initialize the log handler
 * @param {string} userDataPath - Path to user data folder
 */
function initialize(userDataPath) {
    logFilePath = path.join(userDataPath, 'app-logs.json');
    loadLogs();
}

/**
 * Load logs from file
 */
function loadLogs() {
    try {
        if (logFilePath && fs.existsSync(logFilePath)) {
            const data = fs.readFileSync(logFilePath, 'utf-8');
            logs = JSON.parse(data);
        }
    } catch (err) {
        console.error('Failed to load logs:', err);
        logs = [];
    }
}

/**
 * Save logs to file
 */
function saveLogs() {
    try {
        if (logFilePath) {
            fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2));
        }
    } catch (err) {
        console.error('Failed to save logs:', err);
    }
}

/**
 * Add a log entry
 * @param {string} type - 'info', 'success', 'warning', 'error'
 * @param {string} category - 'audio', 'video', 'image', 'document', 'download', 'organizer', 'system'
 * @param {string} message - Log message
 * @param {object} details - Optional additional details
 */
function log(type, category, message, details = null) {
    const entry = {
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        type,
        category,
        message,
        details
    };

    logs.unshift(entry);

    // Trim to max size
    if (logs.length > MAX_LOGS) {
        logs = logs.slice(0, MAX_LOGS);
    }

    saveLogs();
    
    // Also log to console
    const prefix = `[${type.toUpperCase()}] [${category}]`;
    if (type === 'error') {
        console.error(prefix, message, details || '');
    } else if (type === 'warning') {
        console.warn(prefix, message, details || '');
    } else {
        console.log(prefix, message, details || '');
    }

    return entry;
}

/**
 * Log info message
 */
function info(category, message, details = null) {
    return log('info', category, message, details);
}

/**
 * Log success message
 */
function success(category, message, details = null) {
    return log('success', category, message, details);
}

/**
 * Log warning message
 */
function warning(category, message, details = null) {
    return log('warning', category, message, details);
}

/**
 * Log error message
 */
function error(category, message, details = null) {
    return log('error', category, message, details);
}

/**
 * Get all logs
 * @param {object} filter - Optional filter { type, category, limit }
 */
function getLogs(filter = {}) {
    let result = [...logs];

    if (filter.type) {
        result = result.filter(l => l.type === filter.type);
    }

    if (filter.category) {
        result = result.filter(l => l.category === filter.category);
    }

    if (filter.limit) {
        result = result.slice(0, filter.limit);
    }

    return result;
}

/**
 * Clear all logs
 */
function clearLogs() {
    logs = [];
    saveLogs();
}

/**
 * Export logs to file
 * @param {string} exportPath - Path to export file
 */
function exportLogs(exportPath) {
    try {
        const exportData = logs.map(l => {
            return `[${l.timestamp}] [${l.type.toUpperCase()}] [${l.category}] ${l.message}${l.details ? ' - ' + JSON.stringify(l.details) : ''}`;
        }).join('\n');
        
        fs.writeFileSync(exportPath, exportData, 'utf-8');
        return true;
    } catch (err) {
        console.error('Failed to export logs:', err);
        return false;
    }
}

module.exports = {
    initialize,
    log,
    info,
    success,
    warning,
    error,
    getLogs,
    clearLogs,
    exportLogs
};
