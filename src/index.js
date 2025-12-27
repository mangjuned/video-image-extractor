#!/usr/bin/env node

const { program } = require('commander');
const path = require('path');
const fs = require('fs');
const { processVideos } = require('./extractor');
const { checkFfmpeg } = require('./utils');
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
    .requiredOption('-i, --input <directory>', 'Input directory containing video files')
    .requiredOption('-o, --output <directory>', 'Output directory for extracted frames')
    .option('-q, --quality <level>', 'PNG compression level (0-9, 0=best quality)', '2')
    .option('-f, --format <pattern>', 'Output filename pattern (use %d for frame number)', 'frame_%06d.png')
    .option('-e, --extensions <list>', 'Video extensions to process (comma-separated)', 'mp4,avi,mkv,mov,wmv,flv,webm,m4v,mpeg,mpg')
    .option('--fps <rate>', 'Extract frames at specific FPS (default: extract all frames)')
    .option('--start <time>', 'Start time for extraction (format: HH:MM:SS or seconds)')
    .option('--end <time>', 'End time for extraction (format: HH:MM:SS or seconds)')
    .option('-c, --concurrency <number>', 'Number of videos to process in parallel (default: auto, based on CPU cores)', 'auto')
    .option('--dry-run', 'Show what would be processed without actually extracting', false)
    .option('-v, --verbose', 'Enable verbose output', false)
    .parse(process.argv);

const options = program.opts();

async function main() {
    console.log(banner);

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

    // Validate input directory
    const inputDir = path.resolve(options.input);
    if (!fs.existsSync(inputDir)) {
        console.error(chalk.red(`✖ Error: Input directory does not exist: ${inputDir}`));
        process.exit(1);
    }

    if (!fs.statSync(inputDir).isDirectory()) {
        console.error(chalk.red(`✖ Error: Input path is not a directory: ${inputDir}`));
        process.exit(1);
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

    console.log(chalk.blue('\n📁 Configuration:'));
    console.log(chalk.gray(`   Input directory:  ${inputDir}`));
    console.log(chalk.gray(`   Output directory: ${outputDir}`));
    console.log(chalk.gray(`   Quality level:    ${quality} (0=best, 9=fastest)`));
    console.log(chalk.gray(`   Filename pattern: ${options.format}`));
    console.log(chalk.gray(`   Video extensions: ${extensions.join(', ')}`));
    if (options.fps) console.log(chalk.gray(`   FPS:              ${options.fps}`));
    if (options.start) console.log(chalk.gray(`   Start time:       ${options.start}`));
    if (options.end) console.log(chalk.gray(`   End time:         ${options.end}`));
    console.log(chalk.gray(`   Concurrency:      ${options.concurrency === 'auto' ? 'auto (based on CPU cores)' : options.concurrency + 'x parallel'}`));
    if (options.dryRun) console.log(chalk.yellow(`   ⚠ DRY RUN MODE`));
    console.log('');

    try {
        await processVideos({
            inputDir,
            outputDir,
            quality,
            format: options.format,
            extensions,
            fps: options.fps,
            startTime: options.start,
            endTime: options.end,
            concurrency: options.concurrency,
            dryRun: options.dryRun,
            verbose: options.verbose
        });
    } catch (error) {
        console.error(chalk.red(`\n✖ Error: ${error.message}`));
        if (options.verbose) {
            console.error(chalk.gray(error.stack));
        }
        process.exit(1);
    }
}

main();
