import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { IndicatorsBar } from './IndicatorsBar.tsx'

function valueFor(label: string) {
  return screen.getByText(label).nextElementSibling
}

describe('IndicatorsBar', () => {
  it('renders the given values', () => {
    render(<IndicatorsBar atRisk={3} cost={1250} co2Kg={84.5} />)
    expect(valueFor('At risk')).toHaveTextContent('3')
    expect(valueFor('Est. cost')).toHaveTextContent('$1,250')
    expect(valueFor('Est. tailpipe CO2')).toHaveTextContent('84.5 kg')
  })

  it('renders an em dash for null values', () => {
    render(<IndicatorsBar atRisk={null} cost={null} co2Kg={null} />)
    for (const label of ['At risk', 'Est. cost', 'Est. tailpipe CO2']) {
      expect(valueFor(label)).toHaveTextContent('—')
    }
  })

  it('always shows the SIMULATED badge', () => {
    const { rerender } = render(<IndicatorsBar atRisk={null} cost={null} co2Kg={null} />)
    expect(screen.getByText('SIMULATED')).toBeInTheDocument()
    rerender(<IndicatorsBar atRisk={0} cost={0} co2Kg={0} />)
    expect(screen.getByText('SIMULATED')).toBeInTheDocument()
  })
})
