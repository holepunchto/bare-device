const path = require('path')
const { spawn } = require('child_process')
const DeviceProcess = require('./process')
const adb = require('./adb')
const lines = require('./lines')
const { normalize, sink } = require('./stdio')

const archs = {
  'armeabi-v7a': 'arm',
  'arm64-v8a': 'arm64',
  x86: 'ia32',
  x86_64: 'x64'
}

module.exports = class AndroidDevice {
  constructor({ serial, name, abi }) {
    this.id = serial
    this.name = name
    this.platform = 'android'
    this.kind = serial.startsWith('emulator-') ? 'emulator' : 'device'
    this.host = `android-${archs[abi]}`
    this.running = true
  }

  static async list() {
    const serials = (await adb.exec(['devices']))
      .split('\n')
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .filter(([, state]) => state === 'device')
      .map(([serial]) => serial)

    return Promise.all(serials.map((serial) => AndroidDevice._describe(serial)))
  }

  static async _describe(serial) {
    const [model, abi] = (
      await adb.exec([
        '-s',
        serial,
        'shell',
        'getprop ro.product.model; getprop ro.product.cpu.abi'
      ])
    )
      .trim()
      .split(/\r?\n/)

    // An emulator is named after its virtual device.
    const name = serial.startsWith('emulator-')
      ? (await adb.exec(['-s', serial, 'emu', 'avd', 'name'])).trim().split(/\r?\n/)[0]
      : model

    return new AndroidDevice({ serial, name, abi })
  }

  shell(command, args = []) {
    return adb.exec(['-s', this.id, 'shell', command, ...args])
  }

  reverse(port) {
    return adb.exec(['-s', this.id, 'reverse', `tcp:${port}`, `tcp:${port}`])
  }

  // Pushing the APK compresses it, while streaming it does not.
  async install(apk) {
    await adb.exec(['-s', this.id, 'install', '-r', '--no-streaming', path.resolve(apk)])
  }

  // The log is followed by user from before the app starts, as an app that fails
  // while starting is gone before its pid is known.
  async launch(apk, opts = {}) {
    const { args = [] } = opts

    if (args.length > 0) throw new Error('Passing arguments to apps is not supported on Android')

    const [, stdout, stderr] = normalize(opts.stdio)

    const { packageName, launchableActivity } = await manifest(apk)

    const listed = (await this.shell('cmd', ['package', 'list', 'packages', '-U', packageName]))
      .split(/\r?\n/)
      .find((line) => line.startsWith(`package:${packageName} `))

    const uid = listed === undefined ? null : /\buid:(\d+)/.exec(listed)

    if (uid === null) throw new Error(`The app '${packageName}' is not installed`)

    await this.shell('am', ['force-stop', packageName])

    await this._wake()

    const since = (await this.shell('date', ['+%s.%N'])).trim()

    const output = sink(stdout, console.log)
    const errors = sink(stderr, console.error)

    // The app's entries are tagged with the end of its package name, and a crash
    // is logged as fatal or by the runtime.
    const tag = packageName.slice(-15)

    const accepts = (entry) =>
      entry.tag === tag || entry.priority === 'F' || entry.tag === 'AndroidRuntime'

    const log = this._follow(['--uid', uid[1], '-T', since], output, errors, accepts)

    await this.shell('am', ['start', '-W', '-n', `${packageName}/${launchableActivity}`])

    const exited = (async () => {
      while ((await this.shell('pidof', [packageName]).catch(() => '')).trim() !== '') {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      await log.stop()

      output.end()
      errors.end()

      return { code: null, signal: null }
    })()

    return new DeviceProcess(null, {
      stdout: output.stream,
      stderr: errors.stream,
      exited,
      stop: () => this.shell('am', ['force-stop', packageName])
    })
  }

  // A window behind a sleeping or locked screen is not laid out again.
  async _wake() {
    await this.shell('input', ['keyevent', 'KEYCODE_WAKEUP'])
    await this.shell('wm', ['dismiss-keyguard'])

    for (let i = 0; i < 50; i++) {
      const power = await this.shell('dumpsys', ['power'])
      const window = await this.shell('dumpsys', ['window'])

      if (power.includes('mWakefulness=Awake') && window.includes('isKeyguardShowing=false')) return

      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    throw new Error(`The device '${this.name}' is locked, so it has to be unlocked first`)
  }

  async spawn(executable, args = [], opts = {}) {
    const [stdin, stdout, stderr] = normalize(opts.stdio)

    const remote = path.posix.join('/data/local/tmp/bare-device', path.basename(executable))

    await this.shell('mkdir', ['-p', path.posix.dirname(remote)])

    await adb.exec(['-s', this.id, 'push', executable, remote])

    const output = sink(stdout, console.log)
    const errors = sink(stderr, console.error)

    // Bare writes its console to the log, so the shell reports the pid to
    // follow before it becomes the executable.
    const command = ['echo $$; exec', ...[remote, ...args].map(quote)]

    const child = spawn(adb(), ['-s', this.id, 'shell', command.join(' ')], {
      stdio: [stdin === 'inherit' ? 'inherit' : 'ignore', 'pipe', 'pipe']
    })

    let log = null

    const printed = lines(child.stdout, (line) => {
      if (log === null) log = this._follow(['--pid', line.trim()], output, errors)
      else output.write(line)
    })

    const failed = lines(child.stderr, (line) => errors.write(line))

    const exited = DeviceProcess.exited(child).then(async (result) => {
      await Promise.all([printed, failed])

      if (log !== null) await log.stop()

      await this.shell('rm', ['-f', remote]).catch(() => {})

      output.end()
      errors.end()

      return result
    })

    return new DeviceProcess(child, { stdout: output.stream, stderr: errors.stream, exited })
  }

  _follow(filter, output, errors, accepts = () => true) {
    const route = (line) => {
      const entry = parse(line)

      if (entry === null || !accepts(entry)) return false

      if ('WEF'.includes(entry.priority)) errors.write(entry.message)
      else output.write(entry.message)

      return true
    }

    const log = spawn(adb(), ['-s', this.id, 'logcat', ...filter, '-v', 'tag'], {
      stdio: ['ignore', 'pipe', 'ignore']
    })

    let received = 0

    const logged = lines(log.stdout, (line) => {
      if (route(line)) received++
    })

    return {
      stop: async () => {
        log.kill()

        await logged

        // What the live log had not delivered yet is still in the buffer.
        const dump = await adb.exec(['-s', this.id, 'logcat', '-d', ...filter, '-v', 'tag'])

        let skipped = 0

        for (const line of dump.split(/\r?\n/)) {
          const entry = parse(line)

          if (entry === null || !accepts(entry) || skipped++ < received) continue

          route(line)
        }
      }
    }
  }
}

function parse(line) {
  const match = /^([VDIWEF])\/(.*?) *: ?(.*)$/.exec(line)

  return match === null ? null : { priority: match[1], tag: match[2], message: match[3] }
}

function manifest(apk) {
  let apks

  try {
    apks = require('bare-apk')
  } catch {
    throw new Error('Launching an APK requires bare-apk')
  }

  return apks.readManifest(apk)
}

function quote(arg) {
  return `'${arg.replace(/'/g, `'\\''`)}'`
}
