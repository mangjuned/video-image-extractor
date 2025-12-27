const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const chalk = require('chalk');
const ora = require('ora');
const { getVideoDuration, formatDuration, sanitizeFilename } = require('./utils');

/**
 * Find all video files in a directory
 */
function findVideoFiles(directory, extensions) {
    const videoFiles = [];

    const items = fs.readdirSync(directory);

    for (const item of items) {
        const fullPath = path.join(directory, item);
        const stat = fs.statSync(fullPath);

        if (stat.isFile()) {
            const ext = path.extname(item).toLowerCase().slice(1);
            if (extensions.includes(ext)) {
                videoFiles.push({
                    path: fullPath,
                    name: path.basename(item, path.extname(item)),
                    extension: ext,
                    size: stat.size
                });
            }
        } else if (stat.isDirectory()) {
            // Recursively search subdirectories
            videoFiles.push(...findVideoFiles(fullPath, extensions));
        }
    }

    return videoFiles;
}

/**
 * Format file size for display
 */
function formatFileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let unitIndex = 0;
    let size = bytes;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Extract frames from a single video
 */
async function extractFrames(videoPath, outputDir, options) {
    return new Promise((resolve, reject) => {
        const args = [];

        // Input options
        if (options.startTime) {
            args.push('-ss', options.startTime);
        }

        // Input file
        args.push('-i', videoPath);

        // End time (duration from start)
        if (options.endTime) {
            args.push('-to', options.endTime);
        }

        // FPS filter if specified
        if (options.fps) {
            args.push('-vf', `fps=${options.fps}`);
        }

        // PNG output settings for high quality
        args.push(
            '-compression_level', options.quality.toString(),
            '-pix_fmt', 'rgb24'  // High quality pixel format
        );

        // Output pattern
        const outputPattern = path.join(outputDir, options.format);
        args.push(outputPattern);

        // Overwrite existing files
        args.push('-y');

        if (options.verbose) {
            console.log(chalk.gray(`   Command: ffmpeg ${args.join(' ')}`));
        }

        const ffmpeg = spawn('ffmpeg', args, {
            stdio: options.verbose ? 'inherit' : 'pipe'
        });

        let stderr = '';

        if (!options.verbose && ffmpeg.stderr) {
            ffmpeg.stderr.on('data', (data) => {
                stderr += data.toString();
            });
        }

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`ffmpeg exited with code ${code}\n${stderr}`));
            }
        });

        ffmpeg.on('error', (err) => {
            reject(new Error(`Failed to start ffmpeg: ${err.message}`));
        });
    });
}

/**
 * Count extracted frames in a directory
 */
function countExtractedFrames(directory) {
    try {
        const files = fs.readdirSync(directory);
        return files.filter(f => f.endsWith('.png')).length;
    } catch {
        return 0;
    }
}
/**
 * Process a single video and return result
 */
async function processSingleVideo(video, index, total, outputDir, options) {
    // Sanitize the video name properly (handles URL-encoded names)
    const sanitizedName = sanitizeFilename(video.name);
    const videoOutputDir = path.join(outputDir, sanitizedName);
    const startTime = Date.now();

    // Check cache: if frames already exist and --force is not set, skip
    if (!options.force) {
        const existingFrames = countExtractedFrames(videoOutputDir);
        if (existingFrames > 0) {
            return {
                success: true,
                cached: true,
                video,
                index,
                frameCount: existingFrames,
                elapsedTime: '0.00',
                duration: null,
                outputDir: videoOutputDir
            };
        }
    }

    // Create output subdirectory with retry for network filesystems (like Google Drive)
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (!fs.existsSync(videoOutputDir)) {
                fs.mkdirSync(videoOutputDir, { recursive: true });
            }
            // Verify directory was created
            if (fs.existsSync(videoOutputDir)) {
                break;
            }
        } catch (err) {
            if (attempt === maxRetries) {
                throw new Error(`Failed to create output directory after ${maxRetries} attempts: ${err.message}`);
            }
            // Wait a bit before retry (helps with network filesystems)
            await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        }
    }

    // Small delay to prevent race conditions with parallel writes to network drives
    await new Promise(resolve => setTimeout(resolve, 100 * index));

    try {
        // Get video duration
        const duration = await getVideoDuration(video.path);

        await extractFrames(video.path, videoOutputDir, {
            quality: options.quality,
            format: options.format,
            fps: options.fps,
            startTime: options.startTime,
            endTime: options.endTime,
            verbose: options.verbose
        });

        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
        const frameCount = countExtractedFrames(videoOutputDir);

        return {
            success: true,
            cached: false,
            video,
            index,
            frameCount,
            elapsedTime,
            duration,
            outputDir: videoOutputDir
        };
    } catch (error) {
        return {
            success: false,
            cached: false,
            video,
            index,
            error: error.message,
            outputDir: videoOutputDir
        };
    }
}

/**
 * Process videos in parallel batches
 */
async function processVideosParallel(videos, outputDir, options, concurrency) {
    const results = [];
    let completed = 0;
    let successCount = 0;
    let cachedCount = 0;
    let failCount = 0;
    let totalFrames = 0;
    const quiet = options.quiet || false;

    // Process in batches
    for (let i = 0; i < videos.length; i += concurrency) {
        const batch = videos.slice(i, Math.min(i + concurrency, videos.length));
        const batchNumber = Math.floor(i / concurrency) + 1;
        const totalBatches = Math.ceil(videos.length / concurrency);

        if (!quiet) {
            console.log(`\n[Batch ${batchNumber}/${totalBatches}] Processing ${batch.length} video(s)...`);
        }

        const batchStartTime = Date.now();

        // Process batch in parallel
        const batchPromises = batch.map((video, batchIndex) =>
            processSingleVideo(
                video,
                i + batchIndex,
                videos.length,
                outputDir,
                options
            )
        );

        const batchResults = await Promise.all(batchPromises);

        const batchTime = ((Date.now() - batchStartTime) / 1000).toFixed(2);

        // Process results
        for (const result of batchResults) {
            completed++;
            results.push(result);

            if (result.success) {
                totalFrames += result.frameCount;
                if (result.cached) {
                    cachedCount++;
                    if (!quiet) {
                        console.log(`  ⏭ ${result.video.name}: ${result.frameCount} frames (cached)`);
                    }
                } else {
                    successCount++;
                    if (!quiet) {
                        console.log(`  ✔ ${result.video.name}: ${result.frameCount} frames`);
                    }
                }
            } else {
                failCount++;
                console.log(`  ✖ ${result.video.name}: ${result.error}`);
            }
        }

        if (!quiet) {
            console.log(`  Batch done in ${batchTime}s`);
        }
    }

    return { results, successCount, cachedCount, failCount, totalFrames };
}

/**
 * Process all videos in the input directory
 */
async function processVideos(config) {
    const {
        inputDir,
        outputDir,
        quality,
        format,
        extensions,
        fps,
        startTime,
        endTime,
        dryRun,
        verbose,
        quiet,
        force,
        concurrency: userConcurrency
    } = config;

    // Determine concurrency
    const cpuCount = os.cpus().length;
    const defaultConcurrency = Math.max(1, Math.floor(cpuCount / 2));

    // Find all video files
    const videos = findVideoFiles(inputDir, extensions);

    if (videos.length === 0) {
        console.log('No video files found');
        return;
    }

    // Determine actual concurrency
    let concurrency = userConcurrency === 'auto'
        ? Math.min(defaultConcurrency, videos.length)
        : Math.min(parseInt(userConcurrency, 10) || defaultConcurrency, videos.length);

    concurrency = Math.max(1, concurrency);

    if (!quiet) {
        console.log(`Found ${videos.length} video(s), processing with concurrency ${concurrency}`);
    } else {
        console.log(`Processing ${videos.length} video(s)...`);
    }

    if (dryRun) {
        console.log('Dry run mode - no frames will be extracted');
        return;
    }

    const startTotalTime = Date.now();

    // Process videos in parallel
    const { successCount, cachedCount, failCount, totalFrames } = await processVideosParallel(
        videos,
        outputDir,
        { quality, format, fps, startTime, endTime, verbose, quiet, force },
        concurrency
    );

    // Summary
    const totalTime = ((Date.now() - startTotalTime) / 1000).toFixed(2);
    const cachedStr = cachedCount > 0 ? `, ${cachedCount} cached` : '';

    console.log(`\nDone: ${successCount} extracted${cachedStr}, ${failCount} failed, ${totalFrames} frames in ${totalTime}s`);
}

/**
 * Process videos from a pre-built list (used for downloaded videos)
 */
async function processVideosFromList(config) {
    const {
        videos,
        outputDir,
        quality,
        format,
        fps,
        startTime,
        endTime,
        dryRun,
        verbose,
        quiet,
        force,
        concurrency: userConcurrency
    } = config;

    // Determine concurrency
    const cpuCount = os.cpus().length;
    const defaultConcurrency = Math.max(1, Math.floor(cpuCount / 2));

    if (videos.length === 0) {
        console.log('No videos to process');
        return;
    }

    // Determine actual concurrency
    let concurrency = userConcurrency === 'auto'
        ? Math.min(defaultConcurrency, videos.length)
        : Math.min(parseInt(userConcurrency, 10) || defaultConcurrency, videos.length);

    concurrency = Math.max(1, concurrency);

    if (!quiet) {
        console.log(`Processing ${videos.length} video(s) with concurrency ${concurrency}`);
    } else {
        console.log(`Processing ${videos.length} video(s)...`);
    }

    if (dryRun) {
        console.log('Dry run mode - no frames will be extracted');
        return;
    }

    const startTotalTime = Date.now();

    // Process videos in parallel
    const { successCount, cachedCount, failCount, totalFrames } = await processVideosParallel(
        videos,
        outputDir,
        { quality, format, fps, startTime, endTime, verbose, quiet, force },
        concurrency
    );

    // Summary
    const totalTime = ((Date.now() - startTotalTime) / 1000).toFixed(2);
    const cachedStr = cachedCount > 0 ? `, ${cachedCount} cached` : '';

    console.log(`\nDone: ${successCount} extracted${cachedStr}, ${failCount} failed, ${totalFrames} frames in ${totalTime}s`);
}

module.exports = {
    processVideos,
    processVideosFromList,
    findVideoFiles,
    extractFrames
};
