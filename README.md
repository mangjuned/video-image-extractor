# Video Frame Extractor

A powerful Node.js CLI tool that batch processes videos to extract every individual frame as high-quality PNG images using system-installed FFmpeg.

## Features

- 🎬 **Batch Processing** - Process multiple videos in one command
- ⚡ **Parallel Processing** - Process multiple videos simultaneously for faster extraction
- 📥 **URL Downloads** - Download videos from URLs (supports YouTube, Vimeo, etc. via yt-dlp)
- ☁️ **Google Drive Upload** - Upload frames directly to Google Drive and optionally delete local files
- 📁 **Organized Output** - Each video gets its own subfolder
- 🖼️ **High-Quality PNGs** - Configurable compression levels
- 🔢 **Sequential Naming** - Frames are named sequentially (e.g., `frame_000001.png`)
- 📹 **Multiple Formats** - Supports MP4, AVI, MKV, MOV, WebM, and more
- ⏱️ **Time Range Selection** - Extract frames from specific time ranges
- 🎯 **FPS Control** - Extract at specific frame rates
- 🔍 **Recursive Scanning** - Finds videos in subdirectories
- 📊 **Progress Tracking** - Visual progress with spinners and summaries

## Prerequisites

- **Node.js** (v14.0.0 or higher)
- **FFmpeg** installed and available in PATH

### Installing FFmpeg

**macOS:**
```bash
brew install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install ffmpeg
```

**Windows:**
Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH.

### Installing yt-dlp (Optional, for URL downloads)

**macOS:**
```bash
brew install yt-dlp
```

**Ubuntu/Debian:**
```bash
sudo apt install yt-dlp
```

**pip:**
```bash
pip install yt-dlp
```

## Installation

### Local Installation

```bash
# Clone or download the project
cd video-frame-extractor

# Install dependencies
npm install

# Option 1: Run directly
node src/index.js -i ./videos -o ./output

# Option 2: Link globally
npm link
vfe -i ./videos -o ./output
```

### Global Installation (if published to npm)

```bash
npm install -g video-frame-extractor
```

### Google Colab Installation

In Google Colab, you can save frames directly to Google Drive without API credentials!

**Important:** You need Node.js 16+ for this tool. Colab's default is too old.

**Quick Start:**
```python
# Mount Google Drive
from google.colab import drive
drive.mount('/content/drive')

# Install Node.js 18 (required!)
!curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
!sudo apt-get install -y nodejs ffmpeg
!pip install -q yt-dlp

# Clone and setup
!git clone https://github.com/YOUR_USERNAME/video-frame-extractor.git
%cd video-frame-extractor
!npm install

# Extract frames → Save directly to Google Drive!
!node src/index.js -i /content/videos -o /content/drive/MyDrive/frames --fps 1
```

📓 **See `colab_notebook.ipynb` for a complete interactive notebook!**

## Usage

### Basic Usage

```bash
# Extract all frames from videos in a directory
vfe -i /path/to/videos -o /path/to/output

# Or use the full command name
video-frame-extractor -i /path/to/videos -o /path/to/output
```

### Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--input` | `-i` | Input directory containing videos | |
| `--urls` | `-u` | Text file containing video URLs | |
| `--output` | `-o` | Output directory for frames | **Required** |
| `--download-dir` | `-d` | Directory for downloaded videos | `./downloads` |
| `--quality` | `-q` | PNG compression (0=best, 9=fastest) | `2` |
| `--format` | `-f` | Output filename pattern | `frame_%06d.png` |
| `--extensions` | `-e` | Video extensions to process | `mp4,avi,mkv,mov,...` |
| `--fps` | | Extract at specific FPS | All frames |
| `--start` | | Start time (HH:MM:SS or seconds) | Beginning |
| `--end` | | End time (HH:MM:SS or seconds) | End |
| `--concurrency` | `-c` | Number of videos to process in parallel | `auto` (CPU cores/2) |
| `--keep-downloads` | | Keep downloaded videos after processing | `true` |
| `--upload-drive` | | Upload frames to Google Drive | `false` |
| `--drive-credentials` | | Path to Google service account JSON | |
| `--drive-folder` | | Google Drive folder ID to upload to | |
| `--delete-after-upload` | | Delete local files after upload | `false` |
| `--dry-run` | | Preview without extracting | `false` |
| `--verbose` | `-v` | Enable detailed output | `false` |
| `--help` | `-h` | Show help | |
| `--version` | `-V` | Show version | |

> **Note:** Either `--input` or `--urls` must be provided.

### Examples

```bash
# Extract all frames with best quality
vfe -i ./videos -o ./frames -q 0

# Extract at 1 frame per second
vfe -i ./videos -o ./frames --fps 1

# Extract frames from 10s to 30s of each video
vfe -i ./videos -o ./frames --start 10 --end 30

# Extract only from MP4 and MOV files
vfe -i ./videos -o ./frames -e mp4,mov

# Process 5 videos in parallel (for faster extraction)
vfe -i ./videos -o ./frames -c 5

# Process 8 videos in parallel with reduced quality for speed
vfe -i ./videos -o ./frames -c 8 -q 9

# Custom filename pattern (8 digits)
vfe -i ./videos -o ./frames -f "img_%08d.png"

# Preview what would be processed
vfe -i ./videos -o ./frames --dry-run

# Verbose mode for debugging
vfe -i ./videos -o ./frames -v

# ===== URL DOWNLOAD EXAMPLES =====

# Download videos from URLs and extract frames
vfe -u links.txt -o ./frames

# Download to specific directory
vfe -u links.txt -o ./frames -d ./my-videos

# Download and process with parallel extraction
vfe -u links.txt -o ./frames -c 5

# Preview URLs without downloading
vfe -u links.txt -o ./frames --dry-run
```

## URL File Format (links.txt)

Create a text file with one URL per line:

```text
# This is a comment (lines starting with # are ignored)
# Blank lines are also ignored

# Direct video URLs
https://example.com/video1.mp4
https://example.com/video2.mp4

# YouTube URLs (requires yt-dlp)
https://www.youtube.com/watch?v=VIDEO_ID

# Other supported sites (via yt-dlp)
https://vimeo.com/123456789
https://twitter.com/user/status/123456789
https://www.tiktok.com/@user/video/123456789
```

Supported URL types:
- **Direct video links** (`.mp4`, `.avi`, `.mkv`, etc.) - Downloaded directly
- **YouTube, Vimeo, Twitter, TikTok, etc.** - Requires yt-dlp installed


## Output Structure

```
output/
├── video1/
│   ├── frame_000001.png
│   ├── frame_000002.png
│   ├── frame_000003.png
│   └── ...
├── video2/
│   ├── frame_000001.png
│   ├── frame_000002.png
│   └── ...
└── video3/
    ├── frame_000001.png
    └── ...
```

## Quality Settings

The quality option `-q` controls PNG compression:

| Level | Description | File Size | Speed |
|-------|-------------|-----------|-------|
| 0 | Best quality | Largest | Slowest |
| 2 | High quality (default) | Large | Slow |
| 5 | Balanced | Medium | Medium |
| 9 | Fastest compression | Smallest | Fastest |

## Supported Video Formats

By default, the following formats are supported:
- MP4, AVI, MKV, MOV
- WMV, FLV, WebM
- M4V, MPEG, MPG

Add more formats using the `-e` option.

## Google Drive Upload

Upload extracted frames directly to Google Drive and optionally delete local files to save storage.

### Setup Google Drive API

1. **Create a Google Cloud Project**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project

2. **Enable Google Drive API**
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google Drive API" and enable it

3. **Create Service Account Credentials**
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "Service Account"
   - Fill in the details and create
   - Click on the service account, then "Keys" > "Add Key" > "Create new key" > JSON
   - Download the JSON file (this is your `--drive-credentials` file)

4. **Create and Share a Google Drive Folder**
   - Create a folder in Google Drive where frames will be uploaded
   - Right-click the folder > "Share"
   - Share with the service account email (found in the JSON file as `client_email`)
   - Give "Editor" permissions
   - Get the folder ID from the URL: `https://drive.google.com/drive/folders/FOLDER_ID_HERE`

### Usage Examples

```bash
# Extract frames and upload to Google Drive
vfe -i ./videos -o ./frames \
    --upload-drive \
    --drive-credentials ./credentials.json \
    --drive-folder "1ABC123xyz"

# Upload and delete local files after successful upload
vfe -i ./videos -o ./frames \
    --upload-drive \
    --drive-credentials ./credentials.json \
    --drive-folder "1ABC123xyz" \
    --delete-after-upload

# Full workflow: Download from URLs, extract frames, upload to Drive
vfe -u links.txt -o ./frames \
    --upload-drive \
    --drive-credentials ./credentials.json \
    --drive-folder "1ABC123xyz" \
    --delete-after-upload

# With parallel processing
vfe -i ./videos -o ./frames -c 5 \
    --upload-drive \
    --drive-credentials ./credentials.json \
    --drive-folder "1ABC123xyz"
```

### Google Drive Output Structure

```
Google Drive Folder (your --drive-folder)
├── video1/
│   ├── frame_000001.png
│   ├── frame_000002.png
│   └── ...
├── video2/
│   ├── frame_000001.png
│   └── ...
└── video3/
    └── ...
```

### Credentials File Format

The service account JSON file should look like this (see `credentials.example.json`):

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "your-service@your-project.iam.gserviceaccount.com",
  "client_id": "...",
  ...
}
```

## Performance Tips

1. **Parallel Processing** - Use `-c` to process multiple videos simultaneously
   - Auto mode uses half your CPU cores by default
   - For 10 videos, try `-c 5` or `-c 10` based on your system
   - More parallelism = faster overall, but uses more CPU/RAM
2. **SSD Storage** - Use SSD for output directory for faster writes
3. **Lower FPS** - Use `--fps 1` to extract fewer frames if you don't need every frame
4. **Time Range** - Use `--start` and `--end` to limit extraction
5. **Higher Compression** - Use `-q 9` for smaller files and faster processing
6. **Google Drive** - Use `--delete-after-upload` to save local storage

## Error Handling

- The tool validates FFmpeg installation before processing
- Failed videos are reported but don't stop batch processing
- Use `--verbose` to see detailed error messages
- Check that video files aren't corrupted

## License

MIT License
