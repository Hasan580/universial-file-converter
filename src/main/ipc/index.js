'use strict';

/** Registers every IPC channel. Domain modules load their heavy engines lazily, on first use. */
function registerAll() {
    require('./app').register();
    require('./convert').register();
    require('./download').register();
    require('./library').register();
    require('./extras').register();
}

module.exports = { registerAll };
