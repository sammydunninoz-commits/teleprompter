import mqtt from 'mqtt'

const CANDIDATES = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.emqx.io:443/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
  'wss://mqtt.eclipseprojects.io:443/mqtt',
]

for (const url of CANDIDATES) {
  const t = Date.now()
  const result = await new Promise((resolve) => {
    let settled = false
    const done = (r) => { if (!settled) { settled = true; resolve(r) } }
    let c
    try {
      c = mqtt.connect(url, {
        clientId: `probe-${Math.random().toString(36).slice(2, 10)}`,
        clean: true, connectTimeout: 8000, reconnectPeriod: 0,
      })
    } catch (e) { return done(`THREW ${e.message}`) }

    c.once('connect', async () => {
      // Prove it actually relays: publish to a topic we subscribed to.
      const topic = `autocue/probe/${Math.random().toString(36).slice(2, 10)}`
      c.subscribe(topic, { qos: 0 }, (err) => {
        if (err) return done(`SUBSCRIBE FAILED ${err.message}`)
        c.on('message', (_t, p) => done(`OK round-trip "${p.toString()}" in ${Date.now() - t}ms`))
        c.publish(topic, 'ping')
        setTimeout(() => done(`CONNACK ok but no message echoed back (${Date.now() - t}ms)`), 4000)
      })
    })
    c.once('error', (e) => done(`ERROR ${e.message}`))
    setTimeout(() => done(`TIMEOUT after ${Date.now() - t}ms`), 10_000)
  })
  console.log(url.padEnd(42), result)
}
process.exit(0)
