export function galleryDlBin() {
  return process.env.GALLERY_DL_BIN || "gallery-dl";
}

export function ytDlpBin() {
  return process.env.YT_DLP_BIN || "yt-dlp";
}

export function youtubeCookiesFile() {
  return process.env.YOUTUBE_COOKIES_FILE || "";
}

export function ytDlpJsRuntime() {
  return process.env.YT_DLP_JS_RUNTIME || "";
}
