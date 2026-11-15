export const limitations = [
  'Routes and travel times are approximate; route suitability for trucks is not verified.',
  'Emissions are a distance-based tailpipe CO2 estimate; no congestion, load, idling, speed, upstream fuel, noise, or local air-quality effects.',
  'Arrival ranges are scenario bounds, not statistically calibrated intervals.',
  'AI interpretation can be wrong; that is why human confirmation is required.',
  'One truck per shipment; no reassignment or warehouse-capacity modeling.',
  'A closure report or reopening time is an estimate, not a guarantee.',
  'Every result is an estimate from the inputs listed here, not a measured outcome.',
  'Sensitive-zone flags show proximity (schools and disadvantaged communities within 150 m of a route), not measured exposure or health impact.',
  'Flagging an impact is not the same as resolving it. The tool makes trade-offs visible; it does not make a decision fair.',
  'Cost, labor and fuel economy inputs are published averages, not a carrier’s own figures: the cost and wage figures are national, and the fuel economy is what port truck operators reported, not a measurement.',
  'Waiting is assumed to be engine-off, and driver pay, legal hours-of-service and fatigue are not modeled.',
  'A driver notice appears on the driver page only; nothing confirms that a driver received or read it.',
] as const
