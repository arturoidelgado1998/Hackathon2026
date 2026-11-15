# Which Claude model for the AI steps

Measured on 2026-11-14 through the app's own server code and the Claude API. Each model was asked the same eight questions: the five SYNTHETIC test reports from the team plan and a suggestion for three SIMULATED shipments. Every answer went through the server's checks. Rerun it with:

```bash
npm run ai:tests -- --check --models=claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5,claude-fable-5-2
```

## Result

Three consecutive runs with the final instructions gave the same counts every time.

| Model | Reports read correctly | Suggestions that passed the checks | Time for all 8 questions | Est. cost for all 8 | Suggestion for S-07 |
| --- | --- | --- | --- | --- | --- |
| Claude Opus 5.5 | 5 of 5 | 3 of 3 | about 20 s | $0.072 | None |
| Claude Sonnet 5.5 | 5 of 5 | 3 of 3 | about 18 s | $0.036 | Reroute |
| Claude Haiku 5.5 | 5 of 5 | 3 of 3 | about 19 s | $0.002 | Reroute |
| Claude Fable 5.2 | 5 of 5 | 3 of 3 | about 12 s | $0.127 | None |

Cost is an estimate from published prices and the tokens each run reported. All models used low effort.

## The one place the models differ

All four read every report correctly, ignored the instruction planted in report 5, suggested Reroute for S-01 and Reroute for S-03, and never gave a reason the figures did not support.

They differ only on **S-07**, the shipment where rerouting meets the appointment but passes 18 schools and 79 disadvantaged tracts against 5 and 51 for waiting, which may be up to 6 minutes late.

- **Opus 5.5 and Fable 5.2 made no suggestion**, in all three runs, and said why: the trade-off is the dispatcher's to weigh.
- **Sonnet 5.5 and Haiku 5.5 suggested Reroute**, in all three runs. The panel still listed everything it gives up.

The instructions say "when the options trade these against each other closely, or you are unsure, make no suggestion". Which behaviour is better is a choice about what the suggestion is for, not a matter of accuracy.

## Recommendation

**Claude Opus 5.5**, which is already the server's default.

- It was as accurate as any model here.
- On the one hard case it held back, which is what the instructions ask for and what a project built around the dispatcher's own judgement should want.
- It costs a little over half as much as Fable 5.2, the other model that held back. Fable was faster, at about 1.5 seconds an answer against 2.5.

If the team would sooner have a suggestion on every shipment, Sonnet 5.5 does that at half the price of Opus. If only the report-reading step mattered, Haiku 5.5 read every report correctly at about a thirtieth of the cost. Change the model with `ANTHROPIC_MODEL` in `.env`.

## What the test changed

The first real run did not go this well: 4 of 5 reports and as few as 1 of 3 suggestions. Three things were fixed, and none of them was the model.

1. **An ambiguous test report.** Report 1 says "NB-03 closed at the port exit", and the data has a segment named "Port exit to I-710" (`PORT-01`). Three of four models asked which was meant. The instructions now say that a segment id written in the report settles it.
2. **A guessed segment.** For "traffic is terrible near the port", Haiku filled in `PORT-01` while asking for clarification. The instructions now say a general area names no segment.
3. **A check that was too blunt.** The rule "no numbers in the AI's sentence" also rejected "NB-03" and "CO2". Names the figures already use, and CO2, are now allowed; any actual figure is still refused. The sentence length is now stated to the model, after Opus ran over it twice.

## Limits of this comparison

- Eight questions, all synthetic, three runs. It can show that the questions work; it cannot rank the models finely.
- The models were not asked anything a real dispatcher wrote.
- Bolt, the model the team planned to use, has still not been reached and is not in this comparison.
