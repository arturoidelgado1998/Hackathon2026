import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { assumptions, assumptionPlaceholders } from '../../data'
import { limitations } from '../../data/limitations'
import { AssumptionsPanel } from './index'

const units: Record<string, string> = {
  pickup_handling_min: 'minutes',
  mpg: 'miles per gallon',
  nonlabor_cost_per_mile: 'USD per mile',
  labor_rate_per_hr: 'USD per hour',
  diesel_kgCO2_per_gal: 'kg CO2 per gallon',
}

describe('AssumptionsPanel', () => {
  it('links directly to inputs, value types and limitations within the panel', () => {
    render(<AssumptionsPanel />)
    const navigation = screen.getByRole('navigation', { name: 'Assumptions sections' })
    for (const link of within(navigation).getAllByRole('link')) {
      const target = document.getElementById(link.getAttribute('href')!.slice(1))
      expect(target).toBeInTheDocument()
      expect(target).toBeVisible()
    }
  })

  it('shows every numeric assumption with its value, unit, source and placeholder flag', () => {
    render(<AssumptionsPanel />)
    const table = screen.getByRole('table', { name: 'Numeric assumptions and their sources' })
    const numericAssumptions = Object.entries(assumptions).filter(
      ([, value]) => typeof value === 'number',
    )
    expect(within(table).getAllByRole('row')).toHaveLength(numericAssumptions.length + 1)

    for (const [key, value] of numericAssumptions) {
      const source = within(table).getByText(assumptions.sources[key])
      const row = source.closest('tr')!
      const [valueCell, unitCell, sourceCell] = within(row).getAllByRole('cell')
      expect(valueCell).toHaveTextContent(String(value))
      expect(unitCell).toHaveTextContent(units[key])
      expect(sourceCell).toHaveTextContent(assumptions.sources[key])
      expect(valueCell).toHaveAttribute('title', expect.stringMatching(/estimated/i))
      if (assumptionPlaceholders[key]) {
        expect(within(row).getByText('Placeholder')).toBeInTheDocument()
      } else {
        expect(within(row).queryByText('Placeholder')).not.toBeInTheDocument()
      }
    }
    expect(
      within(table).getByText('EPA GHG Emission Factors Hub, 2025 edition (PLACEHOLDER until verified)'),
    ).toBeInTheDocument()
  })

  it('explains all four value types without treating unknown values as zero', () => {
    render(<AssumptionsPanel />)
    const legend = screen.getByRole('region', { name: 'Value types' })
    expect(within(legend).getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Confirmed',
      'Estimated',
      'Simulated',
      'Unknown',
    ])
    expect(legend).toHaveTextContent('Not available or not yet confirmed; not zero.')
  })

  it('shows the eleven reusable limitations verbatim, including the first and last', () => {
    render(<AssumptionsPanel />)
    const panel = screen.getByRole('region', { name: 'Limitations' })
    const items = within(panel).getAllByRole('listitem')
    expect(items).toHaveLength(11)
    expect(items.map((item) => item.textContent)).toEqual([...limitations])
    expect(items[0]).toHaveTextContent(
      'Routes and travel times are illustrative; route suitability for trucks is not verified.',
    )
    expect(items[10]).toHaveTextContent(
      'Waiting is assumed to be engine-off, and driver pay, legal hours-of-service and fatigue are not modeled.',
    )
  })
})
