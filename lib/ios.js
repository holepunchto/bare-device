const path = require('path')
const { spawn } = require('child_process')
const DeviceProcess = require('./process')
const exec = require('./exec')
const { normalize } = require('./stdio')

module.exports = class IOSDevice {
  constructor({ identifier, connectionProperties, deviceProperties }) {
    this.id = identifier
    this.name = deviceProperties.name
    this.platform = 'ios'
    this.kind = 'device'
    this.host = 'ios-arm64'
    this.running =
      deviceProperties.bootState === 'booted' && connectionProperties.tunnelState !== 'unavailable'
  }

  static async list() {
    const json = JSON.parse(await devicectl(['list', 'devices']))

    return json.result.devices
      .filter(
        (device) =>
          device.hardwareProperties.reality === 'physical' &&
          device.hardwareProperties.platform === 'iOS' &&
          device.connectionProperties.pairingState === 'paired'
      )
      .map((device) => new IOSDevice(device))
  }

  async install(app) {
    await devicectl(['device', 'install', 'app', '--device', this.id, path.resolve(app)])
  }

  reverse(port) {
    return Promise.reject(new Error('Reaching this machine from an iOS device is not supported'))
  }

  spawn(executable, args = [], opts = {}) {
    return Promise.reject(new Error('Running executables on an iOS device is not supported'))
  }

  async launch(app, opts = {}) {
    const { args = [], activate = true } = opts

    const [, stdout, stderr] = normalize(opts.stdio)

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
        'devicectl',
        'device',
        'process',
        'launch',
        '--quiet',
        '--console',
        '--terminate-existing',
        activate ? '--activate' : '--no-activate',
        '--device',
        this.id,
        identifier,
        ...args
      ],
      { stdio: ['ignore', stdout, stderr] }
    )

    return new DeviceProcess(child)
  }
}

function devicectl(args) {
  return exec('xcrun', ['devicectl', ...args, '--json-output', '-'])
}
