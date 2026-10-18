import { useCallback, useEffect, useRef, useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import {
  Check,
  ChevronDown,
  Clock3,
  LoaderCircle,
  PanelLeft,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { CheckTicker } from '@/components/review/check-ticker'
import { HistoryDrawer } from '@/components/review/history-drawer'
import {
  Result,
  type CompletedReview,
  type ReviewPosition,
} from '@/components/review/result'
import { api, isMock } from '@/lib/api'
import { listenForFileDrop } from '@/lib/file-drop'
import {
  readPreference,
  validateVideo,
  writePreference,
} from '@/lib/preferences'
import type { JobResult, JobSummary } from '@/lib/types'

const EMPTY_POSITION: ReviewPosition = { time: 0, selected: null }
const MOCK_MODEL_NAMES = [
  'Baklashka FuseTea',
  'Baklashka CocaCola',
  'Baklashka Opus6.7',
]
function useMobile() {
  const [mobile, setMobile] = useState(
    () => window.matchMedia('(max-width: 767px)').matches
  )
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)')
    const change = () => setMobile(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  return mobile
}
function ReviewSkeleton() {
  return (
    <div
      className="review-layout review-skeleton"
      aria-label="Загружаем результат"
      role="status"
    >
      <div className="player-skeleton">
        <LoaderCircle className="animate-spin" size={26} />
        <span>Загружаем результат…</span>
      </div>
      <div className="event-skeletons">
        <span />
        <span />
      </div>
    </div>
  )
}

export default function App() {
  const mobile = useMobile()
  const [drawerOpen, setDrawerOpen] = useState(() =>
    readPreference('forte.drawer') === null
      ? !window.matchMedia('(max-width: 767px)').matches
      : readPreference('forte.drawer') === 'open'
  )
  const [modelName, setModelName] = useState(() => {
    const saved = readPreference('forte.mock-model')
    return saved && MOCK_MODEL_NAMES.includes(saved) ? saved : MOCK_MODEL_NAMES[0]
  })
  const [modelId, setModelId] = useState('')
  const [modelError, setModelError] = useState('')
  const [modelAttempt, setModelAttempt] = useState(0)
  const [history, setHistory] = useState<JobSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [historyAttempt, setHistoryAttempt] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [job, setJob] = useState<JobResult | null>(null)
  const [review, setReview] = useState<CompletedReview | null>(null)
  const [resultLoading, setResultLoading] = useState(false)
  const [resultError, setResultError] = useState('')
  const [resultAttempt, setResultAttempt] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [queued, setQueued] = useState<{ id: string; position: number } | null>(
    null
  )
  const [notice, setNotice] = useState<{
    message: string
    error?: boolean
  } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const uploadBusy = useRef(false)
  const dropHandler = useRef<(files: File[]) => void>(() => {})
  const navigationVersion = useRef(0)
  const completed = useRef(new Map<string, CompletedReview>())
  const positions = useRef(new Map<string, ReviewPosition>())

  useEffect(() => {
    writePreference('forte.drawer', drawerOpen ? 'open' : 'closed')
  }, [drawerOpen])
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    requestAnimationFrame(() =>
      menuButton.current?.focus({ preventScroll: true })
    )
  }, [])
  useEffect(() => {
    if (!drawerOpen || mobile) return
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !document.querySelector('[role="menu"], [role="alertdialog"]')
      )
        closeDrawer()
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [drawerOpen, mobile, closeDrawer])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const controller = new AbortController()
    setModelError('')
    api
      .models(controller.signal)
      .then(({ models: available }) => {
        // The playful dropdown names all use the same backend model.
        setModelId(available[0]?.id || '')
        if (!available.length)
          setModelError(
            'Нет доступных моделей. Обновите список или подключите локальную модель.'
          )
      })
      .catch((error) => {
        if (!controller.signal.aborted) setModelError(error.message)
      })
    return () => controller.abort()
  }, [modelAttempt])

  // Poll sequentially, pause in background tabs, and retain usable history on errors.
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let inFlight = false
    const load = async () => {
      if (inFlight || document.hidden || controller.signal.aborted) return
      inFlight = true
      try {
        const { jobs } = await api.history(controller.signal)
        if (controller.signal.aborted) return
        setHistory((previous) =>
          JSON.stringify(previous) === JSON.stringify(jobs) ? previous : jobs
        )
        setHistoryError('')
      } catch (error) {
        if (!controller.signal.aborted)
          setHistoryError((error as Error).message)
      } finally {
        inFlight = false
        if (!controller.signal.aborted) {
          setHistoryLoading(false)
          timer = setTimeout(load, 2000)
        }
      }
    }
    const resume = () => {
      clearTimeout(timer)
      void load()
    }
    void load()
    document.addEventListener('visibilitychange', resume)
    return () => {
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [historyAttempt])

  useEffect(() => {
    if (!selectedId || completed.current.has(selectedId)) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const result = await api.job(selectedId, controller.signal)
        if (controller.signal.aborted) return
        if (result.status === 'done') {
          const [annotations, videoUrl] = await Promise.all([
            api.annotations(selectedId, controller.signal),
            api.video(selectedId),
          ])
          if (controller.signal.aborted) return
          const ready = { job: result, annotations, videoUrl }
          completed.current.set(selectedId, ready)
          setReview(ready)
        }
        setJob(result)
        setResultLoading(false)
        if (result.status === 'processing') timer = setTimeout(load, 1500)
      } catch (error) {
        if (!controller.signal.aborted) {
          setResultError((error as Error).message)
          setResultLoading(false)
        }
      }
    }
    void load()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [selectedId, resultAttempt])

  const openJob = useCallback(
    (id: string) => {
      if (id === selectedId) return
      navigationVersion.current += 1
      const cached = completed.current.get(id)
      const summary = history.find((item) => item.job_id === id)
      setSelectedId(id)
      setJob(
        cached?.job ||
          (summary?.status === 'processing'
            ? {
                job_id: id,
                status: 'processing',
                queue_position: summary.queue_position,
              }
            : null)
      )
      setReview(cached || null)
      setResultLoading(!cached && summary?.status !== 'processing')
      setResultError('')
      // Drawer state is controlled only by its own open/close actions.
    },
    [history, selectedId]
  )
  const showUpload = useCallback(() => {
    navigationVersion.current += 1
    setSelectedId(null)
    setResultError('')
  }, [])
  const rememberPosition = useCallback(
    (id: string, position: ReviewPosition) => {
      positions.current.set(id, position)
    },
    []
  )

  const upload = async (file?: File) => {
    if (!file || uploadBusy.current) return
    const invalid = validateVideo(file)
    setUploadError(invalid || '')
    if (fileInput.current) fileInput.current.value = ''
    if (invalid || !modelId) return
    uploadBusy.current = true
    setUploading(true)
    const version = navigationVersion.current
    try {
      const { job_id } = await api.analyze(file, modelId)
      const result = await api.job(job_id)
      setHistory((previous) => [
        {
          job_id,
          filename: file.name,
          created_at: new Date().toISOString(),
          model_id: modelId,
          status: result.status,
          queue_position: result.queue_position || 0,
        },
        ...previous.filter((item) => item.job_id !== job_id),
      ])
      setHistoryAttempt((value) => value + 1)
      if (version !== navigationVersion.current)
        setNotice({ message: 'Видео добавлено в историю проверок' })
      else if ((result.queue_position || 0) > 0)
        setQueued({ id: job_id, position: result.queue_position! })
      else {
        openJob(job_id)
        setJob(result)
        setResultLoading(result.status === 'done')
      }
    } catch (error) {
      if (version === navigationVersion.current)
        setUploadError((error as Error).message)
      else
        setNotice({
          message: 'Не удалось загрузить видео. Попробуйте ещё раз.',
          error: true,
        })
    } finally {
      uploadBusy.current = false
      setUploading(false)
    }
  }
  useEffect(() => {
    dropHandler.current = (files) => {
      if (uploadBusy.current) return
      if (selectedId) showUpload()
      if (files.length > 1) setUploadError('Загружайте по одному видео за раз.')
      else void upload(files[0])
    }
  })
  useEffect(
    () =>
      listenForFileDrop(document, setDragging, (files) =>
        dropHandler.current(files)
      ),
    []
  )
  const waiting = (job?.queue_position || 0) > 0

  return (
    <div className={`app-shell ${drawerOpen ? 'drawer-open' : ''}`}>
      <Button
        ref={menuButton}
        variant="outline"
        size="icon"
        className="menu-toggle"
        hidden={drawerOpen}
        onClick={() => setDrawerOpen(true)}
        aria-label="Открыть историю"
        aria-controls="history-drawer"
        aria-expanded={drawerOpen}
      >
        <PanelLeft size={20} />
      </Button>
      <HistoryDrawer
        open={drawerOpen}
        mobile={mobile}
        jobs={history}
        selectedId={selectedId}
        loading={historyLoading}
        error={historyError}
        onClose={closeDrawer}
        onSelect={openJob}
        onUpload={showUpload}
        onRetry={() => setHistoryAttempt((value) => value + 1)}
      />
      <main
        className={selectedId ? 'result-main' : 'upload-main'}
        inert={mobile && drawerOpen}
        aria-busy={selectedId ? resultLoading : uploading}
      >
        {!selectedId ? (
          <div
            className={`upload-form ${dragging && !uploading ? 'is-dragging' : ''}`}
          >
            <input
              id="video-file"
              ref={fileInput}
              type="file"
              accept=".mov,.mp4,.webm,video/quicktime,video/mp4,video/webm"
              hidden
              aria-label="Выбрать видеофайл"
              onChange={(event) => void upload(event.target.files?.[0])}
            />
            <div className="upload-dropzone">
              <Button
                className="upload-button"
                disabled={uploading || !modelId}
                onClick={() => fileInput.current?.click()}
                aria-describedby="upload-hint"
              >
                {uploading ? (
                  <LoaderCircle className="animate-spin" size={20} />
                ) : (
                  <Upload size={20} />
                )}
                <span>
                  {uploading
                    ? 'Загружаем видео…'
                    : dragging
                      ? 'Переместите сюда'
                      : 'Загрузить видео'}
                </span>
              </Button>
              <p className="dropzone-prompt" role="status">
                {uploading
                  ? 'Видео загружается, подождите…'
                  : dragging
                    ? 'Отпустите видео, чтобы начать проверку'
                    : 'или перетащите файл сюда'}
              </p>
            </div>
            <div className="upload-options">
              <p id="upload-hint" className="upload-hint">
                MOV, MP4, WebM · до 100 МБ
              </p>
              <div className="model-control">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        className="model-trigger"
                        disabled={!modelId || uploading}
                        aria-label={`Выбрать модель: ${modelName}`}
                      />
                    }
                  >
                    <span>
                      {modelId
                        ? modelName
                        : modelError
                          ? 'Модели недоступны'
                          : 'Загружаем модели…'}
                    </span>
                    <ChevronDown size={15} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    sideOffset={6}
                    className="model-menu"
                  >
                    <DropdownMenuRadioGroup
                      value={modelName}
                      onValueChange={(name) => {
                        setModelName(name)
                        writePreference('forte.mock-model', name)
                      }}
                    >
                      {MOCK_MODEL_NAMES.map((name) => (
                        <DropdownMenuRadioItem
                          key={name}
                          value={name}
                          closeOnClick
                        >
                          {name}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Popover.Root>
                  <Popover.Trigger
                    render={<Button variant="ghost" className="model-help" />}
                    aria-label="О выборе модели"
                  >
                    ?
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Positioner
                      align="end"
                      sideOffset={8}
                      className="model-help-positioner"
                    >
                      <Popover.Popup
                        className="model-help-popup"
                        aria-label="О выборе модели"
                      >
                        <Popover.Description>
                          Никакой разницы нет, это просто прикольчик
                        </Popover.Description>
                      </Popover.Popup>
                    </Popover.Positioner>
                  </Popover.Portal>
                </Popover.Root>
              </div>
            </div>
            {(uploadError || modelError) && (
              <div className="inline-error" role="alert">
                <TriangleAlert size={17} />
                <div>
                  <p>{uploadError || modelError}</p>
                  {modelError && (
                    <Button
                      variant="link"
                      onClick={() => setModelAttempt((value) => value + 1)}
                    >
                      Обновить модели
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : resultError ? (
          <div className="processing-state error-state">
            <span className="state-icon">
              <TriangleAlert size={26} />
            </span>
            <h1>Не удалось загрузить результат</h1>
            <p role="alert">{resultError}</p>
            <Button
              variant="outline"
              onClick={() => {
                setResultError('')
                setResultLoading(true)
                setResultAttempt((value) => value + 1)
              }}
            >
              Попробовать ещё раз
            </Button>
          </div>
        ) : review && review.job.job_id === selectedId ? (
          <Result
            key={selectedId}
            {...review}
            initialPosition={
              positions.current.get(selectedId) || EMPTY_POSITION
            }
            onPositionChange={rememberPosition}
          />
        ) : resultLoading ? (
          <ReviewSkeleton />
        ) : job?.status === 'failed' ? (
          <div className="processing-state error-state">
            <span className="state-icon">
              <TriangleAlert size={26} />
            </span>
            <h1>Не удалось обработать видео</h1>
            <p role="alert">
              {job.error?.message || 'Попробуйте загрузить другую запись.'}
            </p>
            <Button variant="outline" onClick={showUpload}>
              Загрузить другое видео
            </Button>
          </div>
        ) : (
          <div className="processing-state" role="status">
            {waiting && (
              <span className="state-icon queue-icon">
                <Clock3 size={26} />
              </span>
            )}
            {waiting ? (
              <h1>Видео в очереди</h1>
            ) : (
              <>
                <LoaderCircle
                  className="analyzing-spinner animate-spin"
                  size={64}
                  strokeWidth={1.5}
                  absoluteStrokeWidth
                />
                <h1 className="analyzing-title">
                  <span className="sr-only">Анализируем видеозапись</span>
                  <CheckTicker />
                </h1>
              </>
            )}
            {waiting && (
              <p>
                Перед вами {job?.queue_position} видео. Обработка начнётся
                автоматически.
              </p>
            )}
            <Button variant="outline" onClick={showUpload}>
              <Upload size={16} />
              Загрузить ещё видео
            </Button>
          </div>
        )}
      </main>
      {dragging && !uploading && (selectedId || (mobile && drawerOpen)) && (
        <div className="file-drop-overlay" role="status">
          <Upload size={32} />
          <strong>Переместите сюда</strong>
          <span>Отпустите видео, чтобы начать проверку</span>
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {selectedId && review?.job.job_id === selectedId
          ? review.job.verdict === 'no_violation'
            ? 'Возможных нарушений не обнаружено.'
            : `Возможных нарушений: ${review.job.violations?.length || 0}.`
          : ''}
      </span>
      <AlertDialog
        open={!!queued}
        onOpenChange={(open) => {
          if (!open) setQueued(null)
        }}
      >
        <AlertDialogContent className="queue-dialog">
          <span className="state-icon queue-icon">
            <Clock3 size={27} />
          </span>
          <AlertDialogHeader>
            <AlertDialogTitle>Видео добавлено в очередь</AlertDialogTitle>
            <AlertDialogDescription>
              Другая запись уже обрабатывается.
              <br />
              Ваше видео начнёт анализ автоматически.
              <span className="queue-position">
                Перед вами: {queued?.position} видео
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                const id = queued?.id
                setQueued(null)
                if (id) openJob(id)
              }}
            >
              Понятно
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {notice && (
        <div
          className={`app-notice ${notice.error ? 'notice-error' : ''}`}
          role={notice.error ? 'alert' : 'status'}
        >
          {notice.error ? <TriangleAlert size={17} /> : <Check size={17} />}
          <span>{notice.message}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setNotice(null)}
            aria-label="Закрыть уведомление"
          >
            <X size={15} />
          </Button>
        </div>
      )}
      {isMock && !drawerOpen && !selectedId && (
        <span className="standalone-demo-note">Демонстрационные данные</span>
      )}
    </div>
  )
}
