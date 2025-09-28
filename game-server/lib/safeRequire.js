"use strict";

function safeRequire(moduleName) {
    try {
        return require(moduleName);
    } catch (error) {
        return null;
    }
}

module.exports = {
    safeRequire,
};
