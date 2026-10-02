const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const DeviceProcess = require('./process')
const exec = require('./exec')
const plist = require('./plist')

// This machine, which runs what is built for it in place.
module.exports = class LocalDevice {
  constructor() {
    this.id = 'local'
    this.name = os.hostname()
    this.platform = os.platform()
    this.kind = 'local'
    this.host = `${os.platform()}-${os.arch()}`
    this.running = true
  }

  // What was built for this machine runs where it was built.
  install(app) {
    return Promise.resolve()
  }

  // This machine's own network is the one the device uses.
  reverse(port) {
    return Promise.resolve()
  }

  async launch(app, opts = {}) {
    const { args = [], activate = false } = opts

    const launched = await this.spawn(await this._executable(app), args, opts)

    if (activate) await this._activate(app, launched._child.pid)

    return launched
  }

  spawn(executable, args = [], opts = {}) {
    const { stdio = ['ignore', 'pipe', 'pipe'] } = opts

    return Promise.resolve(new DeviceProcess(spawn(executable, args, { stdio })))
  }

  // An app started directly stays behind whatever started it. Opening its
  // bundle once it is known to the system brings that instance to the front
  // rather than starting another one.
  async _activate(app, pid) {
    if (this.platform !== 'darwin') return

    for (let i = 0; i < 50; i++) {
      if ((await exec('lsappinfo', ['find', `pid=${pid}`])).trim() !== '') {
        await exec('open', [app])
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  async _executable(app) {
    switch (this.platform) {
      case 'darwin': {
        const contents = path.join(app, 'Contents')

        const name = await plist.read(path.join(contents, 'Info.plist'), 'CFBundleExecutable')

        return path.join(contents, 'MacOS', name)
      }
      default:
        throw new Error(`Launching apps on '${this.platform}' is not supported yet`)
    }
  }
}
