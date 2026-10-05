const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const { Transform } = require('bare-stream')
const DeviceProcess = require('./process')
const exec = require('./exec')

module.exports = class SimulatorDevice {
  constructor({ udid, name, state }) {
    this.id = udid
    this.name = name
    this.platform = 'ios'
    this.kind = 'simulator'
    this.host = `ios-${os.arch()}-simulator`
    this.booted = state === 'Booted'
  }

  get running() {
    return this.booted
  }

  static async list() {
    const json = JSON.parse(await simctl(['list', '--json', 'devices', 'available']))

    return Object.values(json.devices)
      .flat()
      .map((device) => new SimulatorDevice(device))
  }

  async boot() {
    if (this.booted) return

    // Boots the device if needed and waits for it.
    await simctl(['bootstatus', this.id, '-b'])

    this.booted = true
  }

  async install(app) {
    await this.boot()

    await simctl(['install', this.id, app])
  }

  // A simulator shares the network of this machine.
  reverse(port) {
    return Promise.resolve()
  }

  async spawn(executable, args = [], opts = {}) {
    const { stdio = ['ignore', 'pipe', 'pipe'] } = opts

    await this.boot()

    return new DeviceProcess(
      spawn('xcrun', ['simctl', 'spawn', this.id, executable, ...args], { stdio })
    )
  }

  async launch(app, opts = {}) {
    const { args = [] } = opts

    const identifier = (
      await exec('plutil', [
        '-extract',
        'CFBundleIdentifier',
        'raw',
        '-o',
        '-',
        path.join(app, 'Info.plist')
      ])
    ).trim()

    const child = spawn(
      'xcrun',
      [
        'simctl',
        'launch',
        '--console-pty',
        '--terminate-running-process',
        this.id,
        identifier,
        ...args
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )

    // `simctl` announces the launched process on the app's own output.
    const prefix = `${identifier}: `

    const announced = (line) =>
      line.startsWith(prefix) && /^\d+\r?$/.test(line.slice(prefix.length))

    return new DeviceProcess(child, {
      stdout: child.stdout.pipe(without(announced)),
      // Stopping `simctl` leaves the app running, so the app is stopped first.
      stop: async () => {
        await simctl(['terminate', this.id, identifier]).catch(() => {})

        DeviceProcess.kill(child)
      }
    })
  }
}

function without(match) {
  let buffered = ''

  return new Transform({
    transform(data, encoding, cb) {
      const lines = (buffered + data.toString()).split('\n')

      buffered = lines.pop()

      for (const line of lines) if (!match(line)) this.push(line + '\n')

      cb()
    },

    flush(cb) {
      if (buffered !== '' && !match(buffered)) this.push(buffered)

      cb()
    }
  })
}

function simctl(args) {
  return exec('xcrun', ['simctl', ...args])
}
