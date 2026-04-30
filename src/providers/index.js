import { bilibiliProvider } from "./bilibili.js";
import { pixivProvider } from "./pixiv.js";
import { youtubeProvider } from "./youtube.js";

export const providers = [
  bilibiliProvider,
  youtubeProvider,
  pixivProvider,
];

export function resolveProvider(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("请输入完整的网址，例如 https://www.bilibili.com/video/BV...");
  }

  const provider = providers.find((item) => item.matches(parsed));
  if (!provider) {
    throw new Error(`暂不支持 ${parsed.hostname}，可以在 src/providers 里新增处理器。`);
  }

  return provider;
}
