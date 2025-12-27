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
    const videoOutputDir = path.join(outputDir, sanitizeFilename(video.name));
    const startTime = Date.now();

    // Create output subdirectory
    if (!fs.existsSync(videoOutputDir)) {
        fs.mkdirSync(videoOutputDir, { recursive: true });
    }

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
    let failCount = 0;
    let totalFrames = 0;

    // Process in batches
    for (let i = 0; i < videos.length; i += concurrency) {
        const batch = videos.slice(i, Math.min(i + concurrency, videos.length));
        const batchNumber = Math.floor(i / concurrency) + 1;
        const totalBatches = Math.ceil(videos.length / concurrency);

        console.log(chalk.blue(`\n🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} video${batch.length > 1 ? 's' : ''} in parallel)`));
        console.log(chalk.gray(`   Videos: ${batch.map(v => v.name).join(', ')}`));

        const spinner = ora({
            text: `Extracting frames from ${batch.length} video(s)...`,
            color: 'cyan'
        }).start();

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
        spinner.stop();

        // Process results
        for (const result of batchResults) {
            completed++;
            results.push(result);

            if (result.success) {
                successCount++;
                totalFrames += result.frameCount;
                console.log(chalk.green(`   ✔ ${result.video.name}: ${result.frameCount} frames in ${result.elapsedTime}s`));
            } else {
                failCount++;
                console.log(chalk.red(`   ✖ ${result.video.name}: ${result.error}`));
            }
        }

        console.log(chalk.gray(`   Batch completed in ${batchTime}s`));
    }

    return { results, successCount, failCount, totalFrames };
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
        concurrency: userConcurrency
    } = config;

    // Determine concurrency
    const cpuCount = os.cpus().length;
    const defaultConcurrency = Math.max(1, Math.floor(cpuCount / 2)); // Use half of CPU cores by default

    // Find all video files
    const spinner = ora('Scanning for video files...').start();
    const videos = findVideoFiles(inputDir, extensions);
    spinner.stop();

    if (videos.length === 0) {
        console.log(chalk.yellow('⚠ No video files found in the input directory'));
        console.log(chalk.gray(`  Looking for extensions: ${extensions.join(', ')}`));
        return;
    }

    // Determine actual concurrency (can't be more than number of videos)
    let concurrency = userConcurrency === 'auto'
        ? Math.min(defaultConcurrency, videos.length)
        : Math.min(parseInt(userConcurrency, 10) || defaultConcurrency, videos.length);

    concurrency = Math.max(1, concurrency); // At least 1

    console.log(chalk.green(`✔ Found ${videos.length} video file(s)\n`));

    // Display video list
    console.log(chalk.blue('📹 Videos to process:'));
    videos.forEach((video, index) => {
        console.log(chalk.gray(`   ${index + 1}. ${video.name}.${video.extension} (${formatFileSize(video.size)})`));
    });
    console.log('');

    // Display parallelism info
    console.log(chalk.magenta(`⚡ Parallel Processing:`));
    console.log(chalk.gray(`   CPU cores:     ${cpuCount}`));
    console.log(chalk.gray(`   Concurrency:   ${concurrency} video(s) at a time`));
    console.log(chalk.gray(`   Total batches: ${Math.ceil(videos.length / concurrency)}`));
    console.log('');

    if (dryRun) {
        console.log(chalk.yellow('⚠ Dry run mode - no frames will be extracted\n'));

        for (const video of videos) {
            const videoOutputDir = path.join(outputDir, sanitizeFilename(video.name));
            console.log(chalk.blue(`📁 Would create: ${videoOutputDir}`));

            const duration = await getVideoDuration(video.path);
            if (duration) {
                console.log(chalk.gray(`   Duration: ${formatDuration(duration)}`));
            }
        }
        return;
    }

    const startTotalTime = Date.now();

    // Process videos in parallel
    const { successCount, failCount, totalFrames } = await processVideosParallel(
        videos,
        outputDir,
        { quality, format, fps, startTime, endTime, verbose },
        concurrency
    );

    // Summary
    const totalTime = ((Date.now() - startTotalTime) / 1000).toFixed(2);
    const avgTimePerVideo = (parseFloat(totalTime) / videos.length).toFixed(2);

    console.log(chalk.blue('\n═══════════════════════════════════════════════════════════'));
    console.log(chalk.blue('📊 Summary'));
    console.log(chalk.blue('═══════════════════════════════════════════════════════════'));
    console.log(chalk.gray(`   Total videos:     ${videos.length}`));
    console.log(chalk.green(`   Successful:       ${successCount}`));
    if (failCount > 0) {
        console.log(chalk.red(`   Failed:           ${failCount}`));
    }
    console.log(chalk.cyan(`   Total frames:     ${totalFrames}`));
    console.log(chalk.magenta(`   Concurrency:      ${concurrency}x parallel`));
    console.log(chalk.gray(`   Total time:       ${totalTime}s`));
    console.log(chalk.gray(`   Avg per video:    ${avgTimePerVideo}s`));
    console.log(chalk.gray(`   Output directory: ${outputDir}`));
    console.log('');

    if (failCount > 0) {
        console.log(chalk.yellow(`⚠ ${failCount} video(s) failed to process. Use --verbose for more details.`));
    } else {
        console.log(chalk.green('✔ All videos processed successfully!'));
    }
}

module.exports = {
    processVideos,
    findVideoFiles,
    extractFrames
};
