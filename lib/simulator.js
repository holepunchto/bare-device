const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const DeviceProcess = require('./process')
const exec = require('./exec')
const pipes = require('./pipes')

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

    // The newest iPhones come first, as those are what a device is picked from when none is named.
    return Object.entries(json.devices)
      .map(([runtime, devices]) => ({ version: version(runtime), devices }))
      .filter(({ version }) => version !== null)
      .sort((a, b) => compare(b.version, a.version))
      .flatMap(({ devices }) => devices.sort((a, b) => iphone(b) - iphone(a)))
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
    const { args = [], stdio = ['ignore', 'pipe', 'pipe'] } = opts

    await this.boot()

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

    // The simulator resolves paths under `/tmp` and `/var` within its own data.
    const tmp = (await simctl(['getenv', this.id, 'TMPDIR'])).trim()

    const io = await pipes(stdio, tmp)

    try {
      await simctl([
        'launch',
        '--terminate-running-process',
        `--stdout=${io.paths[0]}`,
        `--stderr=${io.paths[1]}`,
        this.id,
        identifier,
        ...args
      ])
    } catch (err) {
      io.kill()

      await io.ended

      throw err
    }

    return new DeviceProcess(null, {
      stdout: io.stdout,
      stderr: io.stderr,
      exited: io.ended.then(() => ({ code: null, signal: null })),
      stop: async () => {
        await simctl(['terminate', this.id, identifier]).catch(() => {})

        io.kill()
      }
    })
  }
}

function version(runtime) {
  const match = /\.iOS-([\d-]+)$/.exec(runtime)

  return match === null ? null : match[1].split('-').map(Number)
}

function compare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] || 0) - (b[i] || 0)

    if (difference !== 0) return difference
  }

  return 0
}

function iphone(device) {
  return device.deviceTypeIdentifier.includes('iPhone') ? 1 : 0
}

function simctl(args) {
  return exec('xcrun', ['simctl', ...args])
}
