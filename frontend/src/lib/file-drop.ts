// Listen at the page boundary so feedback starts before the pointer reaches the drop zone.
export function listenForFileDrop(
  target: Document,
  onActive: (active: boolean) => void,
  onDrop: (files: File[]) => void
) {
  const capture = { capture: true }
  let depth = 0
  let active = false
  const reset = () => {
    depth = 0
    if (active) onActive(false)
    active = false
  }
  const isFile = (event: DragEvent) =>
    Array.from(event.dataTransfer?.types || []).includes('Files')
  const activate = (event: DragEvent) => {
    if (!isFile(event)) return
    event.preventDefault()
    if (!active) onActive(true)
    active = true
  }
  const enter = (event: DragEvent) => {
    if (!isFile(event)) return
    depth += 1
    activate(event)
  }
  const over = (event: DragEvent) => {
    activate(event)
    if (isFile(event) && event.dataTransfer)
      event.dataTransfer.dropEffect = 'copy'
  }
  const leave = (event: DragEvent) => {
    if (!active) return
    // Some browsers only send one leave when the file exits the window.
    const view = target.defaultView
    const outside =
      view &&
      (event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= view.innerWidth ||
        event.clientY >= view.innerHeight)
    depth = Math.max(0, depth - 1)
    if (!depth || outside) reset()
  }
  const drop = (event: DragEvent) => {
    const files = Array.from(event.dataTransfer?.files || [])
    if (isFile(event) || files.length) event.preventDefault()
    reset()
    if (files.length) onDrop(files)
  }
  const cancel = (event: KeyboardEvent) => {
    if (active && event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      reset()
    }
  }
  const visibility = () => {
    if (target.hidden) reset()
  }
  target.addEventListener('dragenter', enter, capture)
  target.addEventListener('dragover', over, capture)
  target.addEventListener('dragleave', leave, capture)
  target.addEventListener('drop', drop, capture)
  target.addEventListener('dragend', reset, capture)
  target.addEventListener('keydown', cancel, capture)
  target.addEventListener('visibilitychange', visibility)
  target.defaultView?.addEventListener('blur', reset)
  return () => {
    target.removeEventListener('dragenter', enter, capture)
    target.removeEventListener('dragover', over, capture)
    target.removeEventListener('dragleave', leave, capture)
    target.removeEventListener('drop', drop, capture)
    target.removeEventListener('dragend', reset, capture)
    target.removeEventListener('keydown', cancel, capture)
    target.removeEventListener('visibilitychange', visibility)
    target.defaultView?.removeEventListener('blur', reset)
  }
}
