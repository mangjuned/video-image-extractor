const { spawn } = require('child_process');

/**
 * Check if ffmpeg is installed and available
 */
async function checkFfmpeg() {
    return new Promise((resolve) => {
        const ffmpeg = spawn('ffmpeg', ['-version'], {
            stdio: 'pipe'
        });

        ffmpeg.on('close', (code) => {
            resolve(code === 0);
        });

        ffmpeg.on('error', () => {
            resolve(false);
        });
    });
}

/**
 * Get video duration using ffprobe
 */
async function getVideoDuration(videoPath) {
    return new Promise((resolve) => {
        const ffprobe = spawn('ffprobe', [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'csv=p=0',
            videoPath
        ], {
            stdio: 'pipe'
        });

        let output = '';

        ffprobe.stdout.on('data', (data) => {
            output += data.toString();
        });

        ffprobe.on('close', (code) => {
            if (code === 0 && output.trim()) {
                resolve(parseFloat(output.trim()));
            } else {
                resolve(null);
            }
        });

        ffprobe.on('error', () => {
            resolve(null);
        });
    });
}

/**
 * Format duration in seconds to HH:MM:SS
 */
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts = [];
    if (hours > 0) {
        parts.push(hours.toString().padStart(2, '0'));
    }
    parts.push(minutes.toString().padStart(2, '0'));
    parts.push(secs.toString().padStart(2, '0'));

    return parts.join(':');
}

/**
 * Sanitize filename for use as directory name
 * Handles URL-encoded filenames, brackets, and other special characters
 */
function sanitizeFilename(filename) {
    let sanitized = filename;

    // First, try to URL-decode if it looks URL-encoded
    try {
        if (sanitized.includes('%')) {
            sanitized = decodeURIComponent(sanitized);
        }
    } catch (e) {
        // If decoding fails, continue with original
    }

    return sanitized
        .replace(/[\[\]]/g, '')              // Remove brackets completely
        .replace(/[<>:"/\\|?*]/g, '_')       // Replace invalid characters
        .replace(/[()]/g, '')                // Remove parentheses
        .replace(/[&'`~!@#$%^+={}]/g, '')    // Remove other special characters
        .replace(/\s+/g, '_')                // Replace spaces with underscores
        .replace(/\.+/g, '_')                // Replace dots with underscores (except extension)
        .replace(/-+/g, '-')                 // Replace multiple dashes with single
        .replace(/_{2,}/g, '_')              // Replace multiple underscores with single
        .replace(/_-|-_/g, '-')              // Clean up underscore-dash combinations
        .replace(/^[-_]+|[-_]+$/g, '')       // Remove leading/trailing underscores and dashes
        .substring(0, 100);                   // Limit length to avoid path too long errors
}

module.exports = {
    checkFfmpeg,
    getVideoDuration,
    formatDuration,
    sanitizeFilename
};
