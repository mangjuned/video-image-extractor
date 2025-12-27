#!/usr/bin/env node

/**
 * Colab Helper - Extracts frames locally first, then copies to Google Drive
 * This avoids I/O errors from writing directly to Drive
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const LOCAL_TEMP = '/content/temp_frames';
const BATCH_SIZE = 100;  // Copy files in batches
const DELAY_MS = 500;    // Delay between batches

/**
 * Copy a directory to destination with batched file operations
 */
async function copyDirBatched(src, dest, quiet) {
    if (!fs.existsSync(src)) {
        return { copied: 0, failed: 0 };
    }

    // Create destination directory
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const files = fs.readdirSync(src);
    let copied = 0;
    let failed = 0;

    // Process files in batches
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, Math.min(i + BATCH_SIZE, files.length));

        for (const file of batch) {
            const srcFile = path.join(src, file);
            const destFile = path.join(dest, file);

            try {
                // Check if file already exists at destination
                if (fs.existsSync(destFile)) {
                    copied++;
                    continue;
                }

                // Copy file
                fs.copyFileSync(srcFile, destFile);
                copied++;
            } catch (err) {
                failed++;
                if (!quiet) {
                    console.error(`  Failed to copy ${file}: ${err.message}`);
                }
            }
        }

        // Small delay between batches to avoid overwhelming Drive
        if (i + BATCH_SIZE < files.length) {
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
    }

    return { copied, failed };
}

/**
 * Copy all extracted frames from local to Drive
 */
async function copyToDrive(localDir, driveDir, quiet) {
    if (!fs.existsSync(localDir)) {
        console.log('No frames to copy');
        return;
    }

    const videoDirs = fs.readdirSync(localDir).filter(f =>
        fs.statSync(path.join(localDir, f)).isDirectory()
    );

    if (videoDirs.length === 0) {
        console.log('No video frame directories found');
        return;
    }

    console.log(`Copying ${videoDirs.length} video folder(s) to Google Drive...`);

    let totalCopied = 0;
    let totalFailed = 0;

    for (const videoDir of videoDirs) {
        const srcDir = path.join(localDir, videoDir);
        const destDir = path.join(driveDir, videoDir);

        const frameCount = fs.readdirSync(srcDir).filter(f => f.endsWith('.png')).length;

        if (!quiet) {
            process.stdout.write(`  ${videoDir}: ${frameCount} frames...`);
        }

        const { copied, failed } = await copyDirBatched(srcDir, destDir, quiet);
        totalCopied += copied;
        totalFailed += failed;

        if (!quiet) {
            console.log(` ✔ copied`);
        }
    }

    console.log(`\nCopy complete: ${totalCopied} files copied, ${totalFailed} failed`);
}

/**
 * Clean up local temp directory
 */
function cleanupLocal(localDir) {
    if (fs.existsSync(localDir)) {
        fs.rmSync(localDir, { recursive: true, force: true });
        console.log('Local temp files cleaned up');
    }
}

// Help message
function showHelp() {
    console.log(`
Colab Helper - Avoid Google Drive I/O errors

This script extracts frames to local storage first, then copies to Drive.

Usage:
  node colab_helper.js extract [options]   Extract frames locally
  node colab_helper.js copy <drive_dir>    Copy local frames to Drive
  node colab_helper.js cleanup             Clean up local temp files
  node colab_helper.js full [options]      Extract + Copy + Cleanup (all in one)

Extract Options:
  -u, --urls <file>        URL file
  -i, --input <dir>        Input video directory
  --fps <rate>             Frames per second
  -c, --concurrency <n>    Parallel videos (default: 1)
  --quiet                  Minimal output

Examples:
  # Step by step (recommended for large batches):
  node colab_helper.js extract -u links.txt --fps 1 --quiet
  node colab_helper.js copy /content/drive/MyDrive/frames
  node colab_helper.js cleanup

  # All in one:
  node colab_helper.js full -u links.txt --fps 1 /content/drive/MyDrive/frames
`);
}

// Parse arguments
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
    showHelp();
    process.exit(0);
}

const command = args[0];
const quiet = args.includes('--quiet');

async function main() {
    switch (command) {
        case 'extract': {
            // Build extraction command
            const extractArgs = ['src/index.js', '-o', LOCAL_TEMP];

            // Forward relevant arguments
            for (let i = 1; i < args.length; i++) {
                const arg = args[i];
                if (['-u', '--urls', '-i', '--input', '--fps', '-c', '--concurrency',
                    '--start', '--end', '-q', '--quality', '--force'].includes(arg)) {
                    extractArgs.push(arg);
                    if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
                        extractArgs.push(args[++i]);
                    }
                } else if (['--quiet', '--verbose'].includes(arg)) {
                    extractArgs.push(arg);
                }
            }

            // Add defaults for Colab
            if (!args.includes('-c') && !args.includes('--concurrency')) {
                extractArgs.push('-c', '1');
            }
            extractArgs.push('--quiet');

            console.log('Extracting frames to local storage...');
            console.log(`Command: node ${extractArgs.join(' ')}\n`);

            const proc = spawn('node', extractArgs, { stdio: 'inherit', cwd: process.cwd() });

            proc.on('close', (code) => {
                if (code === 0) {
                    console.log('\n✔ Extraction complete. Frames saved to:', LOCAL_TEMP);
                    console.log('Run: node colab_helper.js copy <drive_path> to copy to Drive');
                } else {
                    console.error('\n✖ Extraction failed');
                }
                process.exit(code);
            });
            break;
        }

        case 'copy': {
            const driveDir = args[1];
            if (!driveDir) {
                console.error('Error: Drive directory path required');
                console.log('Usage: node colab_helper.js copy /content/drive/MyDrive/frames');
                process.exit(1);
            }

            await copyToDrive(LOCAL_TEMP, driveDir, quiet);
            break;
        }

        case 'cleanup': {
            cleanupLocal(LOCAL_TEMP);
            break;
        }

        case 'full': {
            // Find the drive path (last non-flag argument)
            let driveDir = null;
            for (let i = args.length - 1; i >= 1; i--) {
                if (!args[i].startsWith('-') && !['extract', 'copy', 'cleanup', 'full'].includes(args[i])) {
                    // Check if previous arg is a flag that takes a value
                    if (i > 1 && ['-u', '--urls', '-i', '--input', '--fps', '-c', '--concurrency',
                        '--start', '--end', '-q', '--quality'].includes(args[i - 1])) {
                        continue;
                    }
                    driveDir = args[i];
                    break;
                }
            }

            if (!driveDir) {
                console.error('Error: Drive directory path required');
                console.log('Usage: node colab_helper.js full -u links.txt --fps 1 /content/drive/MyDrive/frames');
                process.exit(1);
            }

            // Build extraction command
            const extractArgs = ['src/index.js', '-o', LOCAL_TEMP];

            for (let i = 1; i < args.length; i++) {
                const arg = args[i];
                if (arg === driveDir) continue;

                if (['-u', '--urls', '-i', '--input', '--fps', '-c', '--concurrency',
                    '--start', '--end', '-q', '--quality', '--force'].includes(arg)) {
                    extractArgs.push(arg);
                    if (i + 1 < args.length && !args[i + 1].startsWith('-') && args[i + 1] !== driveDir) {
                        extractArgs.push(args[++i]);
                    }
                } else if (['--quiet', '--verbose'].includes(arg)) {
                    extractArgs.push(arg);
                }
            }

            if (!args.includes('-c') && !args.includes('--concurrency')) {
                extractArgs.push('-c', '1');
            }
            extractArgs.push('--quiet');

            console.log('=== Step 1: Extracting frames to local storage ===\n');

            const proc = spawn('node', extractArgs, { stdio: 'inherit', cwd: process.cwd() });

            proc.on('close', async (code) => {
                if (code !== 0) {
                    console.error('\n✖ Extraction failed');
                    process.exit(code);
                }

                console.log('\n=== Step 2: Copying frames to Google Drive ===\n');
                await copyToDrive(LOCAL_TEMP, driveDir, quiet);

                console.log('\n=== Step 3: Cleaning up local files ===\n');
                cleanupLocal(LOCAL_TEMP);

                console.log('\n✔ All done!');
            });
            break;
        }

        default:
            console.error(`Unknown command: ${command}`);
            showHelp();
            process.exit(1);
    }
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
