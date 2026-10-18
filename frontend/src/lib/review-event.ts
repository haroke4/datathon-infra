import type { Annotation, Violation } from './types'

export function eventSources(violation: Violation, annotation?: Annotation) {
  if (violation.sources?.length) return violation.sources
  if (!annotation?.rule?.url) return []
  return [
    {
      label:
        [annotation.rule.title, annotation.rule.section]
          .filter(Boolean)
          .join(', ') || 'Нормативный источник',
      url: annotation.rule.url,
    },
  ]
}

export function eventDescription(
  violation: Violation,
  annotation?: Annotation
) {
  return eventSources(violation, annotation).length
    ? violation.description.replace(/\s*Норма:[\s\S]*$/, '').trim()
    : violation.description
}
