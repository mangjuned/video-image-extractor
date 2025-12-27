#!/usr/bin/env node

const { program } = require('commander');
const path = require('path');
const fs = require('fs');
const { processVideos, processVideosFromList } = require('./extractor');
const { checkFfmpeg } = require('./utils');
const { downloadAllVideos, checkYtDlp } = require('./downloader');
// Note: gdrive module is loaded lazily to avoid googleapis dependency issues on older Node.js
const chalk = require('chalk');

// ASCII art banner
const banner = `
╔═══════════════════════════════════════════════════════════╗
║     ${chalk.cyan('Video Frame Extractor')} - ${chalk.yellow('Powered by FFmpeg')}            ║
║     Extract every frame from videos as high-quality PNGs  ║
╚═══════════════════════════════════════════════════════════╝
`;

program
    .name('video-frame-extractor')
    .description('CLI tool to batch extract frames from videos as high-quality PNGs')
    .version('1.0.0')
    .option('-i, --input <directory>', 'Input directory containing video files')
    .option('-u, --urls <file>', 'Text file containing video URLs (one per line)')
    .requiredOption('-o, --output <directory>', 'Output directory for extracted frames')
    .option('-d, --download-dir <directory>', 'Directory to store downloaded videos (default: ./downloads)')
    .option('-q, --quality <level>', 'PNG compression level (0-9, 0=best quality)', '2')
    .option('-f, --format <pattern>', 'Output filename pattern (use %d for frame number)', 'frame_%06d.png')
    .option('-e, --extensions <list>', 'Video extensions to process (comma-separated)', 'mp4,avi,mkv,mov,wmv,flv,webm,m4v,mpeg,mpg')
    .option('--fps <rate>', 'Extract frames at specific FPS (default: extract all frames)')
    .option('--start <time>', 'Start time for extraction (format: HH:MM:SS or seconds)')
    .option('--end <time>', 'End time for extraction (format: HH:MM:SS or seconds)')
    .option('-c, --concurrency <number>', 'Number of videos to process in parallel (default: auto, based on CPU cores)', 'auto')
    .option('--keep-downloads', 'Keep downloaded videos after processing (default: true)', true)
    // Google Drive options
    .option('--upload-drive', 'Upload extracted frames to Google Drive', false)
    .option('--drive-credentials <file>', 'Path to Google Drive service account JSON credentials file')
    .option('--drive-folder <id>', 'Google Drive folder ID to upload files to')
    .option('--delete-after-upload', 'Delete local files after successful upload to Google Drive', false)
    .option('--dry-run', 'Show what would be processed without actually extracting', false)
    .option('-v, --verbose', 'Enable verbose output', false)
    .parse(process.argv);

const options = program.opts();

async function main() {
    console.log(banner);

    // Validate that either input or urls is provided
    if (!options.input && !options.urls) {
        console.error(chalk.red('✖ Error: Either --input or --urls must be provided'));
        console.log(chalk.gray('  Use --input for local video files'));
        console.log(chalk.gray('  Use --urls for downloading videos from URLs'));
        process.exit(1);
    }

    // Validate Google Drive options
    if (options.uploadDrive) {
        if (!options.driveCredentials) {
            console.error(chalk.red('✖ Error: --drive-credentials is required when using --upload-drive'));
            console.log(chalk.gray('  Provide the path to your Google service account JSON file'));
            process.exit(1);
        }
        if (!options.driveFolder) {
            console.error(chalk.red('✖ Error: --drive-folder is required when using --upload-drive'));
            console.log(chalk.gray('  Provide the Google Drive folder ID to upload to'));
            process.exit(1);
        }

        const credPath = path.resolve(options.driveCredentials);
        if (!fs.existsSync(credPath)) {
            console.error(chalk.red(`✖ Error: Credentials file not found: ${credPath}`));
            process.exit(1);
        }
    }

    // Check if ffmpeg is installed
    const ffmpegAvailable = await checkFfmpeg();
    if (!ffmpegAvailable) {
        console.error(chalk.red('✖ Error: ffmpeg is not installed or not found in PATH'));
        console.log(chalk.yellow('  Please install ffmpeg:'));
        console.log(chalk.gray('    - macOS: brew install ffmpeg'));
        console.log(chalk.gray('    - Ubuntu/Debian: sudo apt install ffmpeg'));
        console.log(chalk.gray('    - Windows: Download from https://ffmpeg.org/download.html'));
        process.exit(1);
    }

    console.log(chalk.green('✔ ffmpeg found'));

    // Check yt-dlp if using URLs
    if (options.urls) {
        const ytdlpAvailable = await checkYtDlp();
        if (ytdlpAvailable) {
            console.log(chalk.green('✔ yt-dlp found (YouTube/other sites supported)'));
        } else {
            console.log(chalk.yellow('⚠ yt-dlp not found (only direct video URLs supported)'));
            console.log(chalk.gray('  Install with: brew install yt-dlp'));
        }
    }

    // Create output directory if it doesn't exist
    const outputDir = path.resolve(options.output);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
        console.log(chalk.green(`✔ Created output directory: ${outputDir}`));
    }

    // Validate quality level
    const quality = parseInt(options.quality, 10);
    if (isNaN(quality) || quality < 0 || quality > 9) {
        console.error(chalk.red('✖ Error: Quality level must be between 0 and 9'));
        process.exit(1);
    }

    // Parse extensions
    const extensions = options.extensions.split(',').map(ext => ext.trim().toLowerCase());

    // Determine concurrency
    const concurrency = options.concurrency;

    let videos = [];
    let inputDir = null;

    // Mode: Download from URLs
    if (options.urls) {
        const urlFile = path.resolve(options.urls);

        if (!fs.existsSync(urlFile)) {
            console.error(chalk.red(`✖ Error: URL file not found: ${urlFile}`));
            process.exit(1);
        }

        // Setup download directory
        const downloadDir = options.downloadDir
            ? path.resolve(options.downloadDir)
            : path.join(path.dirname(outputDir), 'downloads');

        console.log(chalk.blue('\n📁 Configuration:'));
        console.log(chalk.gray(`   URL file:         ${urlFile}`));
        console.log(chalk.gray(`   Download dir:     ${downloadDir}`));
        console.log(chalk.gray(`   Output directory: ${outputDir}`));
        console.log(chalk.gray(`   Quality level:    ${quality} (0=best, 9=fastest)`));
        console.log(chalk.gray(`   Filename pattern: ${options.format}`));
        if (options.fps) console.log(chalk.gray(`   FPS:              ${options.fps}`));
        if (options.start) console.log(chalk.gray(`   Start time:       ${options.start}`));
        if (options.end) console.log(chalk.gray(`   End time:         ${options.end}`));
        console.log(chalk.gray(`   Concurrency:      ${concurrency === 'auto' ? 'auto (based on CPU cores)' : concurrency + 'x parallel'}`));
        if (options.uploadDrive) {
            console.log(chalk.cyan(`   ☁️  Google Drive:  Enabled`));
            console.log(chalk.gray(`   Drive folder:     ${options.driveFolder}`));
            if (options.deleteAfterUpload) {
                console.log(chalk.yellow(`   Delete local:     Yes (after upload)`));
            }
        }
        if (options.dryRun) console.log(chalk.yellow(`   ⚠ DRY RUN MODE`));
        console.log('');

        if (options.dryRun) {
            // Just read and display URLs
            const urlContent = fs.readFileSync(urlFile, 'utf-8');
            const urls = urlContent
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#') && line.startsWith('http'));

            console.log(chalk.yellow('⚠ Dry run mode - no downloads or extractions will occur\n'));
            console.log(chalk.blue('📥 URLs to download:'));
            urls.forEach((url, i) => {
                const shortUrl = url.length > 70 ? url.substring(0, 70) + '...' : url;
                console.log(chalk.gray(`   ${i + 1}. ${shortUrl}`));
            });
            return;
        }

        // Download videos
        console.log(chalk.blue('📥 Downloading videos from URLs...\n'));
        videos = await downloadAllVideos(
            urlFile,
            downloadDir,
            parseInt(concurrency, 10) || 4,
            options.verbose
        );

        if (videos.length === 0) {
            console.log(chalk.yellow('⚠ No videos were successfully downloaded'));
            return;
        }

        inputDir = downloadDir;

    } else {
        // Mode: Local files
        inputDir = path.resolve(options.input);

        if (!fs.existsSync(inputDir)) {
            console.error(chalk.red(`✖ Error: Input directory does not exist: ${inputDir}`));
            process.exit(1);
        }

        if (!fs.statSync(inputDir).isDirectory()) {
            console.error(chalk.red(`✖ Error: Input path is not a directory: ${inputDir}`));
            process.exit(1);
        }

        console.log(chalk.blue('\n📁 Configuration:'));
        console.log(chalk.gray(`   Input directory:  ${inputDir}`));
        console.log(chalk.gray(`   Output directory: ${outputDir}`));
        console.log(chalk.gray(`   Quality level:    ${quality} (0=best, 9=fastest)`));
        console.log(chalk.gray(`   Filename pattern: ${options.format}`));
        console.log(chalk.gray(`   Video extensions: ${extensions.join(', ')}`));
        if (options.fps) console.log(chalk.gray(`   FPS:              ${options.fps}`));
        if (options.start) console.log(chalk.gray(`   Start time:       ${options.start}`));
        if (options.end) console.log(chalk.gray(`   End time:         ${options.end}`));
        console.log(chalk.gray(`   Concurrency:      ${concurrency === 'auto' ? 'auto (based on CPU cores)' : concurrency + 'x parallel'}`));
        if (options.uploadDrive) {
            console.log(chalk.cyan(`   ☁️  Google Drive:  Enabled`));
            console.log(chalk.gray(`   Drive folder:     ${options.driveFolder}`));
            if (options.deleteAfterUpload) {
                console.log(chalk.yellow(`   Delete local:     Yes (after upload)`));
            }
        }
        if (options.dryRun) console.log(chalk.yellow(`   ⚠ DRY RUN MODE`));
        console.log('');
    }

    try {
        // Step 1: Extract frames
        if (videos.length > 0) {
            // Process downloaded videos directly (already have video list)
            await processVideosFromList({
                videos,
                outputDir,
                quality,
                format: options.format,
                fps: options.fps,
                startTime: options.start,
                endTime: options.end,
                concurrency,
                dryRun: options.dryRun,
                verbose: options.verbose
            });
        } else {
            // Process local directory
            await processVideos({
                inputDir,
                outputDir,
                quality,
                format: options.format,
                extensions,
                fps: options.fps,
                startTime: options.start,
                endTime: options.end,
                concurrency,
                dryRun: options.dryRun,
                verbose: options.verbose
            });
        }

        // Step 2: Upload to Google Drive (if enabled)
        if (options.uploadDrive && !options.dryRun) {
            // Lazy load googleapis to avoid Node.js version issues when not using upload
            const { uploadAllToGoogleDrive } = require('./gdrive');
            await uploadAllToGoogleDrive(
                outputDir,
                path.resolve(options.driveCredentials),
                options.driveFolder,
                {
                    deleteAfterUpload: options.deleteAfterUpload,
                    verbose: options.verbose,
                    concurrency: 10  // Files per batch for upload
                }
            );
        }

    } catch (error) {
        console.error(chalk.red(`\n✖ Error: ${error.message}`));
        if (options.verbose) {
            console.error(chalk.gray(error.stack));
        }
        process.exit(1);
    }
}

main();
