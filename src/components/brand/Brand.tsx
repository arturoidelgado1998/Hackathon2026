import './Brand.css'

export function Brand() {
  return (
    <span className="pp-brand">
      <img
        className="pp-brand__mark"
        src={`${import.meta.env.BASE_URL}routeripple.svg`}
        width={32}
        height={32}
        alt=""
      />
      <span>Route<span className="pp-brand__accent">Ripple</span></span>
    </span>
  )
}
