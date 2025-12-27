const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
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
        verbose
    } = config;

    // Find all video files
    const spinner = ora('Scanning for video files...').start();
    const videos = findVideoFiles(inputDir, extensions);
    spinner.stop();

    if (videos.length === 0) {
        console.log(chalk.yellow('⚠ No video files found in the input directory'));
        console.log(chalk.gray(`  Looking for extensions: ${extensions.join(', ')}`));
        return;
    }

    console.log(chalk.green(`✔ Found ${videos.length} video file(s)\n`));

    // Display video list
    console.log(chalk.blue('📹 Videos to process:'));
    videos.forEach((video, index) => {
        console.log(chalk.gray(`   ${index + 1}. ${video.name}.${video.extension} (${formatFileSize(video.size)})`));
    });
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

    // Process each video
    let successCount = 0;
    let failCount = 0;
    let totalFrames = 0;
    const startTotalTime = Date.now();

    for (let i = 0; i < videos.length; i++) {
        const video = videos[i];
        const videoOutputDir = path.join(outputDir, sanitizeFilename(video.name));

        console.log(chalk.blue(`\n[${i + 1}/${videos.length}] Processing: ${chalk.white(video.name)}.${video.extension}`));

        // Get video duration
        const duration = await getVideoDuration(video.path);
        if (duration) {
            console.log(chalk.gray(`   Duration: ${formatDuration(duration)}`));
        }

        // Create output subdirectory
        if (!fs.existsSync(videoOutputDir)) {
            fs.mkdirSync(videoOutputDir, { recursive: true });
        }

        const extractSpinner = ora({
            text: 'Extracting frames...',
            color: 'cyan'
        }).start();

        const startTime_local = Date.now();

        try {
            await extractFrames(video.path, videoOutputDir, {
                quality,
                format,
                fps,
                startTime,
                endTime,
                verbose
            });

            const elapsedTime = ((Date.now() - startTime_local) / 1000).toFixed(2);
            const frameCount = countExtractedFrames(videoOutputDir);
            totalFrames += frameCount;

            extractSpinner.succeed(
                chalk.green(`Extracted ${chalk.white(frameCount)} frames in ${elapsedTime}s → ${chalk.gray(videoOutputDir)}`)
            );
            successCount++;
        } catch (error) {
            extractSpinner.fail(chalk.red(`Failed: ${error.message}`));
            failCount++;

            if (verbose) {
                console.error(chalk.gray(error.stack));
            }
        }
    }

    // Summary
    const totalTime = ((Date.now() - startTotalTime) / 1000).toFixed(2);

    console.log(chalk.blue('\n═══════════════════════════════════════════════════════════'));
    console.log(chalk.blue('📊 Summary'));
    console.log(chalk.blue('═══════════════════════════════════════════════════════════'));
    console.log(chalk.gray(`   Total videos:     ${videos.length}`));
    console.log(chalk.green(`   Successful:       ${successCount}`));
    if (failCount > 0) {
        console.log(chalk.red(`   Failed:           ${failCount}`));
    }
    console.log(chalk.cyan(`   Total frames:     ${totalFrames}`));
    console.log(chalk.gray(`   Total time:       ${totalTime}s`));
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
