// One small icon set for the whole dashboard: 16px grid, 1.75 stroke,
// round caps and joins. Icons are decorative by default (aria-hidden); pass
// `label` when the icon itself must be announced.

interface IconProps {
  size?: number
  /** Accessible name. Omit when adjacent text already says it. */
  label?: string
}

function svgProps({ size = 14, label }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    focusable: false,
    className: 'pp-icon',
    ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }),
  }
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3 8.6l3.1 3.1L13 4.9" />
    </svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M8 2.3l6.2 10.9H1.8L8 2.3z" />
      <path d="M8 6.6v3M8 11.3v.1" />
    </svg>
  )
}

export function QuestionIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M5.9 6.1a2.1 2.1 0 1 1 3.3 1.8c-.8.5-1.2 1-1.2 1.9M8 12.3v.1" />
    </svg>
  )
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="8" cy="8" r="5.9" />
      <path d="M8 4.8V8l2.2 1.4" />
    </svg>
  )
}

/** Road closed: a no-entry sign. */
export function ClosedIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="8" cy="8" r="5.9" />
      <path d="M5 8h6" />
    </svg>
  )
}
