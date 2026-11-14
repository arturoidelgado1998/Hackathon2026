export const limitations = [
  'Routes and travel times are illustrative; route suitability for trucks is not verified.',
  'Emissions are a distance-based tailpipe CO2 estimate; no congestion, load, idling, speed, upstream fuel, noise, or local air-quality effects.',
  'Arrival ranges are scenario bounds, not statistically calibrated intervals.',
  'AI interpretation can be wrong; that is why human confirmation is required.',
  'One truck per shipment; no reassignment or warehouse-capacity modeling.',
  'A closure report or reopening time is an estimate, not a guarantee.',
  'All shipments, warehouses, routes and incident reports are simulated; no result is a measured real-world outcome.',
  'Sensitive-zone flags are placeholders until the corridor analysis (G3, #21). After that they show proximity (schools and disadvantaged communities within 150 m of an illustrative route), not measured exposure or health impact.',
  'Flagging an impact is not the same as resolving it. The tool makes trade-offs visible; it does not make a decision fair.',
  'Cost, fuel economy and labor figures are placeholder assumptions until the team confirms and cites them.',
  'Waiting is assumed to be engine-off, and driver pay, legal hours-of-service and fatigue are not modeled.',
] as const
