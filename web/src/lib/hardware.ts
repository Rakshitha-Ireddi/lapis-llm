/** Hardware profiles used by the "Will it run?" calculator and the demo fleet. */

import type { Platform, RuntimeKind } from "./types";

export interface HardwareProfile {
  id: string;
  label: string;
  example: string;
  platform: Platform;
  accelerator: string;
  /** Memory a model can use: VRAM for discrete GPUs, unified memory otherwise. */
  memoryGib: number;
  unified: boolean;
  /** Memory taken before any model loads (desktop, OS). */
  baseUsedGib: number;
  runtimes: RuntimeKind[];
  sweetSpot: string;
}

export const PROFILES: HardwareProfile[] = [
  {
    id: "gaming-pc",
    label: "Older gaming PC",
    example: "RTX 3070 · 8 GB",
    platform: "windows",
    accelerator: "GeForce RTX 3070",
    memoryGib: 8,
    unified: false,
    baseUsedGib: 0.6,
    runtimes: ["llama.cpp"],
    sweetSpot: "7B–8B chat & code models",
  },
  {
    id: "gaming-pc-16",
    label: "Newer gaming PC",
    example: "RTX 4070 Ti SUPER · 16 GB",
    platform: "windows",
    accelerator: "GeForce RTX 4070 Ti SUPER",
    memoryGib: 16,
    unified: false,
    baseUsedGib: 0.8,
    runtimes: ["llama.cpp"],
    sweetSpot: "up to ~14B, long context",
  },
  {
    id: "linux-box",
    label: "Linux workstation",
    example: "RTX 3090 · 24 GB",
    platform: "linux",
    accelerator: "GeForce RTX 3090",
    memoryGib: 24,
    unified: false,
    baseUsedGib: 0.4,
    runtimes: ["vllm", "llama.cpp"],
    sweetSpot: "up to ~32B with vLLM",
  },
  {
    id: "macbook",
    label: "Apple Silicon Mac",
    example: "M3 Pro · 36 GB unified",
    platform: "macos",
    accelerator: "Apple M3 Pro",
    memoryGib: 36,
    unified: true,
    baseUsedGib: 9,
    runtimes: ["mlx", "llama.cpp"],
    sweetSpot: "7B–24B, quiet & efficient",
  },
  {
    id: "spark",
    label: "DGX Spark class",
    example: "GB10 · 128 GB unified",
    platform: "linux",
    accelerator: "NVIDIA GB10",
    memoryGib: 128,
    unified: true,
    baseUsedGib: 6,
    runtimes: ["vllm", "llama.cpp"],
    sweetSpot: "70B and up",
  },
];

export function profile(id: string): HardwareProfile {
  const found = PROFILES.find((p) => p.id === id);
  if (!found) throw new Error(`unknown hardware profile ${id}`);
  return found;
}

export interface ModelPreset {
  label: string;
  paramsB: number;
}

export const MODEL_PRESETS: ModelPreset[] = [
  { label: "Embeddings (0.1B)", paramsB: 0.14 },
  { label: "Llama 3.2 3B", paramsB: 3.2 },
  { label: "Llama 3.1 8B", paramsB: 8 },
  { label: "Gemma 2 9B", paramsB: 9.2 },
  { label: "Qwen2.5 14B", paramsB: 14.7 },
  { label: "Mistral Small 24B", paramsB: 23.6 },
  { label: "Qwen2.5 32B", paramsB: 32.5 },
  { label: "Llama 3.3 70B", paramsB: 70.6 },
];
