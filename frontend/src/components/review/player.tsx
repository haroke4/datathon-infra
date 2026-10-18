import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from 'react'
import {
  Expand,
  FastForward,
  LoaderCircle,
  Pause,
  Play,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatTime } from '@/lib/format-time'
import type { Annotation, Violation } from '@/lib/types'

export type PlayerHandle = { seek: (seconds: number) => void }

// Range colours on the timeline: the one under the playhead is solid.
const RANGE_COLOR = '#eb9b9b'
const ACTIVE_RANGE_COLOR = 'var(--danger)'

const SKIP_MS = 1000
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2

type Props = {
  ref: Ref<PlayerHandle>
  videoUrl: string | null
  duration: number
  violations: Violation[]
  annotations: Annotation[]
  initialTime: number
  // Glide to the first violation once the media is ready, without playing.
  autoSkip: boolean
  onTimeChange: (seconds: number) => void
}

export function Player({
  ref,
  videoUrl,
  duration,
  violations,
  annotations,
  initialTime,
  autoSkip,
  onTimeChange,
}: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const player = useRef<HTMLElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [playPending, setPlayPending] = useState(false)
  const [mediaReady, setMediaReady] = useState(!videoUrl)
  const [buffering, setBuffering] = useState(false)
  const [mediaError, setMediaError] = useState(false)
  const [notice, setNotice] = useState('')
  const [currentTime, setCurrentTime] = useState(initialTime)
  const timeRef = useRef(initialTime)
  const virtualClock = useRef({ time: initialTime, at: 0 })
  const [mediaDuration, setMediaDuration] = useState(duration)
  const [mediaSize, setMediaSize] = useState({ width: 16, height: 9 })
  const [stageSize, setStageSize] = useState({ width: 1, height: 1 })
  const [skipTarget, setSkipTarget] = useState<number | null>(null)
  const skipFrame = useRef(0)
  const length = Math.max(0.1, mediaDuration)

  // Each violation spans the time its detection box is on screen.
  const ranges = useMemo(
    () =>
      violations.map((item, index) => {
        const events = annotations.filter((a) => a.violation_index === index)
        return events.length
          ? {
              index,
              start: Math.min(...events.map((a) => a.start_sec)),
              end: Math.max(...events.map((a) => a.end_sec)),
            }
          : { index, start: item.timecode_sec, end: item.timecode_sec }
      }),
    [violations, annotations]
  )
  const firstViolation = ranges.length
    ? Math.min(...ranges.map((range) => range.start))
    : null

  const updateTime = useCallback(
    (seconds: number) => {
      timeRef.current = seconds
      setCurrentTime(seconds)
      onTimeChange(seconds)
    },
    [onTimeChange]
  )
  const moveTo = useCallback(
    (seconds: number) => {
      const next = Math.min(length, Math.max(0, seconds))
      virtualClock.current = { time: next, at: performance.now() }
      if (video.current?.readyState) video.current.currentTime = next
      updateTime(next)
    },
    [length, updateTime]
  )
  const stopSkip = useCallback(() => {
    cancelAnimationFrame(skipFrame.current)
    skipFrame.current = 0
    setSkipTarget(null)
  }, [])
  const seek = useCallback(
    (seconds: number) => {
      stopSkip()
      moveTo(seconds)
    },
    [moveTo, stopSkip]
  )
  useImperativeHandle(ref, () => ({ seek }), [seek])
  useEffect(() => () => cancelAnimationFrame(skipFrame.current), [])

  // Only this component updates during playback; history and event cards stay still.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let lastUpdate = 0
    const tick = (now: number) => {
      if (now - lastUpdate >= 80) {
        const next = video.current
          ? video.current.currentTime
          : Math.min(
              length,
              virtualClock.current.time + (now - virtualClock.current.at) / 1000
            )
        updateTime(next)
        lastUpdate = now
        if (!video.current && next >= length) {
          setPlaying(false)
          return
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, length, updateTime])

  useEffect(() => {
    if (!stage.current) return
    const observer = new ResizeObserver(([entry]) =>
      setStageSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    )
    observer.observe(stage.current)
    return () => observer.disconnect()
  }, [])

  const play = async () => {
    setNotice('')
    if (!video.current) {
      virtualClock.current = { time: timeRef.current, at: performance.now() }
      setPlaying(true)
      return
    }
    setPlayPending(true)
    try {
      await video.current.play()
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError')
        setNotice('Не удалось начать воспроизведение. Попробуйте ещё раз.')
    } finally {
      setPlayPending(false)
    }
  }
  const toggle = async () => {
    if (mediaError) return
    if (skipFrame.current) {
      // Stop where the playhead is, not at the last throttled video seek.
      stopSkip()
      moveTo(timeRef.current)
      return
    }
    if (playPending) {
      video.current?.pause()
      setPlayPending(false)
      setBuffering(false)
      return
    }
    const paused = video.current ? video.current.paused : !playing
    if (!paused) {
      if (video.current) video.current.pause()
      else setPlaying(false)
      return
    }
    if (timeRef.current >= length) seek(0)
    await play()
  }
  // Glide the playhead to the first violation, optionally playing from there.
  const skipTo = (target: number, andPlay: boolean) => {
    setNotice('')
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      moveTo(target)
      if (andPlay) void play()
      return
    }
    const from = timeRef.current
    const started = performance.now()
    let lastSeek = 0
    setSkipTarget(target)
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / SKIP_MS)
      if (progress === 1) {
        skipFrame.current = 0
        setSkipTarget(null)
        moveTo(target)
        if (andPlay) void play()
        return
      }
      const time = from + (target - from) * easeInOutCubic(progress)
      const media = video.current
      // Seek the real video less often than we draw, so frames have time to decode.
      if (media?.readyState && now - lastSeek >= 120) {
        if (media.fastSeek) media.fastSeek(time)
        else media.currentTime = time
        lastSeek = now
      }
      updateTime(time)
      skipFrame.current = requestAnimationFrame(step)
    }
    skipFrame.current = requestAnimationFrame(step)
  }
  const hasSkipTarget = firstViolation !== null && firstViolation > 0.5
  const canSkip =
    hasSkipTarget &&
    currentTime < 0.05 &&
    !playing &&
    !playPending &&
    skipTarget === null
  const activateStage = () => {
    if (canSkip && !mediaError) skipTo(firstViolation, true)
    else void toggle()
  }
  const autoSkipped = useRef(false)
  // Runs once when the media becomes ready; skipTo is read from that render on purpose.
  useEffect(() => {
    if (!autoSkip || autoSkipped.current || !mediaReady || mediaError) return
    autoSkipped.current = true
    if (hasSkipTarget && timeRef.current < 0.05) skipTo(firstViolation, false)
    // An interrupted glide (StrictMode remount, media error) may start again.
    return () => {
      if (!skipFrame.current) return
      stopSkip()
      autoSkipped.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSkip, mediaReady, mediaError, hasSkipTarget, firstViolation, stopSkip])
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await player.current?.requestFullscreen()
    } catch {
      setNotice('Полноэкранный режим недоступен в этом браузере.')
    }
  }
  const visible = annotations.filter(
    (a) => currentTime >= a.start_sec && currentTime <= a.end_sec
  )
  const scale = Math.min(
    stageSize.width / mediaSize.width,
    stageSize.height / mediaSize.height
  )
  const frameWidth = videoUrl ? mediaSize.width * scale : stageSize.width
  const frameHeight = videoUrl ? mediaSize.height * scale : stageSize.height
  const activeRange = ranges.find(
    (range) => currentTime >= range.start && currentTime <= range.end
  )
  // Ranges are a background layer of the slider itself, so the thumb stays on
  // top and clicks anywhere on the track still seek precisely.
  const rangeLayer = ranges.length
    ? `linear-gradient(to right, ${ranges
        .slice()
        .sort((a, b) => a.start - b.start)
        .map((range) => {
          const from = (range.start / length) * 100
          const to = Math.min(100, (range.end / length) * 100)
          const color =
            range === activeRange ? ACTIVE_RANGE_COLOR : RANGE_COLOR
          return `transparent ${from}%, ${color} ${from}%, ${color} max(${to}%, calc(${from}% + 4px)), transparent max(${to}%, calc(${from}% + 4px))`
        })
        .join(', ')})`
    : 'none'

  return (
    <section className="player" ref={player} aria-label="Видеоплеер">
      <div
        className={`video-stage ${skipTarget !== null ? 'is-skipping' : ''}`}
        ref={stage}
        role="button"
        tabIndex={mediaError ? -1 : 0}
        aria-disabled={mediaError}
        aria-label={
          mediaError
            ? 'Видео недоступно'
            : skipTarget !== null
              ? 'Остановить перемотку'
              : playing
                ? 'Приостановить видео'
                : canSkip
                  ? 'Перейти к первому возможному нарушению'
                  : 'Воспроизвести видео'
        }
        onClick={activateStage}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault()
            activateStage()
          }
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault()
            seek(timeRef.current + (event.key === 'ArrowRight' ? 5 : -5))
          }
        }}
      >
        {videoUrl ? (
          <video
            ref={video}
            src={videoUrl}
            playsInline
            preload="auto"
            onLoadedMetadata={(event) => {
              const media = event.currentTarget
              setMediaSize({
                width: media.videoWidth || 16,
                height: media.videoHeight || 9,
              })
              if (Number.isFinite(media.duration) && media.duration > 0)
                setMediaDuration(media.duration)
              if (timeRef.current > 0) media.currentTime = timeRef.current
            }}
            onLoadedData={() => setMediaReady(true)}
            onTimeUpdate={(event) => {
              if (!skipFrame.current)
                updateTime(event.currentTarget.currentTime)
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onWaiting={() => setBuffering(true)}
            onPlaying={() => setBuffering(false)}
            onCanPlay={() => setBuffering(false)}
            onEnded={() => {
              setPlaying(false)
              updateTime(length)
            }}
            onError={() => {
              setMediaError(true)
              setPlaying(false)
              setBuffering(false)
              setPlayPending(false)
            }}
            aria-label="Видеозапись"
          />
        ) : (
          <div className="demo-placeholder">
            <span className="demo-play">
              <Play size={29} strokeWidth={1.5} />
            </span>
            <strong>Демонстрационный плеер</strong>
            <span>Исходное видео не загружено</span>
          </div>
        )}
        {!mediaReady && !mediaError && (
          <div className="media-loading" role="status">
            <LoaderCircle className="animate-spin" size={25} />
            <span>Загружаем видео…</span>
          </div>
        )}
        {mediaError && (
          <div className="media-error" role="status">
            <TriangleAlert size={26} />
            <strong>Видео не воспроизводится</strong>
            <span>
              Этот кодек не поддерживается браузером.
              <br />
              Попробуйте MP4 с кодеком H.264.
            </span>
          </div>
        )}
        {skipTarget !== null && (
          <span className="skip-state" role="status">
            <FastForward size={14} />
            <span className="sr-only">Перемотка до </span>
            {formatTime(skipTarget)}
          </span>
        )}
        {buffering && mediaReady && !mediaError && skipTarget === null && (
          <span className="buffering-state" role="status">
            <LoaderCircle className="animate-spin" size={14} /> Буферизация…
          </span>
        )}
        {!mediaError && visible.length > 0 && (
          <div
            className="frame-overlay"
            style={{ width: frameWidth, height: frameHeight }}
          >
            {visible.map((annotation) => (
              <div
                key={annotation.violation_index}
                className="detection-box"
                style={{
                  left: `${annotation.box.x * 100}%`,
                  top: `${annotation.box.y * 100}%`,
                  width: `${annotation.box.width * 100}%`,
                  height: `${annotation.box.height * 100}%`,
                }}
              >
                <span
                  className={`detection-label ${annotation.box.x > 0.5 ? 'align-left' : ''}`}
                >
                  {violations[annotation.violation_index]?.type}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="player-controls">
        <Button
          variant="ghost"
          size="icon"
          className="play-control"
          onClick={() => void toggle()}
          disabled={mediaError}
          aria-label={
            playPending
              ? 'Отменить воспроизведение'
              : playing
                ? 'Пауза'
                : 'Воспроизвести'
          }
          title="Пробел — воспроизведение / пауза"
        >
          {playPending ? (
            <LoaderCircle className="animate-spin" />
          ) : playing ? (
            <Pause />
          ) : (
            <Play />
          )}
        </Button>
        <span className="time-display">{formatTime(currentTime)}</span>
        <div className="timeline">
          <input
            type="range"
            min="0"
            max={length}
            step="0.1"
            value={Math.min(currentTime, length)}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label="Таймлайн видео"
            aria-valuetext={`${formatTime(currentTime)} из ${formatTime(length)}${
              activeRange ? `, возможное нарушение ${activeRange.index + 1}` : ''
            }`}
            title={activeRange ? violations[activeRange.index]?.type : undefined}
            style={
              {
                '--progress': `${(currentTime / length) * 100}%`,
                '--ranges': rangeLayer,
              } as CSSProperties
            }
          />
        </div>
        <span className="time-display duration-display">
          {formatTime(length)}
        </span>
        {document.fullscreenEnabled && (
          <Button
            variant="ghost"
            size="icon"
            className="fullscreen-control"
            onClick={() => void fullscreen()}
            aria-label="На весь экран"
            title="На весь экран"
          >
            <Expand size={17} />
          </Button>
        )}
      </div>
      {notice && (
        <p className="player-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  )
}
