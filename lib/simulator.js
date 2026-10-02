const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const { Transform } = require('bare-stream')
const DeviceProcess = require('./process')
const exec = require('./exec')
const plist = require('./plist')

// An iOS simulator, driven through `simctl`.
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

    // Waits for the boot to finish, booting the device first if it has to.
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

    const identifier = await plist.read(path.join(app, 'Info.plist'), 'CFBundleIdentifier')

    // The app's own standard streams are forwarded to those of `simctl`.
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

    return new DeviceProcess(child, {
      stdout: child.stdout.pipe(announced(new RegExp(`^${escape(identifier)}: \\d+\r?$`))),
      // Stopping `simctl` leaves the app running, so it is terminated as well.
      onclose: () => simctl(['terminate', this.id, identifier]).catch(() => {})
    })
  }
}

// `simctl` announces the process it launched on the stream that otherwise
// carries the app's own output, so the announcement is taken back out.
function announced(pattern) {
  let buffered = ''
  let found = false

  return new Transform({
    transform(data, encoding, cb) {
      if (found) return cb(null, data)

      const lines = (buffered + data.toString()).split('\n')

      buffered = lines.pop()

      let output = ''

      for (const line of lines) {
        if (!found && pattern.test(line)) found = true
        else output += line + '\n'
      }

      if (found) {
        output += buffered
        buffered = ''
      }

      if (output === '') cb()
      else cb(null, output)
    },

    flush(cb) {
      if (buffered === '') cb()
      else cb(null, buffered)
    }
  })
}

function escape(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function simctl(args) {
  return exec('xcrun', ['simctl', ...args])
}
