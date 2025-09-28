"use strict";

const { safeRequire } = require('../../lib/safeRequire');

const sharp = safeRequire('sharp');

const DEFAULT_OPTIONS = {
    maxDimension: 256,
    outputFormat: 'webp',
    quality: 80,
};

async function processAvatar(buffer, options = {}) {
    if (!buffer || !(buffer instanceof Buffer)) {
        throw new Error('Avatar payload must be a buffer.');
    }

    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

    if (sharp) {
        const instance = sharp(buffer, { failOn: 'truncated' });
        const metadata = await instance.metadata();

        if (!metadata || !metadata.width || !metadata.height) {
            throw new Error('Unable to read avatar metadata.');
        }

        if (metadata.width > 4096 || metadata.height > 4096) {
            throw new Error('Avatar dimensions exceed maximum size.');
        }

        const supportedFormats = new Set(['jpeg', 'png', 'webp', 'gif']);
        if (!metadata.format || !supportedFormats.has(metadata.format)) {
            throw new Error('Unsupported avatar format.');
        }

        const transformer = sharp(buffer, { failOn: 'truncated' })
            .resize(mergedOptions.maxDimension, mergedOptions.maxDimension, {
                fit: 'cover',
                position: 'attention',
            })
            .removeAlpha()
            .withMetadata({ exif: undefined, orientation: undefined });

        if (mergedOptions.outputFormat === 'png') {
            transformer.png({ compressionLevel: 9 });
        } else {
            transformer.webp({ quality: mergedOptions.quality, smartSubsample: true });
        }

        const processed = await transformer.toBuffer({ resolveWithObject: true });

        return {
            buffer: processed.data,
            format: mergedOptions.outputFormat === 'png' ? 'png' : 'webp',
            extension: mergedOptions.outputFormat === 'png' ? '.png' : '.webp',
            width: metadata.width,
            height: metadata.height,
            outputWidth: processed.info.width,
            outputHeight: processed.info.height,
        };
    }

    const fallbackMetadata = inspectImage(buffer);
    if (!fallbackMetadata) {
        throw new Error('Unable to process avatar image without sharp.');
    }

    const outputWidth = Math.min(mergedOptions.maxDimension, fallbackMetadata.width);
    const outputHeight = Math.min(mergedOptions.maxDimension, fallbackMetadata.height);

    return {
        buffer,
        format: mergedOptions.outputFormat === 'png' ? 'png' : 'webp',
        extension: mergedOptions.outputFormat === 'png' ? '.png' : '.webp',
        width: fallbackMetadata.width,
        height: fallbackMetadata.height,
        outputWidth,
        outputHeight,
    };
}

function inspectImage(buffer) {
    if (!buffer || buffer.length < 10) {
        return null;
    }

    if (isPng(buffer)) {
        return readPng(buffer);
    }
    if (isJpeg(buffer)) {
        return readJpeg(buffer);
    }
    if (isGif(buffer)) {
        return readGif(buffer);
    }
    if (isWebp(buffer)) {
        return readWebp(buffer);
    }
    return null;
}

function isPng(buffer) {
    return buffer.length >= 24 && buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG';
}

function readPng(buffer) {
    return {
        format: 'png',
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
    };
}

function isJpeg(buffer) {
    return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
}

function readJpeg(buffer) {
    let offset = 2;
    while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) {
            break;
        }
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xc3) {
            const height = buffer.readUInt16BE(offset + 5);
            const width = buffer.readUInt16BE(offset + 7);
            return { format: 'jpeg', width, height };
        }
        offset += 2 + length;
    }
    return null;
}

function isGif(buffer) {
    return buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'GIF';
}

function readGif(buffer) {
    return {
        format: 'gif',
        width: buffer.readUInt16LE(6),
        height: buffer.readUInt16LE(8),
    };
}

function isWebp(buffer) {
    return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
}

function readWebp(buffer) {
    let offset = 12;
    while (offset + 8 <= buffer.length) {
        const chunkType = buffer.toString('ascii', offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);
        if (chunkType === 'VP8X' && offset + 14 <= buffer.length) {
            const widthMinusOne = buffer.readUInt24LE(offset + 8);
            const heightMinusOne = buffer.readUInt24LE(offset + 11);
            return { format: 'webp', width: widthMinusOne + 1, height: heightMinusOne + 1 };
        }
        if (chunkType === 'VP8 ' && offset + 10 <= buffer.length) {
            const start = offset + 10;
            if (start + 9 <= buffer.length) {
                const width = buffer.readUInt16LE(start + 6) & 0x3fff;
                const height = buffer.readUInt16LE(start + 8) & 0x3fff;
                return { format: 'webp', width, height };
            }
        }
        if (chunkType === 'VP8L' && offset + 10 <= buffer.length) {
            const b0 = buffer[offset + 8];
            const b1 = buffer[offset + 9];
            const b2 = buffer[offset + 10];
            const b3 = buffer[offset + 11];
            const width = 1 + (((b1 & 0x3f) << 8) | b0);
            const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
            return { format: 'webp', width, height };
        }
        offset += 8 + chunkSize + (chunkSize % 2);
    }
    return null;
}

if (!Buffer.prototype.readUInt24LE) {
    Buffer.prototype.readUInt24LE = function readUInt24LE(offset) {
        return this[offset] | (this[offset + 1] << 8) | (this[offset + 2] << 16);
    };
}

module.exports = {
    processAvatar,
};
