/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import {
    DraftType,
    SelectedChannelStore,
    showToast,
    Toasts,
    UploadManager,
} from "@webpack/common";

type ProcessResult =
    | { success: true; file: File; size: number; }
    | { success: false; fileName: string; error: string; };

const Native = VencordNative.pluginHelpers.AutoCompress as PluginNative<
    typeof import("./native")
>;
const FORMATS = new Set([
    "video/mp4",
    "video/quicktime",
    "video/x-msvideo",
    "video/x-matroska",
    "video/webm",
    "audio/mpeg",
    "audio/wav",
    "audio/flac",
]);

const settings = definePluginSettings({
    ffmpegTimeout: {
        type: OptionType.NUMBER,
        description: "Duration per file before compression aborted [seconds]",
        default: 10
    },
    ffmpegPath: {
        type: OptionType.STRING,
        description: "Path to ffmpeg binary (empty will attempt to resolve automatically)"
    },
    ffprobePath: {
        type: OptionType.STRING,
        description: "Path to ffprobe binary (empty will attempt to resolve automatically)"
    },
    compressionTarget: {
        type: OptionType.NUMBER,
        description: "File size to target with compression [mb]",
        default: 9,
    },
    compressionThreshold: {
        type: OptionType.NUMBER,
        description: "Maximum file size before compression is used [mb]",
        default: 10,
    },
    compressionPreset: {
        type: OptionType.SELECT,
        description: "Encoding speed (slower results in better quality at the same size)",
        options: [
            { label: "Fastest", value: "ultrafast" },
            { label: "Fast", value: "fast" },
            { label: "Medium (Balanced)", value: "medium", default: true },
            { label: "Slow", value: "slow" },
            { label: "Very Slow", value: "veryslow" },
        ],
    },
    maxResolution: {
        type: OptionType.SELECT,
        description:
            "Maximum resolution (downscaling MAY result in better quality with low bitrates)",
        options: [
            { label: "Keep Original", value: "original", default: true },
            { label: "1080p", value: "1080" },
            { label: "720p", value: "720" },
            { label: "480p", value: "480" },
        ],
    },
});

function isValid(files: FileList | undefined): files is FileList {
    return files !== undefined && files.length > 0;
}

async function validateBinaries() {
    // check that ffmpeg & ffprobe are found and reachable
    const validated = await Native.testBinaries(settings.store.ffmpegPath, settings.store.ffprobePath);
    if (!validated.success) {
        showNotification({
            title: "AutoCompress",
            body: `Failed validation with: ${validated}`,
            color: "#f04747",
            noPersist: false,
        });
        return false;
    }
    return true;
}

async function hookPaste(event: ClipboardEvent) {
    const files = event.clipboardData?.files;
    if (!isValid(files) || !(await validateBinaries())) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    await handleFiles(files);
}

async function hookDrop(event: DragEvent) {
    const files = event.dataTransfer?.files;
    if (!isValid(files) || !(await validateBinaries())) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    await handleFiles(files);
}

async function handleFiles(files: FileList) {

    const allFiles = Array.from(files);
    const compressibleFiles: File[] = [];
    const otherFiles: File[] = [];

    for (const file of allFiles) {
        const sizeMB = file.size / (1024 * 1024);
        if (FORMATS.has(file.type) && sizeMB > settings.store.compressionThreshold) {
            compressibleFiles.push(file);
            continue;
        }
        otherFiles.push(file);
    }
    const channelId = SelectedChannelStore.getChannelId();
    if (!channelId) {
        return;
    }
    UploadManager.clearAll(channelId, DraftType.ChannelMessage);

    // handles situation in which no compressible files are included
    if (compressibleFiles.length === 0) {
        if (otherFiles.length > 0) {
            UploadManager.addFiles({
                channelId,
                draftType: DraftType.ChannelMessage,
                files: otherFiles.map(file => ({ file, platform: 1 })),
                showLargeMessageDialog: false,
            });
        }
        return;
    }
    showToast(
        `Preparing to compress ${compressibleFiles.length}/${files.length} file(s)`,
        Toasts.Type.MESSAGE,
    );

    const results = await Promise.all(
        compressibleFiles.map(file => processFile(file)),
    );
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    const toUpload = [...successful.map(r => r.file), ...otherFiles];
    // slightly scary looking ternary that formats the output message
    const message = `Compressed ${successful.length}/${results.length} file(s)${failed.length > 0
        ? `\nFailed: ${failed.map(f => `${f.fileName} (${f.error})`).join(", ")}`
        : ""
        }`;

    if (toUpload.length > 0) {
        UploadManager.addFiles({
            channelId,
            draftType: DraftType.ChannelMessage,
            files: toUpload.map(file => ({ file, platform: 1 })),
            showLargeMessageDialog: false,
        });
    }

    const color =
        failed.length === 0
            ? "#43b581"
            : successful.length === 0
                ? "#f04747"
                : "#faa61a";

    showNotification({
        title: "AutoCompress",
        body: message,
        color: color,
        noPersist: false,
    });
}

async function hookDrag(e: DragEvent) {
    const types = e.dataTransfer?.types;
    if (types?.includes("Files")) {
        e.preventDefault();
        e.stopPropagation();
    }
}

async function processFile(file: File): Promise<ProcessResult> {
    try {
        const buffer = await file.arrayBuffer();
        const res = await Native.handleFile(
            new Uint8Array(buffer),
            file.name,
            settings.store.compressionTarget,
            settings.store.compressionPreset,
            settings.store.maxResolution,
            settings.store.ffmpegTimeout * 1000
        );

        if (!res.success) {
            return {
                success: false,
                fileName: file.name,
                error: res.error,
            };
        }

        const resArray = res.data;
        const compressedSizeMB = resArray.byteLength / (1024 * 1024);
        const wrapped = new Uint8Array(resArray);
        const compressedFile = new File([wrapped], file.name, { type: file.type });

        return {
            success: true,
            file: compressedFile,
            size: compressedSizeMB,
        };
    } catch (err) {
        return {
            success: false,
            fileName: file.name,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

export default definePlugin({
    name: "AutoCompress",
    description: "Automatically compress videos/audio to reach a target size",
    authors: [{ name: "dyn", id: 262458273247002636n }],
    settings,

    start() {
        document.addEventListener("drop", hookDrop, { capture: true });
        document.addEventListener("dragover", hookDrag, { capture: true });
        document.addEventListener("paste", hookPaste, { capture: true });
    },

    stop() {
        document.removeEventListener("drop", hookDrop, { capture: true });
        document.removeEventListener("dragover", hookDrag, { capture: true });
    },
});
