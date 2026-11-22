// Live recording of the canvas into MP4 or WebM with WebCodecs (Mediabunny). Adapted from None-Curve
// src/export/videoEncode.ts (codec choice, MP4 → WebM fallback, VP9 with alpha for a transparent background,
// bitrate from src/export/videoFormat.ts); the offline sound-driven render is left out. The take runs on its own
// clock at its frame rate: the page draws one frame for every tick (several per screen refresh at 90 fps, or one
// every other refresh at 30), each at that tick's time, and each becomes its own sample lasting one tick. No frame is
// ever repeated to fill a tick. When the encoder or the page falls behind, the take's clock waits for it (the video
// stays exact, it just ends up shorter than the wall-clock time) and catches up a few ticks a refresh.

import {
  BufferTarget,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
  type VideoCodec,
} from 'mediabunny'

export type VideoFormat = 'mp4' | 'webm'

const VIDEO_CODECS: Record<VideoFormat, VideoCodec[]> = {
  mp4: ['avc', 'hevc', 'av1', 'vp9'],
  webm: ['vp9', 'vp8', 'av1'],
}
export const VIDEO_MIMES: Record<VideoFormat, string> = { mp4: 'video/mp4', webm: 'video/webm' }

/** From None-Curve src/export/videoFormat.ts VIDEO_LIMITS. */
const BITRATE = { bitsPerPixel: 4.5, referenceFps: 30, min: 2_000_000, max: 12_000_000 } as const
/** Samples waiting for the encoder at most; more and the take's clock waits. */
const MAX_QUEUE = 8

/** Video bits per second for a frame size and rate (None-Curve videoFormat.ts videoBitrate). */
export function videoBitrate(width: number, height: number, fps: number): number {
  const bits = Math.round(width * height * BITRATE.bitsPerPixel * (fps / BITRATE.referenceFps))
  return Math.min(BITRATE.max, Math.max(BITRATE.min, bits))
}

/** A video codec the browser can encode at this size, in `format` or else the other format; null for none. */
async function chooseFormat(format: VideoFormat, width: number, height: number) {
  for (const candidate of format === 'mp4' ? (['mp4', 'webm'] as const) : (['webm', 'mp4'] as const)) {
    const codec = await getFirstEncodableVideoCodec(VIDEO_CODECS[candidate], { width, height })
    if (codec) return { format: candidate, codec }
  }
  return null
}

export interface RecordResult {
  blob: Blob
  format: VideoFormat
  fellBack: boolean
  durationMs: number
  /** Frames in the file, each drawn on its own. */
  frames: number
}

export class LiveRecorder {
  private output: Output
  private source: VideoSampleSource
  private canvas: HTMLCanvasElement
  private fps: number
  /** Ticks captured so far: the next sample's tick. */
  ticks = 0
  private queue = 0
  private chain: Promise<void> = Promise.resolve()
  private failed: unknown = null
  readonly format: VideoFormat
  readonly fellBack: boolean

  private constructor(
    canvas: HTMLCanvasElement,
    fps: number,
    output: Output,
    source: VideoSampleSource,
    format: VideoFormat,
    fellBack: boolean,
  ) {
    this.canvas = canvas
    this.fps = fps
    this.output = output
    this.source = source
    this.format = format
    this.fellBack = fellBack
  }

  /** Opens a take: `alpha` keeps the transparency (WebM with VP9 only). */
  static async start(
    canvas: HTMLCanvasElement,
    fps: number,
    format: VideoFormat,
    alpha: boolean,
  ): Promise<LiveRecorder> {
    if (typeof VideoEncoder === 'undefined') throw new Error('This browser cannot encode video (no WebCodecs).')
    const { width, height } = canvas
    const chosen = alpha
      ? (await getFirstEncodableVideoCodec(['vp9'], { width, height }))
        ? { format: 'webm' as const, codec: 'vp9' as const }
        : null
      : await chooseFormat(format, width, height)
    if (!chosen)
      throw new Error(alpha ? 'This browser cannot encode a transparent video.' : 'This browser cannot encode video.')
    const output = new Output({
      format: chosen.format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
      target: new BufferTarget(),
    })
    const source = new VideoSampleSource({
      codec: chosen.codec,
      bitrate: videoBitrate(width, height, fps),
      ...(alpha ? { alpha: 'keep' as const } : {}),
    })
    output.addVideoTrack(source, { frameRate: fps })
    await output.start()
    return new LiveRecorder(canvas, fps, output, source, chosen.format, chosen.format !== format)
  }

  /** True while the encoder has as much waiting as it takes: draw no further tick until it catches up. */
  get busy(): boolean {
    return this.queue >= MAX_QUEUE || this.failed !== null
  }

  /** Called right after the canvas drew tick `ticks`: that frame becomes the next sample, one tick long. */
  capture(): void {
    if (this.failed) return
    const tick = this.ticks
    let frame: VideoFrame | null = null
    let sample: VideoSample
    try {
      frame = new VideoFrame(this.canvas, { timestamp: Math.round((tick / this.fps) * 1e6) })
      sample = new VideoSample(frame, { timestamp: tick / this.fps, duration: 1 / this.fps })
    } catch (error) {
      // The take fails as a whole (busy turns true, stop() reports it); the frame loop keeps running.
      frame?.close()
      this.failed = error
      return
    }
    this.ticks++
    this.queue++
    this.chain = this.chain
      .then(() => this.source.add(sample))
      .catch((error) => {
        this.failed ??= error
      })
      .finally(() => {
        sample.close()
        frame.close()
        this.queue--
      })
  }

  /** Ends the take after the ticks captured so far and returns the file. */
  async stop(): Promise<RecordResult> {
    await this.chain
    if (!this.failed && this.ticks === 0) this.failed = new Error('Nothing was recorded.')
    if (this.failed) {
      await this.output.cancel().catch(() => {})
      throw this.failed instanceof Error ? this.failed : new Error(String(this.failed))
    }
    this.source.close()
    await this.output.finalize()
    const buffer = (this.output.target as BufferTarget).buffer
    if (!buffer) throw new Error('The video could not be written.')
    return {
      blob: new Blob([buffer], { type: VIDEO_MIMES[this.format] }),
      format: this.format,
      fellBack: this.fellBack,
      durationMs: (this.ticks / this.fps) * 1000,
      frames: this.ticks,
    }
  }

  async cancel(): Promise<void> {
    await this.chain
    await this.output.cancel().catch(() => {})
  }
}
