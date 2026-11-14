# Driver notice: running it and showing it on a phone

The dispatcher sends the decision for one shipment to its driver. The driver reads it on a
phone-sized page: what changed, what to do, why, and the added duty time.

Everything here is SIMULATED. No real message is sent, and nothing confirms that a driver
received or read a notice.

## The two pages

| Page | Address | Who |
| --- | --- | --- |
| Dashboard | `/` | Dispatcher |
| Driver notice | `/driver.html#S-01` (any shipment id) | Driver |

1. On the dashboard, select a shipment under **Needs review** and choose a response.
2. A **Driver notice** panel appears above the response comparison. It shows the text the
   driver will get.
3. Press **Send to driver**. Nothing is sent on Preview or when a response is chosen.
4. Changing the decision afterwards marks the driver's notice as "being revised" at once. The
   new instruction goes out only when **Send update to driver** is pressed.
5. **Reset** clears every notice.

## On one laptop

```bash
npm run dev
```

Open the dashboard and, in a second window of the same browser, the driver page. A phone-sized
window beside the dashboard is the backup for the demo: it needs no network.

## On a phone

The phone and the laptop must be on the same network.

```bash
npm run dev -- --host
```

After a notice panel appears, it shows the address to open on the phone, for example
`http://192.168.1.20:5173/driver.html#S-01`. It is the "Network" address Vite prints, followed
by `/driver.html#` and the shipment id.

The built app works the same way:

```bash
npm run build
```

```bash
npm run preview -- --host
```

### If the phone cannot open the page

Venue and campus Wi-Fi often stops devices on the network from reaching each other.

1. Turn on the phone's hotspot and connect the laptop to it.
2. Stop the server and start it again with `--host`. Vite prints a new Network address.
3. Open that address on the phone.

Test this once before the presentation.

## What the status lines mean

| Where | Text | Meaning |
| --- | --- | --- |
| Dashboard | Phone delivery is on | The relay is running and reachable from the network |
| Dashboard | Phone delivery: this computer only | The server was started without `--host` |
| Dashboard | Phone delivery unavailable: same browser only | No relay is answering, for example on a static host |
| Driver page | Connected to dispatch | Updates arrive without a reload |
| Driver page | Connection lost at 10:44 | The notice on screen may be out of date; the page keeps retrying |

## How it works

- **Same browser:** the dashboard and the driver page share the notice through the browser
  (`src/driver/channel.ts`). No server is involved.
- **Another device:** the dashboard also sends each notice to a small relay
  (`server/driverNotices.ts`), and the driver page follows the relay's stream
  (`src/driver/relayChannel.ts`). The relay is served by the Vite dev and preview servers
  through a plugin in `vite.config.ts`. It is a plain Node handler, so the incident server
  (issue #15) can mount it too.

| Request | Purpose |
| --- | --- |
| `GET /api/driver-notices` | Is the relay there, and which address can a phone open |
| `PUT /api/driver-notices/:shipmentId` | The dashboard sends or revises a notice |
| `GET /api/driver-notices/:shipmentId` | The latest notice |
| `GET /api/driver-notices/:shipmentId/stream` | Updates as Server-Sent Events |
| `DELETE /api/driver-notices` | Reset |

## Limits

- **No sign-in.** Anyone on the same network can read or post a notice. This is for the demo
  only, and notices carry synthetic data and no personal data.
- **`--host` exposes the whole dev server** to the network, not only the relay. Stop it after
  the demo.
- **Memory only.** Restarting the server forgets every notice. A phone then shows "No notice"
  until the dispatcher sends again; the laptop's own browser still remembers.
- **A static host has no relay.** The deployed build falls back to the same-browser path.
- **A public tunnel is out of scope.** It would put the dev server on a public address, which
  needs the team's agreement.
