const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const env = require('#env')
const kill = require('#kill')
const DeviceProcess = require('./process')
const exec = require('./exec')
const lines = require('./lines')
const { normalize, sink } = require('./stdio')

module.exports = class LocalDevice {
  constructor() {
    this.id = 'local'
    this.name = os.hostname()
    this.platform = os.platform()
    this.kind = 'local'
    this.host = `${os.platform()}-${os.arch()}`
    this.running = true
  }

  install(app) {
    return Promise.resolve()
  }

  reverse(port) {
    return Promise.resolve()
  }

  async launch(app, opts = {}) {
    const { args = [], activate = false, stdio = ['ignore', 'pipe', 'pipe'] } = opts

    if (this.platform === 'darwin') return open(app, args, activate, stdio)

    const executable = this._executable(app)

    // Checked up front, so that a virtual display is not started for nothing.
    await fs.promises.access(executable)

    if (this.platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
      return xvfb(app, executable, args, stdio)
    }

    return this.spawn(executable, args, { stdio })
  }

  spawn(executable, args = [], opts = {}) {
    const { stdio = ['ignore', 'pipe', 'pipe'] } = opts

    return new Promise((resolve) => resolve(new DeviceProcess(spawn(executable, args, { stdio }))))
  }

  _executable(app) {
    switch (this.platform) {
      case 'linux':
        return path.join(app, 'AppRun')
      case 'win32':
        return path.join(app, 'App', path.basename(app) + '.exe')
      default:
        throw new Error(`Launching apps on '${this.platform}' is not supported`)
    }
  }
}

// Launch Services activates the app as part of launching it. Each pipe is read
// by `cat`, so that a launch that never opens it cannot block a read.
async function open(app, args, activate, stdio) {
  const [, stdout, stderr] = normalize(stdio)

  const bundle = await fs.promises.realpath(app)

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bare-device-'))

  const pipes = [path.join(dir, 'stdout'), path.join(dir, 'stderr')]

  await exec('mkfifo', pipes)

  const readers = pipes.map((pipe) => spawn('cat', [pipe], { stdio: ['ignore', 'pipe', 'ignore'] }))

  const output = sink(stdout, console.log)
  const errors = sink(stderr, console.error)

  const printed = lines(readers[0].stdout, (line) => output.write(line))
  const failed = lines(readers[1].stdout, (line) => errors.write(line))

  const before = await instances(bundle)

  const child = spawn(
    'open',
    [
      ...(activate ? ['-n', '-W'] : ['-n', '-W', '-g']),
      '-o',
      pipes[0],
      '--stderr',
      pipes[1],
      bundle,
      '--args',
      ...args
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  )

  const reasons = []

  child.stderr.on('data', (data) => reasons.push(data))

  const exited = DeviceProcess.exited(child).then(async ({ code }) => {
    if (code !== 0) for (const reader of readers) reader.kill()

    await Promise.all([printed, failed])

    await fs.promises.rm(dir, { recursive: true, force: true })

    output.end()
    errors.end()

    return { code: null, signal: null }
  })

  let pid = null

  while (pid === null && child.exitCode === null) {
    const id = (await instances(bundle)).find((id) => !before.includes(id))

    if (id === undefined) await new Promise((resolve) => setTimeout(resolve, 100))
    else pid = await instancePid(id)
  }

  if (pid === null && child.exitCode !== 0) {
    await exited

    throw new Error(`Could not launch '${app}': ${Buffer.concat(reasons).toString().trim()}`)
  }

  return new DeviceProcess(child, {
    stdout: output.stream,
    stderr: errors.stream,
    exited,
    stop: () => {
      if (pid !== null && child.exitCode === null) kill(pid)
    }
  })
}

// A machine without a display, such as a CI runner, gets a virtual one for as
// long as the app runs.
async function xvfb(app, executable, args, stdio) {
  let server
  let stopped
  let display

  try {
    server = spawn('Xvfb', ['-displayfd', '1', '-nolisten', 'tcp'], {
      stdio: ['ignore', 'pipe', 'ignore']
    })

    stopped = DeviceProcess.exited(server).catch(() => {})

    display = await new Promise((resolve, reject) => {
      let buffered = ''

      server.stdout.on('data', (data) => {
        buffered += data.toString()

        const end = buffered.indexOf('\n')

        if (end !== -1) resolve(':' + buffered.slice(0, end).trim())
      })

      server
        .on('error', reject)
        .on('exit', () => reject(new Error('Xvfb exited before opening a display')))
    })
  } catch (err) {
    throw new Error(`Could not launch '${app}' without a display: ${err.message}`)
  }

  const stop = () => {
    DeviceProcess.kill(server)

    return stopped
  }

  // The virtual display has neither a GPU nor an accessibility bus, which GTK
  // and Mesa otherwise warn about.
  const vars = { GTK_A11Y: 'none', LIBGL_ALWAYS_SOFTWARE: '1', ...env, DISPLAY: display }

  let child

  try {
    child = spawn(executable, args, { stdio, env: vars })
  } catch (err) {
    await stop()

    throw err
  }

  return new DeviceProcess(child, { exited: DeviceProcess.exited(child).finally(stop) })
}

async function instances(bundle) {
  const found = await exec('lsappinfo', ['find', `bundlepath=${bundle}`])

  return found.match(/0x[0-9a-f]+-0x[0-9a-f]+/g) || []
}

async function instancePid(id) {
  const info = await exec('lsappinfo', ['info', '-only', 'pid', `ASN:${id}:`])

  // macOS 27 prints `pid = 123` where earlier versions print `"pid"=123`.
  const match = /"?pid"?\s*=\s*(\d+)/.exec(info)

  return match === null ? null : Number(match[1])
}
