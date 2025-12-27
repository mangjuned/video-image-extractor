# Video Frame Extractor

A powerful Node.js CLI tool that batch processes videos to extract every individual frame as high-quality PNG images using system-installed FFmpeg.

## Features

- 🎬 **Batch Processing** - Process multiple videos in one command
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
| `--input` | `-i` | Input directory containing videos | **Required** |
| `--output` | `-o` | Output directory for frames | **Required** |
| `--quality` | `-q` | PNG compression (0=best, 9=fastest) | `2` |
| `--format` | `-f` | Output filename pattern | `frame_%06d.png` |
| `--extensions` | `-e` | Video extensions to process | `mp4,avi,mkv,mov,...` |
| `--fps` | | Extract at specific FPS | All frames |
| `--start` | | Start time (HH:MM:SS or seconds) | Beginning |
| `--end` | | End time (HH:MM:SS or seconds) | End |
| `--dry-run` | | Preview without extracting | `false` |
| `--verbose` | `-v` | Enable detailed output | `false` |
| `--help` | `-h` | Show help | |
| `--version` | `-V` | Show version | |

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

# Custom filename pattern (8 digits)
vfe -i ./videos -o ./frames -f "img_%08d.png"

# Preview what would be processed
vfe -i ./videos -o ./frames --dry-run

# Verbose mode for debugging
vfe -i ./videos -o ./frames -v
```

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

## Performance Tips

1. **SSD Storage** - Use SSD for output directory for faster writes
2. **Lower FPS** - Use `--fps 1` to extract fewer frames if you don't need every frame
3. **Time Range** - Use `--start` and `--end` to limit extraction
4. **Higher Compression** - Use `-q 9` for smaller files and faster processing

## Error Handling

- The tool validates FFmpeg installation before processing
- Failed videos are reported but don't stop batch processing
- Use `--verbose` to see detailed error messages
- Check that video files aren't corrupted

## License

MIT License
