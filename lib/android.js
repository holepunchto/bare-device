const path = require('path')
const { spawn } = require('child_process')
const { PassThrough } = require('bare-stream')
const DeviceProcess = require('./process')
const adb = require('./adb')
const lines = require('./lines')

const archs = {
  'armeabi-v7a': 'arm',
  'arm64-v8a': 'arm64',
  x86: 'ia32',
  x86_64: 'x64'
}

// An Android device or emulator, driven through `adb`.
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
    const [name, abi] = (
      await adb.exec([
        '-s',
        serial,
        'shell',
        'getprop ro.product.model; getprop ro.product.cpu.abi'
      ])
    )
      .trim()
      .split(/\r?\n/)

    // An emulator is better known by the virtual device it runs than by the
    // model it pretends to be.
    if (serial.startsWith('emulator-')) {
      const [avd] = (await adb.exec(['-s', serial, 'emu', 'avd', 'name'])).trim().split(/\r?\n/)

      return new AndroidDevice({ serial, name: avd, abi })
    }

    return new AndroidDevice({ serial, name, abi })
  }

  shell(command, args = []) {
    return adb.exec(['-s', this.id, 'shell', command, ...args])
  }

  reverse(port) {
    return adb.exec(['-s', this.id, 'reverse', `tcp:${port}`, `tcp:${port}`])
  }

  async install(apk) {
    await adb.exec(['-s', this.id, 'install', '-r', path.resolve(apk)])
  }

  // An app is not a child of this machine, so its end is noticed by asking
  // the device whether it is still running. Its log is followed by the user it
  // runs as from before it starts, because an app that fails while starting
  // is gone before it could be followed by its pid.
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

    const since = (await this.shell('date', ['+%s.%N'])).trim()

    const output = sink(stdout, console.log)
    const errors = sink(stderr, console.error)

    const log = this._follow(['--uid', uid[1], '-T', since], output, errors)

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

  // An executable is copied to a directory any shell user can run from, and
  // removed again once it has exited.
  async spawn(executable, args = [], opts = {}) {
    const [stdin, stdout, stderr] = normalize(opts.stdio)

    const remote = path.posix.join('/data/local/tmp/bare-device', path.basename(executable))

    await this.shell('mkdir', ['-p', path.posix.dirname(remote)])

    await adb.exec(['-s', this.id, 'push', executable, remote])

    const output = sink(stdout, console.log)
    const errors = sink(stderr, console.error)

    // Bare writes its console to the log rather than to the standard streams,
    // so the shell reports its pid before it becomes the executable and the
    // log is followed for that pid.
    const command = ['echo $$; exec', remote, ...args].map((arg, i) => (i === 0 ? arg : quote(arg)))

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

  // Follow the entries of the log that `filter` selects, warnings and errors to
  // `errors` and the rest to `output`, until stopped.
  _follow(filter, output, errors) {
    const route = (line) => {
      const match = entry.exec(line)

      if (match === null) return false

      if ('WEF'.includes(match[1])) errors.write(match[2])
      else output.write(match[2])

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

        // What the live log had not delivered by the time the process exited
        // is still in the buffer, behind everything it did deliver.
        const dump = await adb.exec(['-s', this.id, 'logcat', '-d', ...filter, '-v', 'tag'])

        let skipped = 0

        for (const line of dump.split(/\r?\n/)) {
          if (!entry.test(line) || skipped++ < received) continue

          route(line)
        }
      }
    }
  }
}

// An entry of `logcat -v tag`, which is its priority, its tag and its message.
const entry = /^([VDIWEF])\/.*?: ?(.*)$/

function normalize(stdio = ['ignore', 'pipe', 'pipe']) {
  if (typeof stdio === 'string') return [stdio, stdio, stdio]

  return [stdio[0] || 'ignore', stdio[1] || 'pipe', stdio[2] || 'pipe']
}

// Where the lines of one stream go: to a stream of their own when piped, to the
// standard stream of this process when inherited, and nowhere when ignored.
function sink(io, log) {
  const stream = io === 'pipe' ? new PassThrough() : null

  return {
    stream,

    write(line) {
      if (stream !== null) stream.write(line + '\n')
      else if (io === 'inherit') log(line)
    },

    end() {
      if (stream !== null) stream.end()
    }
  }
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
