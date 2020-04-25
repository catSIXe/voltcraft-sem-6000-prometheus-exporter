const cmd = './voltcraft-sem-6000/sem-6000.exp Voltcraft --measure'

const {chunksToLinesAsync, chomp} = require('@rauschma/stringio');
const {spawn} = require('child_process');
const express = require('express')
const Prometheus = require('prom-client')
let wdg
const watchdog = () => {
  if (wdg) clearTimeout(wdg)
  wdg = setTimeout(() => process.exit(0), 2e3)
}

watchdog()
const app = express()
const port = process.env.PORT || 9191

const sem6000_power_measurement_voltage = new Prometheus.Gauge({
  name: 'sem6000_power_measurement_voltage',
  help: 'The Voltcraft Smartmeter Voltage',
})
const sem6000_power_measurement_ampere = new Prometheus.Gauge({
  name: 'sem6000_power_measurement_ampere',
  help: 'The Voltcraft Smartmeter Ampere',
})
const sem6000_power_measurement_watt = new Prometheus.Gauge({
  name: 'sem6000_power_measurement_watt',
  help: 'The Voltcraft Smartmeter Watt',
})
const sem6000_power_measurement_frequency = new Prometheus.Gauge({
  name: 'sem6000_power_measurement_frequency',
  help: 'The Voltcraft Smartmeter Frequency in Hz',
})
const sem6000_power_measurement_powerfactor = new Prometheus.Gauge({
  name: 'sem6000_power_measurement_powerfactor',
  help: 'The Voltcraft Smartmeter Powerfactor',
})
const sem6000_power_measurement_total = new Prometheus.Gauge({
  name: 'sem6000_power_measurement_total',
  help: 'The Voltcraft Smartmeter Total Consumption',
  //labelNames: ['voltage', 'ampere', 'watt', 'frequency', 'powerfactor', 'total'],
})

async function main() {
  const source = spawn('expect', ['./voltcraft-sem-6000/sem-6000.exp', 'Voltcraft', '--measure'], {stdio: ['ignore', 'pipe', process.stderr]})
  await echoReadable(source.stdout)
  process.exit(0)
}
main()
const lastMeasurement = {}
async function echoReadable(readable) {
	for await (const line of chunksToLinesAsync(readable)) {
    let data0 = chomp(line)
    let data = data0.split('\t')
    watchdog()
    //console.log(data0)
    lastMeasurement.volt = parseInt(data[2])
    lastMeasurement.amp = parseFloat(data[3])
    lastMeasurement.watt = parseFloat(data[4])
    lastMeasurement.freq = parseInt(data[5])
    lastMeasurement.powerFactor = parseFloat(data[6])
    lastMeasurement.total = parseFloat(data[7])
    //console.log(lastMeasurement)

    sem6000_power_measurement_voltage.set(lastMeasurement.volt)
    sem6000_power_measurement_ampere.set(lastMeasurement.amp)
    sem6000_power_measurement_watt.set(lastMeasurement.watt)
    sem6000_power_measurement_frequency.set(lastMeasurement.freq)
    sem6000_power_measurement_powerfactor.set(lastMeasurement.powerFactor)
    sem6000_power_measurement_total.set(lastMeasurement.total)
	}
}


const metricsInterval = Prometheus.collectDefaultMetrics()
app.get('/metrics', (req, res) => {
  res.set('Content-Type', Prometheus.register.contentType)
  res.end(Prometheus.register.metrics())
})

const server = app.listen(port, () => {
  console.log(`Power Measuremtn app listening on port ${port}!`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  clearInterval(metricsInterval)

  server.close((err) => {
    if (err) {
      console.error(err)
      process.exit(1)
    }

    process.exit(0)
  })
})

