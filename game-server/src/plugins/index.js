'use strict';

const path = require('path');

function getPluginDirectory() {
    return path.join(__dirname);
}

module.exports = {
    getPluginDirectory,
};
