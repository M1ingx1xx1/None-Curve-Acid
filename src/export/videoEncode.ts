// Live recording of the canvas into MP4 or WebM with WebCodecs (Mediabunny). Adapted from None-Curve
// src/export/videoEncode.ts (codec choice, MP4 → WebM fallback, VP9 with alpha for a transparent background,
// bitrate from src/export/videoFormat.ts); the offline sound-driven render is left out. Frames are taken on a fixed
// clock at the take's frame rate as the canvas draws: each sample is captured right after the frame it shows, stamped
// with its tick, and lasts until the next sample, so the file is exactly as long as the take. When the encoder falls
// behind, a tick is skipped and the sample before it lasts longer instead.

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
/** Samples waiting for the encoder at most; more and the tick is skipped. */
const MAX_QUEUE = 6

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

/**
 * The tick a sample captured `elapsedMs` into the take starts on: null when the clock has not reached `nextTick` yet.
 * The first sample starts the file (tick 0); later ones start on their own tick, and the sample before stretches to
 * meet them. Pure, for the tests.
 */
export function nextSample(elapsedMs: number, nextTick: number, fps: number): { tick: number; after: number } | null {
  const tick = Math.floor((elapsedMs * fps) / 1000)
  if (tick < nextTick) return null
  const start = nextTick === 0 ? 0 : tick
  return { tick: start, after: tick + 1 }
}

export interface RecordResult {
  blob: Blob
  format: VideoFormat
  fellBack: boolean
  durationMs: number
  /** Ticks that got no frame of their own (the one before was held longer). */
  dropped: number
}

export class LiveRecorder {
  private output: Output
  private source: VideoSampleSource
  private canvas: HTMLCanvasElement
  private fps: number
  private nextTick = 0
  private dropped = 0
  /** The sample captured last, waiting for the next one to set how long it lasts. */
  private held: { frame: VideoFrame; tick: number } | null = null
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

  /** Called right after the canvas drew a frame, `elapsedMs` into the take. */
  frame(elapsedMs: number): void {
    if (this.failed) return
    const plan = nextSample(elapsedMs, this.nextTick, this.fps)
    if (!plan) return
    if (this.queue >= MAX_QUEUE) return
    this.dropped += plan.tick - this.nextTick
    const frame = new VideoFrame(this.canvas, { timestamp: Math.round((plan.tick / this.fps) * 1e6) })
    this.release(plan.tick)
    this.held = { frame, tick: plan.tick }
    this.nextTick = plan.after
  }

  /** Sends the held sample, lasting until `untilTick`. */
  private release(untilTick: number): void {
    const held = this.held
    if (!held) return
    this.held = null
    const sample = new VideoSample(held.frame, {
      timestamp: held.tick / this.fps,
      duration: Math.max(1, untilTick - held.tick) / this.fps,
    })
    this.queue++
    this.chain = this.chain
      .then(() => this.source.add(sample))
      .catch((error) => {
        this.failed ??= error
      })
      .finally(() => {
        sample.close()
        held.frame.close()
        this.queue--
      })
  }

  /** Ends the take at `elapsedMs` and returns the file. */
  async stop(elapsedMs: number): Promise<RecordResult> {
    const end = Math.max(1, Math.round((elapsedMs * this.fps) / 1000))
    // A sample taken on the stop's own tick would run past the end: the one before it already lasts until then.
    if (this.held && this.held.tick >= end && this.held.tick > 0) {
      this.held.frame.close()
      this.held = null
    }
    if (this.held) this.release(Math.max(end, this.held.tick + 1))
    await this.chain
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
      durationMs: (end / this.fps) * 1000,
      dropped: this.dropped,
    }
  }

  async cancel(): Promise<void> {
    this.held?.frame.close()
    this.held = null
    await this.chain
    await this.output.cancel().catch(() => {})
  }
}
