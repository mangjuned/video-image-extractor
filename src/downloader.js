const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const chalk = require('chalk');
const ora = require('ora');
const { sanitizeFilename } = require('./utils');

/**
 * Check if yt-dlp is installed
 */
async function checkYtDlp() {
    return new Promise((resolve) => {
        const ytdlp = spawn('yt-dlp', ['--version'], { stdio: 'pipe' });
        ytdlp.on('close', (code) => resolve(code === 0));
        ytdlp.on('error', () => resolve(false));
    });
}

/**
 * Check if URL is a direct video file
 */
function isDirectVideoUrl(url) {
    const videoExtensions = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpeg', '.mpg'];
    const urlLower = url.toLowerCase();
    return videoExtensions.some(ext => urlLower.includes(ext));
}

/**
 * Extract filename from URL
 */
function getFilenameFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const filename = path.basename(pathname);

        // Remove query parameters from filename
        const cleanFilename = filename.split('?')[0];

        if (cleanFilename && cleanFilename.includes('.')) {
            return sanitizeFilename(path.basename(cleanFilename, path.extname(cleanFilename)));
        }

        // Generate filename from URL hash
        const hash = url.split('').reduce((a, b) => {
            a = ((a << 5) - a) + b.charCodeAt(0);
            return a & a;
        }, 0);
        return `video_${Math.abs(hash)}`;
    } catch {
        return `video_${Date.now()}`;
    }
}

/**
 * Download a file using HTTP/HTTPS
 */
async function downloadDirect(url, outputPath, verbose) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;

        const file = fs.createWriteStream(outputPath);

        const request = protocol.get(url, (response) => {
            // Handle redirects
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                file.close();
                fs.unlinkSync(outputPath);
                return downloadDirect(response.headers.location, outputPath, verbose)
                    .then(resolve)
                    .catch(reject);
            }

            if (response.statusCode !== 200) {
                file.close();
                fs.unlinkSync(outputPath);
                reject(new Error(`HTTP ${response.statusCode}: Failed to download`));
                return;
            }

            const totalSize = parseInt(response.headers['content-length'], 10);
            let downloadedSize = 0;

            response.on('data', (chunk) => {
                downloadedSize += chunk.length;
                if (verbose && totalSize) {
                    const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
                    process.stdout.write(`\r   Downloading: ${percent}%`);
                }
            });

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                if (verbose) process.stdout.write('\n');
                resolve(outputPath);
            });
        });

        request.on('error', (err) => {
            file.close();
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }
            reject(err);
        });

        request.setTimeout(60000, () => {
            request.destroy();
            reject(new Error('Download timeout'));
        });
    });
}

/**
 * Download using yt-dlp (for YouTube, etc.)
 */
async function downloadWithYtDlp(url, outputPath, verbose) {
    return new Promise((resolve, reject) => {
        const args = [
            '-f', 'best[ext=mp4]/best',  // Prefer mp4 format
            '-o', outputPath,
            '--no-playlist',  // Don't download playlists
            '--no-warnings',
            url
        ];

        if (verbose) {
            console.log(chalk.gray(`   yt-dlp ${args.join(' ')}`));
        }

        const ytdlp = spawn('yt-dlp', args, {
            stdio: verbose ? 'inherit' : 'pipe'
        });

        let stderr = '';

        if (!verbose && ytdlp.stderr) {
            ytdlp.stderr.on('data', (data) => {
                stderr += data.toString();
            });
        }

        ytdlp.on('close', (code) => {
            if (code === 0) {
                // yt-dlp might add extension, find the actual file
                const dir = path.dirname(outputPath);
                const baseName = path.basename(outputPath, path.extname(outputPath));
                const files = fs.readdirSync(dir);
                const downloadedFile = files.find(f => f.startsWith(baseName));

                if (downloadedFile) {
                    resolve(path.join(dir, downloadedFile));
                } else {
                    resolve(outputPath);
                }
            } else {
                reject(new Error(`yt-dlp failed: ${stderr || 'Unknown error'}`));
            }
        });

        ytdlp.on('error', (err) => {
            reject(new Error(`Failed to run yt-dlp: ${err.message}`));
        });
    });
}

/**
 * Download a single video from URL
 */
async function downloadVideo(url, downloadDir, verbose) {
    const filename = getFilenameFromUrl(url);
    const outputPath = path.join(downloadDir, `${filename}.mp4`);

    // Skip if already downloaded
    if (fs.existsSync(outputPath)) {
        return { path: outputPath, name: filename, cached: true };
    }

    const isDirect = isDirectVideoUrl(url);

    if (isDirect) {
        // Direct download
        await downloadDirect(url, outputPath, verbose);
        return { path: outputPath, name: filename, cached: false };
    } else {
        // Try yt-dlp for YouTube and other sites
        const hasYtDlp = await checkYtDlp();

        if (!hasYtDlp) {
            throw new Error('yt-dlp is required for non-direct video URLs. Install with: brew install yt-dlp');
        }

        const downloadedPath = await downloadWithYtDlp(url, outputPath, verbose);
        const actualFilename = path.basename(downloadedPath, path.extname(downloadedPath));
        return { path: downloadedPath, name: sanitizeFilename(actualFilename), cached: false };
    }
}

/**
 * Read URLs from a file
 */
function readUrlsFromFile(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`URL file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const urls = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && (line.startsWith('http://') || line.startsWith('https://')));

    return urls;
}

/**
 * Download all videos from URL file
 */
async function downloadAllVideos(urlFile, downloadDir, concurrency, verbose) {
    const urls = readUrlsFromFile(urlFile);

    if (urls.length === 0) {
        console.log(chalk.yellow('⚠ No valid URLs found in the file'));
        return [];
    }

    console.log(chalk.green(`✔ Found ${urls.length} URL(s) in ${path.basename(urlFile)}\n`));

    // Create download directory
    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
    }

    const results = [];
    let successCount = 0;
    let failCount = 0;
    let cachedCount = 0;

    // Process downloads in batches
    const batchSize = Math.min(concurrency, 3); // Limit download concurrency to avoid rate limiting

    for (let i = 0; i < urls.length; i += batchSize) {
        const batch = urls.slice(i, Math.min(i + batchSize, urls.length));
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(urls.length / batchSize);

        console.log(chalk.blue(`📥 Downloading batch ${batchNum}/${totalBatches}`));

        const batchPromises = batch.map(async (url, idx) => {
            const urlIndex = i + idx + 1;
            const shortUrl = url.length > 60 ? url.substring(0, 60) + '...' : url;

            try {
                const result = await downloadVideo(url, downloadDir, verbose);

                if (result.cached) {
                    cachedCount++;
                    console.log(chalk.gray(`   [${urlIndex}/${urls.length}] ⏭ Cached: ${result.name}`));
                } else {
                    successCount++;
                    console.log(chalk.green(`   [${urlIndex}/${urls.length}] ✔ Downloaded: ${result.name}`));
                }

                return { success: true, ...result, url };
            } catch (error) {
                failCount++;
                console.log(chalk.red(`   [${urlIndex}/${urls.length}] ✖ Failed: ${shortUrl}`));
                if (verbose) {
                    console.log(chalk.gray(`      Error: ${error.message}`));
                }
                return { success: false, url, error: error.message };
            }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
    }

    console.log('');
    console.log(chalk.blue('📥 Download Summary:'));
    console.log(chalk.green(`   Downloaded: ${successCount}`));
    if (cachedCount > 0) {
        console.log(chalk.gray(`   Cached:     ${cachedCount}`));
    }
    if (failCount > 0) {
        console.log(chalk.red(`   Failed:     ${failCount}`));
    }
    console.log('');

    // Return only successful downloads as video objects
    return results
        .filter(r => r.success)
        .map(r => ({
            path: r.path,
            name: r.name,
            extension: path.extname(r.path).slice(1),
            size: fs.existsSync(r.path) ? fs.statSync(r.path).size : 0,
            url: r.url
        }));
}

module.exports = {
    checkYtDlp,
    downloadVideo,
    downloadAllVideos,
    readUrlsFromFile,
    isDirectVideoUrl
};
