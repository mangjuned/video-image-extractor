const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const chalk = require('chalk');
const ora = require('ora');

// Define the scope for Google Drive API
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

/**
 * Load credentials from JSON file
 */
function loadCredentials(credentialsPath) {
    if (!fs.existsSync(credentialsPath)) {
        throw new Error(`Credentials file not found: ${credentialsPath}`);
    }

    try {
        const content = fs.readFileSync(credentialsPath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        throw new Error(`Failed to parse credentials file: ${error.message}`);
    }
}

/**
 * Authorize and get access to Google Drive API
 */
async function authorize(credentials) {
    const auth = new google.auth.JWT(
        credentials.client_email,
        null,
        credentials.private_key,
        SCOPES
    );

    try {
        await auth.authorize();
        return auth;
    } catch (error) {
        throw new Error(`Error authorizing Google Drive API: ${error.message}`);
    }
}

/**
 * Create a folder in Google Drive
 */
async function createFolder(auth, folderName, parentFolderId) {
    const drive = google.drive({ version: 'v3', auth });

    const fileMetadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentFolderId ? [parentFolderId] : []
    };

    try {
        const response = await drive.files.create({
            resource: fileMetadata,
            fields: 'id, name'
        });

        return response.data;
    } catch (error) {
        throw new Error(`Error creating folder in Google Drive: ${error.message}`);
    }
}

/**
 * Check if folder exists in Google Drive
 */
async function findFolder(auth, folderName, parentFolderId) {
    const drive = google.drive({ version: 'v3', auth });

    try {
        let query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        if (parentFolderId) {
            query += ` and '${parentFolderId}' in parents`;
        }

        const response = await drive.files.list({
            q: query,
            fields: 'files(id, name)',
            spaces: 'drive'
        });

        return response.data.files.length > 0 ? response.data.files[0] : null;
    } catch (error) {
        throw new Error(`Error finding folder in Google Drive: ${error.message}`);
    }
}

/**
 * Get or create a folder in Google Drive
 */
async function getOrCreateFolder(auth, folderName, parentFolderId) {
    const existingFolder = await findFolder(auth, folderName, parentFolderId);

    if (existingFolder) {
        return existingFolder;
    }

    return await createFolder(auth, folderName, parentFolderId);
}

/**
 * Upload a single file to Google Drive
 */
async function uploadFile(auth, filePath, folderId, mimeType = 'image/png') {
    const drive = google.drive({ version: 'v3', auth });

    const fileMetadata = {
        name: path.basename(filePath),
        parents: folderId ? [folderId] : []
    };

    const media = {
        mimeType: mimeType,
        body: fs.createReadStream(filePath)
    };

    try {
        const response = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id, name'
        });

        return response.data;
    } catch (error) {
        throw new Error(`Error uploading file to Google Drive: ${error.message}`);
    }
}

/**
 * Upload files in parallel batches
 */
async function uploadFilesBatch(auth, files, folderId, concurrency = 5, verbose = false) {
    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < files.length; i += concurrency) {
        const batch = files.slice(i, Math.min(i + concurrency, files.length));

        const batchPromises = batch.map(async (filePath) => {
            try {
                const result = await uploadFile(auth, filePath, folderId);
                return { success: true, file: filePath, driveId: result.id };
            } catch (error) {
                return { success: false, file: filePath, error: error.message };
            }
        });

        const batchResults = await Promise.all(batchPromises);

        for (const result of batchResults) {
            if (result.success) {
                successCount++;
                if (verbose) {
                    console.log(chalk.gray(`      ✔ ${path.basename(result.file)}`));
                }
            } else {
                failCount++;
                if (verbose) {
                    console.log(chalk.red(`      ✖ ${path.basename(result.file)}: ${result.error}`));
                }
            }
        }

        results.push(...batchResults);
    }

    return { results, successCount, failCount };
}

/**
 * Upload all frames from a video folder to Google Drive
 */
async function uploadVideoFrames(auth, videoOutputDir, parentFolderId, options = {}) {
    const { deleteAfterUpload = false, verbose = false, concurrency = 10 } = options;

    const videoName = path.basename(videoOutputDir);

    // Get all PNG files in the directory
    const files = fs.readdirSync(videoOutputDir)
        .filter(f => f.endsWith('.png'))
        .map(f => path.join(videoOutputDir, f))
        .sort();

    if (files.length === 0) {
        return { success: true, uploaded: 0, deleted: 0 };
    }

    // Create subfolder for this video in Google Drive
    const videoFolder = await getOrCreateFolder(auth, videoName, parentFolderId);

    if (verbose) {
        console.log(chalk.gray(`      Drive folder: ${videoName} (${videoFolder.id})`));
    }

    // Upload files in batches
    const { successCount, failCount } = await uploadFilesBatch(
        auth,
        files,
        videoFolder.id,
        concurrency,
        verbose
    );

    let deletedCount = 0;

    // Delete local files after successful upload
    if (deleteAfterUpload && successCount > 0) {
        for (const filePath of files) {
            try {
                fs.unlinkSync(filePath);
                deletedCount++;
            } catch (error) {
                if (verbose) {
                    console.log(chalk.yellow(`      Warning: Could not delete ${path.basename(filePath)}`));
                }
            }
        }

        // Remove empty directory
        try {
            const remaining = fs.readdirSync(videoOutputDir);
            if (remaining.length === 0) {
                fs.rmdirSync(videoOutputDir);
            }
        } catch (error) {
            // Ignore directory removal errors
        }
    }

    return {
        success: failCount === 0,
        uploaded: successCount,
        failed: failCount,
        deleted: deletedCount,
        folderId: videoFolder.id,
        folderName: videoName
    };
}

/**
 * Initialize Google Drive uploader
 */
async function initDriveUploader(credentialsPath) {
    const credentials = loadCredentials(credentialsPath);
    const auth = await authorize(credentials);

    return {
        auth,
        credentials,

        async uploadVideoFrames(videoOutputDir, parentFolderId, options) {
            return uploadVideoFrames(auth, videoOutputDir, parentFolderId, options);
        },

        async createFolder(folderName, parentFolderId) {
            return createFolder(auth, folderName, parentFolderId);
        },

        async getOrCreateFolder(folderName, parentFolderId) {
            return getOrCreateFolder(auth, folderName, parentFolderId);
        }
    };
}

/**
 * Upload all video folders to Google Drive
 */
async function uploadAllToGoogleDrive(outputDir, credentialsPath, folderId, options = {}) {
    const { deleteAfterUpload = false, verbose = false, concurrency = 10 } = options;

    console.log(chalk.blue('\n☁️  Google Drive Upload'));
    console.log(chalk.blue('═══════════════════════════════════════════════════════════'));

    // Initialize uploader
    const spinner = ora('Connecting to Google Drive...').start();

    let uploader;
    try {
        uploader = await initDriveUploader(credentialsPath);
        spinner.succeed('Connected to Google Drive');
    } catch (error) {
        spinner.fail(`Failed to connect to Google Drive: ${error.message}`);
        return { success: false, error: error.message };
    }

    // Get list of video folders
    const videoDirs = fs.readdirSync(outputDir)
        .map(name => path.join(outputDir, name))
        .filter(p => fs.statSync(p).isDirectory());

    if (videoDirs.length === 0) {
        console.log(chalk.yellow('⚠ No video folders found to upload'));
        return { success: true, uploaded: 0 };
    }

    console.log(chalk.gray(`   Found ${videoDirs.length} video folder(s) to upload\n`));

    let totalUploaded = 0;
    let totalFailed = 0;
    let totalDeleted = 0;
    const uploadStartTime = Date.now();

    for (let i = 0; i < videoDirs.length; i++) {
        const videoDir = videoDirs[i];
        const videoName = path.basename(videoDir);

        const uploadSpinner = ora({
            text: `[${i + 1}/${videoDirs.length}] Uploading ${videoName}...`,
            color: 'cyan'
        }).start();

        try {
            const result = await uploader.uploadVideoFrames(videoDir, folderId, {
                deleteAfterUpload,
                verbose,
                concurrency
            });

            if (result.success) {
                uploadSpinner.succeed(
                    chalk.green(`[${i + 1}/${videoDirs.length}] ${videoName}: ${result.uploaded} files uploaded`) +
                    (deleteAfterUpload ? chalk.gray(` (${result.deleted} deleted locally)`) : '')
                );
                totalUploaded += result.uploaded;
                totalDeleted += result.deleted;
            } else {
                uploadSpinner.warn(
                    chalk.yellow(`[${i + 1}/${videoDirs.length}] ${videoName}: ${result.uploaded} uploaded, ${result.failed} failed`)
                );
                totalUploaded += result.uploaded;
                totalFailed += result.failed;
            }
        } catch (error) {
            uploadSpinner.fail(chalk.red(`[${i + 1}/${videoDirs.length}] ${videoName}: ${error.message}`));
            totalFailed++;
        }
    }

    const uploadTime = ((Date.now() - uploadStartTime) / 1000).toFixed(2);

    // Upload summary
    console.log(chalk.blue('\n☁️  Upload Summary'));
    console.log(chalk.blue('═══════════════════════════════════════════════════════════'));
    console.log(chalk.green(`   Files uploaded:   ${totalUploaded}`));
    if (totalFailed > 0) {
        console.log(chalk.red(`   Files failed:     ${totalFailed}`));
    }
    if (deleteAfterUpload) {
        console.log(chalk.gray(`   Local files deleted: ${totalDeleted}`));
    }
    console.log(chalk.gray(`   Upload time:      ${uploadTime}s`));
    console.log(chalk.gray(`   Drive folder ID:  ${folderId}`));
    console.log('');

    if (totalFailed === 0) {
        console.log(chalk.green('✔ All files uploaded successfully!'));
    } else {
        console.log(chalk.yellow(`⚠ ${totalFailed} file(s) failed to upload`));
    }

    return {
        success: totalFailed === 0,
        uploaded: totalUploaded,
        failed: totalFailed,
        deleted: totalDeleted,
        time: uploadTime
    };
}

module.exports = {
    initDriveUploader,
    uploadAllToGoogleDrive,
    uploadVideoFrames,
    uploadFile,
    createFolder,
    getOrCreateFolder,
    authorize,
    loadCredentials
};
