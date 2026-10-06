const os = require('os')
const LocalDevice = require('./lib/local')
const SimulatorDevice = require('./lib/simulator')
const AndroidDevice = require('./lib/android')

exports.LocalDevice = LocalDevice
exports.SimulatorDevice = SimulatorDevice
exports.AndroidDevice = AndroidDevice

exports.devices = async function devices() {
  return [new LocalDevice(), ...(await simulators()), ...(await androids())]
}

exports.find = async function find(opts = {}) {
  const { platform = os.platform(), name = null } = opts

  const candidates = (await list(platform)).filter((device) => device.platform === platform)

  if (candidates.length === 0) throw new Error(`No devices for platform '${platform}'`)

  if (name !== null) {
    const query = name.toLowerCase()

    const device =
      candidates.find((device) => device.name.toLowerCase() === query) ||
      candidates.find((device) => device.name.toLowerCase().includes(query))

    if (device === undefined) throw new Error(`No device matching '${name}'`)

    return device
  }

  const device = candidates.find((device) => device.running)

  if (device === undefined) {
    throw new Error(`No running device for platform '${platform}', so one must be named`)
  }

  return device
}

function list(platform) {
  switch (platform) {
    case 'ios':
      return simulators()
    case 'android':
      return androids()
    default:
      return [new LocalDevice()]
  }
}

function simulators() {
  if (os.platform() !== 'darwin') return []

  return SimulatorDevice.list().catch(() => [])
}

function androids() {
  return AndroidDevice.list().catch(() => [])
}
