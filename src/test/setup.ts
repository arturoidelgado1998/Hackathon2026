import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, vi } from 'vitest'

// The ArcGIS map needs WebGL and the network, which jsdom has neither of.
// Tests render a stand-in that records what the map was asked to show.
vi.mock('../map/ArcgisMap.tsx', () => ({
  default: (props: {
    highlightedRouteIds: object
    incidentSegmentId: string | null
    candidateSegmentId: string | null
  }) =>
    createElement('div', {
      'data-testid': 'arcgis-map',
      'data-routes': JSON.stringify(props.highlightedRouteIds),
      'data-incident': props.incidentSegmentId ?? '',
      'data-candidate': props.candidateSegmentId ?? '',
    }),
}))

afterEach(() => {
  cleanup()
})
