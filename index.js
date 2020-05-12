const {chunksToLinesAsync, chomp} = require('@rauschma/stringio');
const {spawn} = require('child_process');
const express = require('express')
const Prometheus = require('prom-client')
let wdg
const watchdog = () => {
  if (wdg) clearTimeout(wdg)
  wdg = setTimeout(() => process.exit(0), 10e3)
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
  labelNames: ['total', 'year', 'hour', 'month', 'dayOfMonth', 'dayOfWeek' ],
})

async function main() {
  const source = spawn('bash', ['./loop.sh'], {stdio: ['ignore', 'pipe', process.stderr]})
  await echoReadable(source.stdout)
  process.exit(0)
}
main()
const FETCH_STATE = {
  RESET: 0,
  DEVICE: 1,
  DATA: 2,
  MEASURE: 3,
}
const deviceInfo = {

}
let fetchState
const lastMeasurement = {}
const powerData = {
  hourly: {},
  daily: {},
  monthly: {},
}
const calculateTotalPowerUsageThisYear = (powerData) => {
  const now = new Date()
  const isoNow =  now.toISOString()
  const currentYear = isoNow.split('T')[0].split('-').splice(0, 1).join('-')
  const currentMonthly = isoNow.split('T')[0].split('-').splice(0, 2).join('-')
  const currentDaily = isoNow.split('T')[0].split('-').splice(0, 3).join('-')
  /** 
   * Struktur von powerData
  {
    "hourly": {
      "2020-05-06 17:00": 177,
      ...
      "2020-05-07 16:00": 118
    },
    "daily": {
      "2020-04-08": 0,
      ...
      "2020-05-07": 2782
    },
    "monthly": {
      "2019-06": 0,
      ...
      "2020-05": 26630
    }
  }
  */

  /*
  * Ich habe stündliche Messwerte von den letzten 24h, 
  * tägliche Messwerte der letzten 30 Tage, 
  * monatliche Messwerte der letzten 12 Monate
  * 
  * für eine genaue KWh Berechnung muss man:
  * = alle heutigen stündl. Werte addieren (jetztige Stunde inkl.)
  * + alle dies-monatigen tägl. Werte addieren (jetziger Tag exkl.)
  * + alle dies-jährigen monatl. Werte addieren (jetziger Monat exkl.)
  */
  const allYearButNowMonthly_C_O_N_S_U_M_E = Object.keys(powerData.monthly).reduce((total, curr) => {
    return total + (powerData.monthly[curr] * (curr !==currentMonthly && curr.indexOf(currentYear) === 0) )
  }, 0)


  const allMonthButNowDaily_C_O_N_S_U_M_E = Object.keys(powerData.daily).reduce((total, curr) => {
    return total + (powerData.daily[curr] * (curr !==currentDaily && curr.indexOf(currentMonthly) === 0) )
  }, 0)

  const allDailyHourly_C_O_N_S_U_M_E = Object.keys(powerData.hourly).reduce((total, curr) => {
    return total + (powerData.hourly[curr] * (curr.indexOf(currentDaily) === 0) )
  }, 0)
  // alle 3 Werte addieren
  return {
    totalYear: allYearButNowMonthly_C_O_N_S_U_M_E + allMonthButNowDaily_C_O_N_S_U_M_E + allDailyHourly_C_O_N_S_U_M_E,
    totalThisMonth: allMonthButNowDaily_C_O_N_S_U_M_E + allDailyHourly_C_O_N_S_U_M_E,
    today: allDailyHourly_C_O_N_S_U_M_E,
    now,
  }
}
async function echoReadable(readable) {
	for await (const line of chunksToLinesAsync(readable)) {
    let data0 = chomp(line)
    watchdog()
    let skip = false
    // console.log(data0)
    if (data0 === 'reset*') fetchState = FETCH_STATE.RESET
    if (fetchState === FETCH_STATE.RESET && data0.indexOf('Mac:') > -1) fetchState = FETCH_STATE.DEVICE
    if (!skip && fetchState === FETCH_STATE.DEVICE) {
      if (data0.indexOf('Timestamp') > -1) {
        fetchState = FETCH_STATE.DATA
        // console.log('switched to data')
      } else {
        let data = [data0.substring(0, data0.indexOf(':')), data0.substring(data0.indexOf(':') + 1)].map(x => x.trim())
        switch(data[0]) {
          case 'Mac': deviceInfo.mac = data[1]; break;
          case 'Serial': deviceInfo.serial = data[1]; break;
          case 'Name': deviceInfo.name = data[1]; break;
        }
      }
      skip = true
    }

    if (!skip && fetchState === FETCH_STATE.DATA) {
      if (data0.indexOf('Timestamp') > -1) {
        fetchState = FETCH_STATE.MEASURE
        // console.log('switched to measure')
        const res = calculateTotalPowerUsageThisYear(powerData)
        sem6000_power_measurement_total.set({
          total: 1,
          year: res.now.getFullYear(),
        }, res.totalYear)
        sem6000_power_measurement_total.set({
          total: 2,
          year: res.now.getFullYear(),
          month: res.now.getMonth(),
        }, res.totalThisMonth)
        sem6000_power_measurement_total.set({
          total: 3,
          year: res.now.getFullYear(),
          month: res.now.getMonth(),
          dayOfMonth: res.now.getDate(),
          dayOfWeek: res.now.getDay(),
        }, res.today)
      } else {
        let data = data0.split('\t')
        //console.log(data)
        let kwhValue = parseInt(data[1])
        switch (data[0].length) {
          case 16: // "day" / hourly-stats
            powerData.hourly[data[0]] = kwhValue
          break;
          case 10: // "month" / daily-stats
            powerData.daily[data[0]] = kwhValue
          break;
          case 7: // "year" / monthly-stats
            powerData.monthly[data[0]] = kwhValue
          break;
          default: console.log(data[0].length); break;
        }
      }
      skip = true
    }

    if (!skip && fetchState === FETCH_STATE.MEASURE) {
      let data = data0.split('\t')
      lastMeasurement.volt = parseInt(data[2])
      lastMeasurement.amp = parseFloat(data[3])
      lastMeasurement.watt = parseFloat(data[4])
      lastMeasurement.freq = parseInt(data[5])
      lastMeasurement.powerFactor = parseFloat(data[6])
      //lastMeasurement.total = parseFloat(data[7])
      //console.log(lastMeasurement)

      sem6000_power_measurement_voltage.set(lastMeasurement.volt)
      sem6000_power_measurement_ampere.set(lastMeasurement.amp)
      sem6000_power_measurement_watt.set(lastMeasurement.watt)
      sem6000_power_measurement_frequency.set(lastMeasurement.freq)
      sem6000_power_measurement_powerfactor.set(lastMeasurement.powerFactor)
      //sem6000_power_measurement_total.set(lastMeasurement.total)

    }
	}
}


const metricsInterval = Prometheus.collectDefaultMetrics()
app.get('/metrics', (req, res) => {
  if (!lastMeasurement.volt) return res.status(504).end()
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

