# AutoCompress (Vencord Plugin)
- AutoCompress is a Vencord plugin that automatically compresses videos and other applicable media upon attempted send that exceed a configurable size limit, reducing them to a specified target size

## Features
- customizable compression settings, target file size, compression thresholds, etc.

## How It Works
- works via reencoding media with ffmpeg 

## Installation
- https://docs.vencord.dev/installing/custom-plugins/

## Usage
- drag/drop, and paste are currently supported
- applicable files above the size set in settings are compressed to fit under size limit in settings upon attempted upload

## Notes
- requires [ffmpeg](https://github.com/FFmpeg/FFmpeg) (and ffprobe), plugin should automatically resolve binaries - if not, set a path in the plugin settings
- set a limit a bit below your ideal size
- ensure you set a realistic time limit 
- lower resolution scaling can help encoding speed & artifacting 
- ffmpeg will likely utilize the majority of your cpu when compressing as this plugin currently only does software encoding, hardware encoding may happen later if i get aroudn to it